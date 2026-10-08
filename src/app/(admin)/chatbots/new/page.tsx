"use client";

import { useRouter } from "next/navigation";
import { SettingsForm } from "@/components/admin/settings-form";
import type { ChatbotDetail } from "@/components/admin/settings-form";

/**
 * Create chatbot — a dedicated page with the full chatbot form (same sections
 * as the chatbot's Settings tab), mirroring the PHP /chatbots/create page.
 * On success, routes to the new chatbot's detail page.
 */
export default function NewChatbotPage() {
  const router = useRouter();
  return (
    <>
      {/* The PHP create page renders the form cards directly, with no page heading. */}
      <SettingsForm
        mode="create"
        chatbot={{} as ChatbotDetail}
        onSaved={() => {}}
        onCreated={(id) => router.push(`/chatbots/${id}`)}
      />
    </>
  );
}
