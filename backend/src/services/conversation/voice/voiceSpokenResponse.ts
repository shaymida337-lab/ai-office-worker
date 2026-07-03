import type { NatalieClaudeResponse } from "../../claude.js";
import type { ConfirmationPolicyResult } from "../conversationTypes.js";

function baseAnswer(response: NatalieClaudeResponse): string {
  return "answer" in response && typeof response.answer === "string" ? response.answer.trim() : "";
}

function splitIntoSpeakableSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|[\n\r]+|(?<=;)\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function joinWithNaturalPauses(parts: string[]): string {
  return parts.filter(Boolean).join(" ");
}

export function buildVoiceSpokenResponse(input: {
  brainResponse: NatalieClaudeResponse;
  displayResponse: string;
  confirmation: ConfirmationPolicyResult;
}): string {
  const answer = baseAnswer(input.brainResponse);
  if (!answer) return input.displayResponse;

  if ("action" in input.brainResponse && input.brainResponse.action === "show_invoice") {
    const invoices = input.brainResponse.invoices ?? [];
    if (invoices.length === 0) {
      return "לא מצאתי חשבוניות שמתאימות לבקשה.";
    }
    const parts = [`מצאתי ${invoices.length} חשבוניות.`];
    const top = [...invoices].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0];
    if (top?.supplierName && top.amount != null) {
      parts.push(
        `הגדולה ביותר היא של ${top.supplierName}, בסכום של ${top.amount.toLocaleString("he-IL")} ${top.currency ?? "שקלים"}.`
      );
    }
    parts.push("רוצה שאפרט על עוד אחת?");
    return joinWithNaturalPauses(parts);
  }

  if ("action" in input.brainResponse && input.brainResponse.action === "suggest_available_times") {
    const slots = input.brainResponse.proposal?.slots ?? [];
    if (slots.length === 0) {
      return answer;
    }
    const preview = slots
      .slice(0, 2)
      .map((slot) => slot.label)
      .join(", ");
    const suffix = slots.length > 2 ? " ועוד אפשרויות." : ".";
    const prompt = input.confirmation.required ? ` ${input.confirmation.spokenPrompt}` : " לאיזה מועד מתאים?";
    return `יש לי ${slots.length} זמנים פנויים, למשל ${preview}${suffix}${prompt}`.trim();
  }

  if ("action" in input.brainResponse && input.brainResponse.action) {
    const sentences = splitIntoSpeakableSentences(answer);
    const lead = sentences.slice(0, 2).join(" ");
    if (input.confirmation.required && input.confirmation.spokenPrompt && !lead.includes("לאשר")) {
      return `${lead} ${input.confirmation.spokenPrompt}`.trim();
    }
    return lead || answer;
  }

  const sentences = splitIntoSpeakableSentences(answer);
  if (sentences.length <= 2) {
    return answer;
  }
  return joinWithNaturalPauses(sentences.slice(0, 3));
}

export function buildVoiceExecutionSpokenResponse(input: {
  action: string;
  successMessage: string;
}): string {
  switch (input.action) {
    case "create_task":
      return `בוצע. ${input.successMessage}`;
    case "complete_task":
      return `סימנתי את המשימה כבוצעה. ${input.successMessage}`;
    case "issue_invoice":
      return `הטיוטה נשמרה. ${input.successMessage}`;
    case "book_appointment":
      return `התור נקבע. ${input.successMessage}`;
    case "cancel_appointment":
      return `התור בוטל. ${input.successMessage}`;
    case "reschedule_appointment":
      return `התור עודכן. ${input.successMessage}`;
    default:
      return input.successMessage;
  }
}

export function buildVoiceCancellationSpokenResponse(kind: "rejected" | "cancelled"): string {
  if (kind === "cancelled") {
    return "בסדר, ביטלתי את הפעולה הממתינה.";
  }
  return "בסדר, לא אבצע את הפעולה.";
}
