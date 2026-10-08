import type { DbClient } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import {
  createQuickAnswer as insertQuickAnswer,
  updateQuickAnswer as updateQuickAnswerRow,
  deleteQuickAnswer as removeQuickAnswerRow,
  findQuickAnswer,
  reorder as reorderRows,
} from "@/repository/quick-answers";
import { logAudit } from "@/repository/audit-logs";

/**
 * Quick-answer admin service — port of PHP `QuickAnswerController` mutations
 * (store/update/destroy/reorder) with the same validation + audit actions.
 */

export class ValidationError extends Error {}

export interface QuickAnswerInput {
  trigger: string;
  answer: string;
  is_active?: boolean | number;
}

export async function storeQuickAnswer(
  db: DbClient,
  user: SessionUser,
  chatbotId: number,
  input: QuickAnswerInput,
): Promise<number> {
  const trigger = input.trigger.trim();
  const answer = input.answer.trim();
  if (trigger === "") throw new ValidationError("Trigger text is required.");
  if (answer === "") throw new ValidationError("Answer text is required.");

  const id = await insertQuickAnswer(db, user.admin_id, chatbotId, trigger, answer, 0, 1);
  await logAudit(db, {
    adminId: user.admin_id, userId: user.user_id,
    action: "create_quick_answer", entityType: "quick_answer", entityId: null,
    newValue: { chatbot_id: chatbotId, trigger },
  });
  return id;
}

export async function updateQuickAnswer(
  db: DbClient,
  user: SessionUser,
  id: number,
  input: QuickAnswerInput,
): Promise<void> {
  const trigger = input.trigger.trim();
  const answer = input.answer.trim();
  if (trigger === "") throw new ValidationError("Trigger text is required.");
  if (answer === "") throw new ValidationError("Answer text is required.");

  const existing = await findQuickAnswer(db, id);
  await updateQuickAnswerRow(db, id, {
    trigger,
    answer,
    is_active: input.is_active ? 1 : 0,
  });
  await logAudit(db, {
    adminId: user.admin_id, userId: user.user_id,
    action: "update_quick_answer", entityType: "quick_answer", entityId: id,
    oldValue: { trigger: existing?.trigger ?? null },
    newValue: { trigger },
  });
}

export async function deleteQuickAnswer(db: DbClient, user: SessionUser, id: number): Promise<void> {
  const existing = await findQuickAnswer(db, id);
  const trigger = existing?.trigger ?? null;
  await removeQuickAnswerRow(db, id);
  await logAudit(db, {
    adminId: user.admin_id, userId: user.user_id,
    action: "delete_quick_answer", entityType: "quick_answer", entityId: id,
    oldValue: { trigger },
    newValue: null,
  });
}

export async function reorderQuickAnswers(db: DbClient, user: SessionUser, chatbotId: number, ids: number[]): Promise<void> {
  await reorderRows(db, user.admin_id, chatbotId, ids);
  await logAudit(db, {
    adminId: user.admin_id, userId: user.user_id,
    action: "reorder_quick_answers", entityType: "quick_answer", entityId: null,
    newValue: { chatbot_id: chatbotId, count: ids.length },
  });
}