import type { DbClient } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { findUserById, getApiKeys, setApiKeys, getLlmModels, setLlmModels, type ApiKeys, type LlmModel } from "@/repository/users";
import { enqueueReembedForAdmin } from "@/repository/document-jobs";
import { listTimezoneOptions, type TimezoneOption } from "@/lib/timezones";
import { validateProviderBaseUrl } from "@/lib/openai/client";
import { getConfig } from "@/lib/config";
import { logAudit } from "@/repository/audit-logs";
import { updateBrandName, updateTimezone } from "./admin";

/** An LLM model entry as returned to the UI (API key masked). */
export interface LlmModelSettings {
  name: string;
  base_url: string;
  api_key_hint: string | null;
  model: string;
}

export interface AdminSettings {
  /** Account card (read-only display, mirrors the PHP settings page). */
  user_name: string;
  user_email: string;
  company_name: string | null;
  user_role: "admin" | "user";
  /** Whether an authenticator app is configured (MFA card). */
  mfa_enabled: boolean;
  brand_name: string;
  timezone: string;
  /**
   * Selectable zones for the timezone dropdown, generated server-side. Carries
   * the IANA name as `value` and a human label ("US Mountain (Denver)") to show.
   */
  timezones: TimezoneOption[];
  openai_api_key_hint: string | null;
  llamacloud_api_key_hint: string | null;
  llm_base_url: string | null;
  embedding_base_url: string | null;
  embedding_api_key_hint: string | null;
  embedding_model: string | null;
  llm_models: LlmModelSettings[];
}

export interface AdminSettingsInput {
  brand_name?: string;
  timezone?: string;
  openai_api_key?: string;
  llamacloud_api_key?: string;
  llm_base_url?: string;
  embedding_base_url?: string;
  embedding_api_key?: string;
  embedding_model?: string;
  llm_models?: LlmModel[];
}

function maskKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 6) return "******";
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}

export async function getAdminSettings(db: DbClient, user: SessionUser): Promise<AdminSettings> {
  const u = await findUserById(db, user.user_id);
  const keys = await getApiKeys(db, user.user_id);
  const models = await getLlmModels(db, user.user_id);
  return {
    user_name: u?.name ?? user.user_name,
    user_email: u?.email ?? user.user_email,
    company_name: u?.company_name ?? null,
    user_role: user.user_role,
    mfa_enabled: (u?.mfa_enabled ?? 0) === 1,
    brand_name: u?.brand_name ?? "Chatbot Assistant",
    timezone: u?.timezone ?? "UTC",
    timezones: listTimezoneOptions(),
    openai_api_key_hint: maskKey(keys.openai_api_key),
    llamacloud_api_key_hint: maskKey(keys.llamacloud_api_key),
    llm_base_url: keys.llm_base_url ?? null,
    embedding_base_url: keys.embedding_base_url ?? null,
    embedding_api_key_hint: maskKey(keys.embedding_api_key),
    embedding_model: keys.embedding_model ?? null,
    llm_models: models.map((m) => ({ name: m.name, base_url: m.base_url, api_key_hint: maskKey(m.api_key), model: m.model })),
  };
}

export async function updateAdminSettings(db: DbClient, user: SessionUser, input: AdminSettingsInput): Promise<void> {
  if (input.brand_name !== undefined) await updateBrandName(db, user, input.brand_name);
  if (input.timezone !== undefined) await updateTimezone(db, user, input.timezone);

  const keyUpdates: Partial<ApiKeys> = {};
  if (input.openai_api_key?.trim()) keyUpdates.openai_api_key = input.openai_api_key.trim();
  if (input.llamacloud_api_key?.trim()) keyUpdates.llamacloud_api_key = input.llamacloud_api_key.trim();

  // Model-management settings: empty resets to null (fall back to defaults).
  // Provider URLs are validated here because the server fetches them: an
  // unvalidated value lets a tenant aim every LLM/embedding call at an internal
  // address (loopback, RFC1918, cloud metadata).
  if (input.llm_base_url !== undefined) {
    keyUpdates.llm_base_url = input.llm_base_url.trim()
      ? validateProviderBaseUrl(input.llm_base_url, {
          allowPrivate: getConfig().allowPrivateProviderUrls,
        })
      : null;
  }
  if (input.embedding_base_url !== undefined) {
    keyUpdates.embedding_base_url = input.embedding_base_url.trim()
      ? validateProviderBaseUrl(input.embedding_base_url, {
          allowPrivate: getConfig().allowPrivateProviderUrls,
        })
      : null;
  }
  if (input.embedding_api_key !== undefined) keyUpdates.embedding_api_key = input.embedding_api_key.trim() || null;
  if (input.embedding_model !== undefined) keyUpdates.embedding_model = input.embedding_model.trim() || null;

  // Detect an embedding-provider/model change so existing chunks can be re-embedded.
  const before = await getApiKeys(db, user.user_id);
  const embeddingChanged =
    (keyUpdates.embedding_model !== undefined && (keyUpdates.embedding_model ?? null) !== (before.embedding_model ?? null)) ||
    (keyUpdates.embedding_base_url !== undefined && (keyUpdates.embedding_base_url ?? null) !== (before.embedding_base_url ?? null));

  if (Object.keys(keyUpdates).length > 0) {
    await setApiKeys(db, user.user_id, keyUpdates);
    // Changing a provider key or endpoint redirects every subsequent LLM call
    // (and llm_base_url could point the prompts at somewhere else entirely), so it
    // is recorded. The key values themselves are never written to the audit trail.
    await logAudit(db, {
      adminId: user.admin_id,
      userId: user.user_id,
      action: "update_api_keys",
      entityType: "user",
      entityId: user.user_id,
      newValue: {
        fields: Object.keys(keyUpdates),
        llm_base_url: keyUpdates.llm_base_url ?? undefined,
        embedding_base_url: keyUpdates.embedding_base_url ?? undefined,
        embedding_model: keyUpdates.embedding_model ?? undefined,
      },
    });
  }

  if (input.llm_models !== undefined) {
    const previous = await getLlmModels(db, user.user_id);
    const merged: LlmModel[] = input.llm_models.map((m) => {
      const prev = previous.find((p) => p.name === m.name);
      const baseUrl = (m.base_url ?? "").trim();
      return {
        name: m.name,
        base_url: baseUrl
          ? (validateProviderBaseUrl(baseUrl, {
              allowPrivate: getConfig().allowPrivateProviderUrls,
            }) ?? "")
          : "",
        api_key: (m.api_key ?? "").trim() || prev?.api_key || "",
        model: (m.model ?? "").trim(),
      };
    });
    await setLlmModels(db, user.user_id, merged);
    await logAudit(db, {
      adminId: user.admin_id,
      userId: user.user_id,
      action: "update_llm_models",
      entityType: "user",
      entityId: user.user_id,
      newValue: { count: merged.length, names: merged.map((m) => m.name) },
    });
  }

  if (embeddingChanged) {
    await enqueueReembedForAdmin(db, user.user_id);
  }
}