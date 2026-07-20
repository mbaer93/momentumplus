"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteWhitneyConversation } from "@/app/(portal)/whitney/actions";

/*
 * Whitney's room: past conversations on the left (private to the member),
 * the active thread on the right. Sending posts to /api/whitney; a brand-new
 * thread gets its conversation id back with the first reply and the URL is
 * updated in place (no navigation, no lost state).
 */

interface ConvoSummary {
  id: string;
  title: string;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export function WhitneyRoom({
  initialConversations,
  initialActiveId,
  initialMessages,
}: {
  initialConversations: ConvoSummary[];
  initialActiveId: string | null;
  initialMessages: ChatMsg[];
}) {
  const router = useRouter();
  const [convos, setConvos] = useState<ConvoSummary[]>(initialConversations);
  const [conversationId, setConversationId] = useState<string | null>(
    initialActiveId,
  );
  const [messages, setMessages] = useState<ChatMsg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  async function send() {
    const message = input.trim();
    if (!message || sending) return;
    setError(null);
    setSending(true);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: message }]);
    try {
      const res = await fetch("/api/whitney", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, message }),
      });
      const data = (await res.json()) as {
        reply?: string;
        conversationId?: string | null;
        error?: string;
      };
      if (!res.ok || !data.reply) {
        // Roll the message back into the input so nothing is lost.
        setMessages((m) => m.slice(0, -1));
        setInput(message);
        setError(data.error ?? "Whitney hit a snag — try again in a moment.");
        return;
      }
      setMessages((m) => [...m, { role: "assistant", content: data.reply! }]);
      if (data.conversationId && !conversationId) {
        setConversationId(data.conversationId);
        setConvos((c) => [
          { id: data.conversationId!, title: message.slice(0, 80) },
          ...c,
        ]);
        // Keep the URL shareable across refreshes without re-rendering.
        window.history.replaceState(null, "", `/whitney?c=${data.conversationId}`);
      }
    } catch {
      setMessages((m) => m.slice(0, -1));
      setInput(message);
      setError("Whitney hit a snag — try again in a moment.");
    } finally {
      setSending(false);
    }
  }

  function openConversation(id: string) {
    if (id === conversationId || sending) return;
    startTransition(() => {
      router.push(`/whitney?c=${id}`);
    });
  }

  function newConversation() {
    if (sending) return;
    setConversationId(null);
    setMessages([]);
    setError(null);
    window.history.replaceState(null, "", "/whitney?c=new");
  }

  async function removeConversation(id: string) {
    if (!window.confirm("Delete this conversation? This can't be undone.")) {
      return;
    }
    const res = await deleteWhitneyConversation(id);
    if (!res.ok) {
      setError(res.message ?? "Couldn't delete — try again.");
      return;
    }
    setConvos((c) => c.filter((x) => x.id !== id));
    if (id === conversationId) {
      setConversationId(null);
      setMessages([]);
      window.history.replaceState(null, "", "/whitney?c=new");
    }
  }

  return (
    <div className="whitney-grid">
      <div className="whitney-side">
        <button type="button" className="whitney-new" onClick={newConversation}>
          New conversation
        </button>
        <div className="whitney-list">
          {convos.length === 0 && (
            <p className="whitney-list-empty">
              Your past conversations will appear here — only you can see them.
            </p>
          )}
          {convos.map((c) => (
            <div
              key={c.id}
              className={`whitney-item${c.id === conversationId ? " active" : ""}`}
            >
              <button
                type="button"
                className="whitney-item-open"
                onClick={() => openConversation(c.id)}
                title={c.title}
              >
                {c.title}
              </button>
              <button
                type="button"
                className="whitney-item-del"
                aria-label="Delete conversation"
                onClick={() => removeConversation(c.id)}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="whitney-thread">
        <div className="whitney-msgs">
          {messages.length === 0 && !sending && (
            <div className="whitney-intro">
              <h3>Whitney by SLC</h3>
              <p>
                A place to slow down and think something through. No advice, no
                answers — just careful questions. Start wherever you are.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`whitney-msg ${m.role === "user" ? "user" : "whitney"}`}
            >
              {m.content}
            </div>
          ))}
          {sending && <div className="whitney-msg whitney typing">&hellip;</div>}
          <div ref={endRef} />
        </div>
        {error && <p className="whitney-error">{error}</p>}
        <div className="whitney-input-row">
          <textarea
            className="whitney-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="What's on your mind?"
            rows={2}
            maxLength={4000}
            disabled={sending}
            aria-label="Message Whitney"
          />
          <button
            type="button"
            className="whitney-send"
            onClick={() => void send()}
            disabled={sending || input.trim().length === 0}
          >
            Send
          </button>
        </div>
        <p className="whitney-note">
          Private to you. Whitney is a reflection tool, not advice or
          counseling.
        </p>
      </div>
    </div>
  );
}
