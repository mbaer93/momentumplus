"use server";

/*
 * CommunityView dynamically imports askSpeakerQuestion when a member posts
 * in #ask-a-speaker. The question itself already lands in the chat with a
 * "[Question for X]" prefix; at an in-person event that's the whole flow —
 * speakers (and the emcee running Q&A) read the channel. No notification
 * fan-out here, unlike Momentum+.
 */
export async function askSpeakerQuestion(
  _speakerId: string,
  _question: string,
): Promise<{ ok: boolean; message?: string }> {
  return { ok: true };
}
