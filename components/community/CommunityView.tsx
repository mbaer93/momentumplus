"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  directMessages,
  onlineMembers,
  pinnedMessage,
  placeholderMessages,
  type ChatMessage,
} from "@/lib/community-data";
import { ArrowLeftIcon, ChannelIcon } from "@/components/icons";

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
  /** The viewer's admin title (shown on their own messages when admin). */
  adminTitle: string | null;
  streamConfigured: boolean;
  /** True only when no Supabase env exists (demo fixtures allowed). */
  preview: boolean;
  nextSession: { dateLabel: string; title: string; meta: string };
}

type StreamHandle = {
  client: import("stream-chat").StreamChat;
  channels: Map<string, import("stream-chat").Channel>;
  userId: string;
};

interface DmInfo {
  id: string;
  otherName: string;
}

interface DirectoryMember {
  id: string;
  name: string;
  detail: string;
}

/** Stream user with our custom adminTitle field (set server-side on upsert). */
function adminTitleOf(user: unknown): string | null {
  const t = (user as { adminTitle?: unknown } | undefined)?.adminTitle;
  return typeof t === "string" && t.length > 0 ? t : null;
}

function nowLabel(): string {
  return (
    "Today at " +
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date())
  );
}

function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface StreamMessageLike {
  id: string;
  text?: string;
  created_at?: string | Date;
  user?: { id?: string; name?: string; role?: string } | null;
}

function toChatMessage(
  m: StreamMessageLike,
  viewerId: string,
  liveTime = false,
): ChatMessage {
  return {
    id: m.id,
    authorName: m.user?.name ?? "Member",
    authorInitials: initialsOf(m.user?.name ?? "M"),
    avatarBg: "#1C3050",
    avatarColor: "#D4AE75",
    isYou: m.user?.id === viewerId,
    authorIsAdmin: m.user?.role === "admin",
    adminTitle: adminTitleOf(m.user),
    timeLabel: liveTime
      ? nowLabel()
      : m.created_at
        ? new Date(m.created_at).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })
        : "",
    paragraphs: [m.text ?? ""],
    reactions: [],
  };
}

/** The DM partner's display name from a two-member channel. */
function dmPartnerName(
  channel: import("stream-chat").Channel,
  viewerId: string,
): string {
  const members = Object.values(channel.state.members ?? {});
  const other = members.find((m) => m.user?.id !== viewerId);
  return other?.user?.name ?? "Member";
}

