import type { SessionUser } from "@/lib/auth/session";
import type { ChatbotRow } from "@/repository/chatbots";

/**
 * `canAccessChatbot` — in the solo-admin model every account is the root of its
 * own single-user tenant, so access is simply the tenant match: a user can
 * reach a chatbot only when it belongs to their own `admin_id` (= their id).
 * There is no god-mode and no cross-tenant member access.
 */
export function canAccessChatbot(chatbot: ChatbotRow, user: SessionUser): boolean {
  return chatbot.admin_id === user.admin_id;
}