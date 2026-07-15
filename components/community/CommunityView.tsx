"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  directMessages,
  onlineMembers,
  pinnedMessage,
  placeholderMessages,
  type ChatMessage,
} from "@/lib/community-data";
import { ChannelIcon } from "@/components/icons";

interface ChannelInfo {
  id: string;
  name: string;
  description: string;
  adminPostOnly: boolean;
  allowed: boolean;
  lockLabel?: string;
}

interface CommunityViewProps {
  channels: ChannelInfo[];
  memberName: string;
  memberInitials: string;
  isAdmin: boolean;
  streamConfigured: boolean;
  /** True only when no Supabase env exists (demo fixtures allowed). */
  preview: boolean;
  nextSession: { dateLabel: string; title: string; meta: string };
}

type StreamHandle = {
  client: import("stream-chat").StreamChat;
  channels: Map<string, import("stream-chat").Channel>;
};

function nowLabel(): string {
  return (
    "Today at " +
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date())
  );
}

export function CommunityView({
  channels,
  memberName,
  memberInitials,
  isAdmin,
  streamConfigured,
  preview,
  nextSession,
}: CommunityViewProps) {
  const [activeId, setActiveId] = useState(
    channels.find((c) => c.allowed)?.id ?? "general",
  );
  const [messagesByChannel, setMessagesByChannel] = useState<
    Record<string, ChatMessage[]>
  >(() => (preview ? { ...placeholderMessages } : {}));
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState(false); // true once Stream is connected
  const streamRef = useRef<StreamHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = channels.find((c) => c.id === activeId) ?? channels[0];
  const messages = messagesByChannel[activeId] ?? [];
  const canPost = active.allowed && (!active.adminPostOnly || isAdmin);

  // Connect to Stream when configured; otherwise stay in preview mode.
  useEffect(() => {
    if (!streamConfigured) return;
    let cancelled = false;

    async function connect() {
      try {
        const res = await fetch("/api/stream/token", { method: "POST" });
        if (!res.ok) return;
        const cfg = (await res.json()) as {
          apiKey: string;
          token: string;
          userId: string;
          userName: string;
          channels: { id: string; name: string }[];
        };
        const { StreamChat } = await import("stream-chat");
        const client = StreamChat.getInstance(cfg.apiKey);
        await client.connectUser(
          { id: cfg.userId, name: cfg.userName },
          cfg.token,
        );
        if (cancelled) return;

        const chans = new Map<string, import("stream-chat").Channel>();
        const byChannel: Record<string, ChatMessage[]> = {};
        for (const ch of cfg.channels) {
          const channel = client.channel("messaging", ch.id);
          await channel.watch();
          chans.set(ch.id, channel);
          byChannel[ch.id] = channel.state.messages.map((m) => ({
            id: m.id,
            authorName: m.user?.name ?? "Member",
            authorInitials: (m.user?.name ?? "M")
              .split(" ")
              .map((p) => p[0])
              .slice(0, 2)
              .join("")
              .toUpperCase(),
            avatarBg: "#1C3050",
            avatarColor: "#D4AE75",
            isYou: m.user?.id === cfg.userId,
            timeLabel: m.created_at
              ? new Date(m.created_at).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "",
            paragraphs: [m.text ?? ""],
            reactions: [],
          }));
          channel.on("message.new", (event) => {
            const m = event.message;
            if (!m) return;
            setMessagesByChannel((prev) => ({
              ...prev,
              [ch.id]: [
                ...(prev[ch.id] ?? []),
                {
                  id: m.id,
                  authorName: m.user?.name ?? "Member",
                  authorInitials: (m.user?.name ?? "M").slice(0, 2).toUpperCase(),
                  avatarBg: "#1C3050",
                  avatarColor: "#D4AE75",
                  isYou: m.user?.id === cfg.userId,
                  timeLabel: nowLabel(),
                  paragraphs: [m.text ?? ""],
                  reactions: [],
                },
              ],
            }));
          });
        }
        streamRef.current = { client, channels: chans };
        setMessagesByChannel((prev) => ({ ...prev, ...byChannel }));
        setLive(true);
      } catch {
        // stay in preview mode
      }
    }

    void connect();
    return () => {
      cancelled = true;
      void streamRef.current?.client.disconnectUser();
      streamRef.current = null;
    };
  }, [streamConfigured]);

  // Keep scrolled to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId, messages.length]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !canPost) return;
    setDraft("");

    const handle = streamRef.current;
    if (live && handle) {
      await handle.channels.get(activeId)?.sendMessage({ text });
      return; // message arrives via the message.new listener
    }

    // Preview mode: append locally.
    setMessagesByChannel((prev) => ({
      ...prev,
      [activeId]: [
        ...(prev[activeId] ?? []),
        {
          id: `local-${prev[activeId]?.length ?? 0}-${activeId}`,
          authorName: memberName,
          authorInitials: memberInitials,
          avatarBg: "linear-gradient(135deg,var(--gold),var(--gold-light))",
          avatarColor: "var(--navy)",
          isYou: true,
          timeLabel: nowLabel(),
          paragraphs: [text],
          reactions: [],
        },
      ],
    }));
  }, [draft, canPost, live, activeId, memberName, memberInitials]);

  return (
    <div className="chat-wrap">
      {/* Channels rail */}
      <div className="chat-channels">
        <div className="chat-channels-header">Channels</div>
        {channels.map((ch) => (
          <button
            key={ch.id}
            type="button"
            className={`channel-item${ch.id === activeId ? " active" : ""}${
              ch.allowed ? "" : " locked"
            }`}
            onClick={() => ch.allowed && setActiveId(ch.id)}
            title={ch.allowed ? ch.description : ch.lockLabel}
          >
            <ChannelIcon size={14} />
            {ch.name}
            {!ch.allowed && <span className="channel-lock">{ch.lockLabel}</span>}
          </button>
        ))}
        <div className="chat-channels-header" style={{ marginTop: 12 }}>
          Direct Messages
        </div>
        {!preview && !live && (
          <div style={{ padding: "4px 16px", fontSize: 12, color: "var(--mid-gray)" }}>
            Available when chat goes live
          </div>
        )}
        {(preview ? directMessages : []).map((dm) => (
          <button key={dm.name} type="button" className="channel-item">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: dm.online ? "var(--accent-green)" : "var(--mid-gray)",
                flexShrink: 0,
              }}
            />
            {dm.name}
          </button>
        ))}
      </div>

      {/* Main chat */}
      <div className="chat-main">
        <div className="chat-topbar">
          <ChannelIcon size={16} />
          <div>
            <div className="chat-topbar-name">{active.name}</div>
            <div className="chat-topbar-desc">{active.description}</div>
          </div>
        </div>

        <div className="chat-messages" ref={scrollRef}>
          {messages.length === 0 ? (
            <div style={{ color: "var(--mid-gray)", fontSize: 13 }}>
              No messages here yet — start the conversation.
            </div>
          ) : (
            messages.map((m) => (
              <div className="msg-group" key={m.id}>
                <div
                  className="msg-av"
                  style={{ background: m.avatarBg, color: m.avatarColor }}
                >
                  {m.authorInitials}
                </div>
                <div className="msg-content">
                  <div className="msg-meta">
                    <span className="msg-name">{m.authorName}</span>
                    {m.isYou && <span className="msg-you-tag">You</span>}
                    <span className="msg-time">{m.timeLabel}</span>
                  </div>
                  {m.paragraphs.map((p, i) => (
                    <div className="msg-bubble" key={i}>
                      {p}
                    </div>
                  ))}
                  {m.reactions.length > 0 && (
                    <div>
                      {m.reactions.map((r, i) => (
                        <button className="msg-reaction" key={i} type="button">
                          <span
                            className="reaction-dot"
                            style={{ background: r.color }}
                          />
                          <span>{r.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {!live && (
          <div className="chat-preview-note">
            {preview
              ? "Preview mode — messages aren't saved. Community goes live once Stream Chat is connected."
              : "Community chat goes live once Stream Chat is connected — messages aren't saved yet."}
          </div>
        )}
        <div className="chat-input-area">
          <div className="chat-input-box">
            <input
              type="text"
              placeholder={
                canPost
                  ? `Message #${active.name}`
                  : active.adminPostOnly
                    ? "Only admins can post in this channel"
                    : "Upgrade your membership to join this channel"
              }
              value={draft}
              disabled={!canPost}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              className="chat-icon-btn"
              style={{ color: "var(--gold)" }}
              type="button"
              onClick={() => void send()}
              disabled={!canPost}
              aria-label="Send message"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2L2 6.5l5 2 2 5z" />
                <path d="M7 8.5l4-4" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Right sidebar */}
      <div className="chat-sidebar-right">
        <div className="chat-sidebar-section">
          <div className="chat-sidebar-title">
            Online Now{preview ? ` (${onlineMembers.filter((m) => m.online).length})` : ""}
          </div>
          {!preview && (
            <div style={{ fontSize: 12, color: "var(--mid-gray)" }}>
              Presence appears when chat goes live.
            </div>
          )}
          {(preview ? onlineMembers : []).map((m) => (
            <div className="online-member" key={m.name}>
              <div
                className="online-dot"
                style={m.online ? undefined : { background: "var(--mid-gray)" }}
              />
              <span
                className="online-name"
                style={m.online ? undefined : { color: "var(--mid-gray)" }}
              >
                {m.name}
              </span>
            </div>
          ))}
        </div>
        <div className="chat-sidebar-section">
          <div className="chat-sidebar-title">Pinned</div>
          <div className="pinned-msg">
            <strong>{pinnedMessage.title}</strong>
            <br />
            {pinnedMessage.body}
          </div>
        </div>
        <div className="chat-sidebar-section">
          <div className="chat-sidebar-title">Upcoming</div>
          <div className="upcoming-mini">
            <div className="um-date">{nextSession.dateLabel}</div>
            <div className="um-title">{nextSession.title}</div>
            <div className="um-meta">{nextSession.meta}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
