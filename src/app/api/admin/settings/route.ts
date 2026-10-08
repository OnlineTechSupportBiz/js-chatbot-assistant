import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { requireAdminUser, requireAdminSession } from "@/lib/auth/require";
import { getAdminSettings, updateAdminSettings } from "@/lib/admin/settings";
import { ProviderUrlValidationError } from "@/lib/openai/client";
import { validateTimezone } from "@/lib/timezones";

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req);
  if (!auth.ok) return auth.response;
  const settings = await withTransaction((db) => getAdminSettings(db, auth.user), { adminId: auth.user.admin_id });
  return NextResponse.json(settings);
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;

  // Validate before touching anything. The dropdown cannot send a bad zone, but
  // this endpoint is a public HTTP surface and the column is a plain VARCHAR(64).
  if (auth.body.timezone !== undefined) {
    const tzError = validateTimezone(auth.body.timezone);
    if (tzError !== null) return NextResponse.json({ error: tzError }, { status: 422 });
  }

  const input: Record<string, unknown> = {};
  if (auth.body.brand_name !== undefined) input.brand_name = auth.body.brand_name;
  if (auth.body.timezone !== undefined) input.timezone = auth.body.timezone;
  if (auth.body.openai_api_key !== undefined) input.openai_api_key = auth.body.openai_api_key;
  if (auth.body.llamacloud_api_key !== undefined) input.llamacloud_api_key = auth.body.llamacloud_api_key;
  if (auth.body.llm_base_url !== undefined) input.llm_base_url = auth.body.llm_base_url;
  if (auth.body.embedding_base_url !== undefined) input.embedding_base_url = auth.body.embedding_base_url;
  if (auth.body.embedding_api_key !== undefined) input.embedding_api_key = auth.body.embedding_api_key;
  if (auth.body.embedding_model !== undefined) input.embedding_model = auth.body.embedding_model;
  if (auth.body.llm_models !== undefined) input.llm_models = auth.body.llm_models;

  try {
    await withTransaction((db) => updateAdminSettings(db, auth.user, input), { adminId: auth.user.admin_id });
  } catch (err) {
    // A rejected provider URL is a user input problem, not a server fault:
    // surface the reason so the UI can show it instead of a generic failure.
    if (err instanceof ProviderUrlValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }

  // Keep the live session's display timezone in step with the saved setting, so
  // the UI re-renders timestamps in the new zone without a re-login. PHP does the
  // same with $_SESSION['timezone'].
  if (typeof input.timezone === "string") {
    auth.session.setTimezone(input.timezone);
    await auth.session.save();
  }

  // Same for the brand name: keep the live session in step so the sidebar and
  // topbar re-render with the new brand without a re-login.
  if (typeof input.brand_name === "string" && input.brand_name !== "") {
    auth.session.setBrandName(input.brand_name);
    await auth.session.save();
  }

  return NextResponse.json({ ok: true });
}