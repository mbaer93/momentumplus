/*
 * What the help chat accepts and what it returns (Phase 8).
 *
 * Both halves of this run against a PAID API on Matt's key, reached by any
 * active member. The sanitizer is what stands between that key and a
 * client that sends whatever it likes: without the caps, one member could
 * post a thousand messages of a hundred thousand characters each and every
 * one would be forwarded and billed. Pulled out of the route so the limits
 * are pinned rather than assumed.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Most recent turns kept — enough for context, bounded for cost. */
export const MAX_HISTORY = 12;
/** Per-message character cap. */
export const MAX_CONTENT = 2000;

/**
 * Drop anything malformed, keep the last few turns, and cap each one.
 *
 * Order matters: filter, THEN take the tail. Trimming first would let a
 * client push the real question out of the window with junk entries.
 */
export function sanitizeChatHistory(input: unknown): ChatMessage[] {
  const messages = Array.isArray(input) ? input : [];
  return messages
    .filter(
      (m): m is ChatMessage =>
        Boolean(m) &&
        typeof m === "object" &&
        ((m as ChatMessage).role === "user" ||
          (m as ChatMessage).role === "assistant") &&
        typeof (m as ChatMessage).content === "string" &&
        (m as ChatMessage).content.trim().length > 0,
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT) }));
}

/**
 * Is this history something we should actually send?
 *
 * The last turn has to be the member's. Anything else is a client bug or a
 * replay, and answering an assistant turn bills for a reply to ourselves.
 */
export function isSendableHistory(history: ChatMessage[]): boolean {
  return history.length > 0 && history[history.length - 1].role === "user";
}

/** Pull the text out of an Anthropic response, ignoring non-text blocks. */
export function extractReplyText(data: unknown): string {
  const content = (data as { content?: { type: string; text?: string }[] })
    ?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n")
    .trim();
}