export function CommunityView({
  channels,
  memberName,
  memberInitials,
  isAdmin,
  adminTitle,
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
  const [sendError, setSendError] = useState<string | null>(null);
  // Phones show one pane at a time: the channel list, or (after picking a
  // channel) the conversation with a back button. Desktop shows both panes
  // side by side and ignores this flag entirely (CSS-controlled).
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [live, setLive] = useState(false); // true once Stream is connected
  const [connectError, setConnectError] = useState<string | null>(null);
  const [dms, setDms] = useState<DmInfo[]>([]);
  const [dmPickerOpen, setDmPickerOpen] = useState(false);
  const [directory, setDirectory] = useState<DirectoryMember[] | null>(null);
  const [dmSearch, setDmSearch] = useState("");
  const streamRef = useRef<StreamHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeDm = dms.find((d) => d.id === activeId) ?? null;
  const active: ChannelInfo = activeDm
    ? {
        id: activeDm.id,
        name: activeDm.otherName,
        description: "Direct message — just the two of you",
        adminPostOnly: false,
        allowed: true,
      }
    : (channels.find((c) => c.id === activeId) ?? channels[0]);
  const messages = messagesByChannel[activeId] ?? [];
  // In configured (non-preview) mode the input is only live once Stream is
  // actually connected — the old behavior kept it enabled and "sent" into
  // local state, which looked delivered but vanished on refresh.
  const canPost =
    active.allowed && (!active.adminPostOnly || isAdmin) && (preview || live);

  // Wire a Stream channel into local state: seed history + live listeners.
  const wireChannel = useCallback(
    (channel: import("stream-chat").Channel, key: string, viewerId: string) => {
      setMessagesByChannel((prev) => ({
        ...prev,
        [key]: channel.state.messages.map((m) => toChatMessage(m, viewerId)),
      }));
      channel.on("message.new", (event) => {
        const m = event.message;
        if (!m) return;
        setMessagesByChannel((prev) => ({
          ...prev,
          [key]: [...(prev[key] ?? []), toChatMessage(m, viewerId, true)],
        }));
      });
      channel.on("message.deleted", (event) => {
        const deletedId = event.message?.id;
        if (!deletedId) return;
        setMessagesByChannel((prev) => ({
          ...prev,
          [key]: (prev[key] ?? []).filter((x) => x.id !== deletedId),
        }));
      });
    },
    [],
  );

  // Connect to Stream when configured; otherwise stay in preview mode.
  useEffect(() => {
    if (!streamConfigured) return;
    let cancelled = false;

    async function connect() {
      try {
        const res = await fetch("/api/stream/token", { method: "POST" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setConnectError(body.error ?? `Token request failed (${res.status})`);
          return;
        }
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
        for (const ch of cfg.channels) {
          const channel = client.channel("messaging", ch.id);
          await channel.watch();
          chans.set(ch.id, channel);
          wireChannel(channel, ch.id, cfg.userId);
        }
        streamRef.current = { client, channels: chans, userId: cfg.userId };
        setLive(true);

        // Existing direct messages: two-member distinct channels that
        // aren't one of the community rooms.
        const communityIds = new Set(cfg.channels.map((c) => c.id));
        try {
          const dmChannels = await client.queryChannels(
            {
              type: "messaging",
              members: { $in: [cfg.userId] },
              member_count: 2,
            },
            { last_message_at: -1 },
            { limit: 30, watch: true },
          );
          if (cancelled) return;
          const found: DmInfo[] = [];
          for (const ch of dmChannels) {
            const key = ch.id ?? ch.cid;
            if (!key || communityIds.has(key)) continue;
            chans.set(key, ch);
            wireChannel(ch, key, cfg.userId);
            found.push({ id: key, otherName: dmPartnerName(ch, cfg.userId) });
          }
          setDms(found);
        } catch {
          // DM listing is best-effort; group chat stays up regardless.
        }
      } catch (e) {
        // Stay in the local fallback, but surface why for admins.
        setConnectError((e as Error).message || "Connection failed");
      }
    }

    void connect();
    return () => {
      cancelled = true;
      void streamRef.current?.client.disconnectUser();
      streamRef.current = null;
    };
  }, [streamConfigured, wireChannel]);

  // Keep scrolled to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId, messages.length]);

  // Open (or create) the one-on-one thread with a member.
  const startDm = useCallback(
    async (other: DirectoryMember) => {
      const handle = streamRef.current;
      if (!handle) return;
      setDmPickerOpen(false);
      try {
        const channel = handle.client.channel("messaging", {
          members: [handle.userId, other.id],
        });
        await channel.watch();
        const key = channel.id ?? channel.cid;
        if (!key) return;
        if (!handle.channels.has(key)) {
          handle.channels.set(key, channel);
          wireChannel(channel, key, handle.userId);
        }
        setDms((prev) =>
          prev.some((d) => d.id === key)
            ? prev
            : [{ id: key, otherName: other.name }, ...prev],
        );
        setActiveId(key);
        setMobileChatOpen(true);
      } catch (e) {
        setConnectError(
          `Couldn't open that conversation: ${(e as Error).message}`,
        );
      }
    },
    [wireChannel],
  );

  async function openDmPicker() {
    setDmPickerOpen(true);
    if (directory !== null) return;
    try {
      const res = await fetch("/api/community/members");
      const data = (await res.json()) as { members?: DirectoryMember[] };
      setDirectory(data.members ?? []);
    } catch {
      setDirectory([]);
    }
  }

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !canPost) return;
    setSendError(null);

    const handle = streamRef.current;
    if (live && handle) {
      const channel = handle.channels.get(activeId);
      if (!channel) {
        setSendError("This channel isn't connected — refresh and try again.");
        return;
      }
      // Clear the draft only AFTER the send succeeds — a failed send used
      // to silently eat the message.
      try {
        await channel.sendMessage({ text });
        setDraft("");
      } catch {
        setSendError(
          "Your message didn't send — check your connection and try again. Your text is still in the box.",
        );
      }
      return; // message arrives via the message.new listener
    }
    setDraft("");

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
          authorIsAdmin: isAdmin,
          adminTitle,
          timeLabel: nowLabel(),
          paragraphs: [text],
          reactions: [],
        },
      ],
    }));
  }, [draft, canPost, live, activeId, memberName, memberInitials, isAdmin, adminTitle]);

  // Switching conversations clears a stale send error.
  useEffect(() => setSendError(null), [activeId]);

  // Admin moderation: remove a message everywhere (Stream when live, local
  // state otherwise — the message.deleted event also syncs other viewers).
  const deleteMessage = useCallback(
    async (id: string) => {
      if (!isAdmin) return;
      if (!confirm("Delete this message for everyone?")) return;
      const handle = streamRef.current;
      if (live && handle) {
        try {
          await handle.client.deleteMessage(id, true);
        } catch {
          return; // leave the message if Stream refused the delete
        }
      }
      setMessagesByChannel((prev) => ({
        ...prev,
        [activeId]: (prev[activeId] ?? []).filter((m) => m.id !== id),
      }));
    },
    [isAdmin, live, activeId],
  );

  const filteredDirectory = (directory ?? []).filter((m) =>
    m.name.toLowerCase().includes(dmSearch.trim().toLowerCase()),
  );

  return (
    <div className={`chat-wrap${mobileChatOpen ? " chat-open" : ""}`}>
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
            onClick={() => {
              if (!ch.allowed) return;
              setActiveId(ch.id);
              setMobileChatOpen(true);
            }}
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
        {live && (
          <button
            type="button"
            className="channel-item"
            style={{ color: "var(--gold)" }}
            onClick={() => void openDmPicker()}
          >
            + New message
          </button>
        )}
        {!preview && !live && (
          <div style={{ padding: "4px 16px", fontSize: 12, color: "var(--mid-gray)" }}>
            Available when chat goes live
          </div>
        )}
        {dms.map((dm) => (
          <button
            key={dm.id}
            type="button"
            className={`channel-item${dm.id === activeId ? " active" : ""}`}
            onClick={() => {
              setActiveId(dm.id);
              setMobileChatOpen(true);
            }}
            title={`Direct message with ${dm.otherName}`}
          >
            <span className="dm-avatar-mini">{initialsOf(dm.otherName)}</span>
            {dm.otherName}
          </button>
        ))}
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
          <button
            type="button"
            className="chat-back"
            aria-label="Back to channels"
            onClick={() => setMobileChatOpen(false)}
          >
            <ArrowLeftIcon size={14} />
          </button>
          <ChannelIcon size={16} />
          <div>
            <div className="chat-topbar-name">{active.name}</div>
            <div className="chat-topbar-desc">{active.description}</div>
          </div>
        </div>

        <div className="chat-messages" ref={scrollRef}>
          {messages.length === 0 ? (
            <div style={{ color: "var(--mid-gray)", fontSize: 13 }}>
              {activeDm
                ? `This is the very start of your conversation with ${activeDm.otherName}.`
                : "No messages here yet — start the conversation."}
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
                    {m.authorIsAdmin && (
                      <span className="msg-admin-tag">
                        Admin{m.adminTitle ? ` · ${m.adminTitle}` : ""}
                      </span>
                    )}
                    {m.isYou && <span className="msg-you-tag">You</span>}
                    <span className="msg-time">{m.timeLabel}</span>
                    {isAdmin && (
                      <button
                        type="button"
                        className="msg-delete-btn"
                        onClick={() => void deleteMessage(m.id)}
                        title="Delete message (admin)"
                        aria-label="Delete message"
                      >
                        Delete
                      </button>
                    )}
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
              : "Chat is reconnecting — sending is paused so nothing gets lost. Refresh if this lingers."}
            {!preview && isAdmin && (
              <>
                {" "}
                {connectError
                  ? `Admin detail: ${connectError}`
                  : !streamConfigured
                    ? "Admin detail: add NEXT_PUBLIC_STREAM_API_KEY and STREAM_API_SECRET in Vercel, then redeploy."
                    : null}
              </>
            )}
          </div>
        )}
        {live && connectError && (
          <div className="chat-preview-note">{connectError}</div>
        )}
        {sendError && (
          <div className="chat-preview-note" style={{ color: "var(--accent-red)" }}>
            {sendError}
          </div>
        )}
        <div className="chat-input-area">
          <div className="chat-input-box">
            <input
              type="text"
              placeholder={
                canPost
                  ? activeDm
                    ? `Message ${activeDm.otherName}`
                    : `Message #${active.name}`
                  : !preview && !live && active.allowed
                    ? "Chat is reconnecting…"
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

      {/* New-DM member picker */}
      {dmPickerOpen && (
        <div className="dm-picker-backdrop" onClick={() => setDmPickerOpen(false)}>
          <div className="dm-picker" onClick={(e) => e.stopPropagation()}>
            <div className="dm-picker-head">
              <span>New direct message</span>
              <button
                type="button"
                className="help-close"
                style={{ color: "var(--ink)" }}
                aria-label="Close"
                onClick={() => setDmPickerOpen(false)}
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
            <input
              type="text"
              className="dm-picker-search"
              placeholder="Search members…"
              value={dmSearch}
              autoFocus
              onChange={(e) => setDmSearch(e.target.value)}
            />
            <div className="dm-picker-list">
              {directory === null ? (
                <div className="dm-picker-empty">Loading members…</div>
              ) : filteredDirectory.length === 0 ? (
                <div className="dm-picker-empty">No members match.</div>
              ) : (
                filteredDirectory.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="dm-picker-item"
                    onClick={() => void startDm(m)}
                  >
                    <span className="dm-avatar-mini">{initialsOf(m.name)}</span>
                    <span>
                      <span className="dm-picker-name">{m.name}</span>
                      {m.detail && (
                        <span className="dm-picker-detail">{m.detail}</span>
                      )}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
