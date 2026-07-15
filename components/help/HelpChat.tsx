"use client";

import { useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const OPENER: Msg = {
  role: "assistant",
  content:
    "Hi — I'm the Momentum+ helper. Ask me anything about using the platform: joining sessions, watching recordings, earning certificates, managing your membership, and more.",
};

/**
 * Floating AI help chat, available on every portal page. Answers "how do I…"
 * questions about the platform via /api/help-chat (Anthropic key from
 * Admin → Connections).
 */
export function HelpChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([OPENER]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, busy, open]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/help-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The opener is UI-only — send the real conversation.
        body: JSON.stringify({ messages: next.slice(1) }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
      };
      setMessages((cur) => [
        ...cur,
        {
          role: "assistant",
          content:
            data.reply ??
            data.error ??
            "The helper hit a snag — try again in a moment.",
        },
      ]);
    } catch {
      setMessages((cur) => [
        ...cur,
        {
          role: "assistant",
          content: "The helper hit a snag — check your connection and try again.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open && (
        <div className="help-panel" role="dialog" aria-label="Momentum+ help chat">
          <div className="help-head">
            <div>
              <div className="help-title">Need a hand?</div>
              <div className="help-sub">Momentum+ AI helper</div>
            </div>
            <button
              type="button"
              className="help-close"
              aria-label="Close help chat"
              onClick={() => setOpen(false)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="help-body" ref={bodyRef}>
            {messages.map((m, i) => (
              <div
                key={i}
                className={`help-msg ${m.role === "user" ? "user" : "bot"}`}
              >
                {m.content}
              </div>
            ))}
            {busy && <div className="help-msg bot help-typing">Thinking…</div>}
          </div>
          <form className="help-input-row" onSubmit={send}>
            <input
              ref={inputRef}
              type="text"
              className="help-input"
              placeholder="Ask about Momentum+…"
              value={input}
              maxLength={2000}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              type="submit"
              className="help-send"
              disabled={busy || !input.trim()}
              aria-label="Send"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22,2 15,22 11,13 2,9" />
              </svg>
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        className="help-fab"
        aria-label={open ? "Close help chat" : "Open help chat"}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>
    </>
  );
}
