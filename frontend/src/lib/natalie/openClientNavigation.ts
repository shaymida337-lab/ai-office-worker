/**
 * Open-client action from Natalie chat: validate path and strip it from display text.
 */

export const OPEN_CLIENT_PATH_ERROR =
  "לא הצלחתי לפתוח את כרטיס הלקוח — הנתיב חסר או לא תקין.";

const OPEN_CLIENT_PATH_RE = /^\/dashboard\/clients\/[A-Za-z0-9_-]+$/;

export function isValidNatalieOpenClientPath(path: unknown): path is string {
  return typeof path === "string" && OPEN_CLIENT_PATH_RE.test(path.trim());
}

/** Remove the path from the chat bubble so we don't show a raw URL after navigating. */
export function formatOpenClientChatAnswer(answer: string, path: string): string {
  const trimmedPath = path.trim();
  const stripped = answer
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== trimmedPath && !line.includes(trimmedPath))
    .join("\n")
    .trim();
  return stripped || "פתחתי את כרטיס הלקוח.";
}
