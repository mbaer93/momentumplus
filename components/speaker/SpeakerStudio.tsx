"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  sendSessionNotice,
  updateOwnResource,
  updateOwnSpeakerPage,
  uploadOwnHeadshot,
  uploadOwnResourceLogo,
  updateOwnVideo,
} from "@/app/(portal)/speaker/actions";

export interface StudioSession {
  id: string;
  title: string;
  startsAt: string | null;
  status: string;
  hasMeeting: boolean;
  enrolled: number;
}

export interface StudioVideo {
  id: string;
  title: string;
  category: string;
  published: boolean;
}

function whenLabel(iso: string | null): string {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export function SpeakerStudio({
  speaker,
  resource,
  sessions,
  videos,
  startError,
}: {
  speaker: {
    name: string;
    title: string;
    bio: string;
    industries: string;
    expiresAt: string | null;
    headshotUrl: string | null;
    /** Set while the speaker is pre-season (hidden from members): the date
        their page and community access open up. Null once live. */
    goLiveLabel?: string | null;
  };
  resource: {
    title: string;
    description: string;
    url: string;
    imageUrl: string | null;
  };
  sessions: StudioSession[];
  videos: StudioVideo[];
  startError: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [page, setPage] = useState(speaker);
  const [biz, setBiz] = useState(resource);
  const [videoEdits, setVideoEdits] = useState<Record<string, { title: string; category: string }>>({});
  const [noticeFor, setNoticeFor] = useState<string | null>(null);
  const [notice, setNotice] = useState({ subject: "", message: "", linkUrl: "" });
  const [noticeFile, setNoticeFile] = useState<File | null>(null);
  const [headshotFile, setHeadshotFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg(res.message ? { text: res.message, ok: res.ok } : null);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="admin-pad" style={{ maxWidth: 900 }}>
      <div className="section-header">
        <div>
          <h2>Speaker Studio</h2>
          <p>
            Your pages, your sessions, your audience
            {speaker.expiresAt
              ? ` — access through ${new Date(speaker.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
              : ""}
          </p>
        </div>
      </div>

      {speaker.goLiveLabel && (
        <div className="admin-hint">
          Your speaker page opens to members on{" "}
          <strong>{speaker.goLiveLabel}</strong> — until then it&apos;s hidden
          from the directory and community. Build everything here now; it all
          goes live automatically.
        </div>
      )}
      {startError && <div className="login-error">{startError}</div>}
      {msg && (
        <div className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>
      )}

      {/* Sessions + audience tools */}
      <div className="admin-form" style={{ maxWidth: "none", marginBottom: 20 }}>
        <div className="admin-field" style={{ marginBottom: 6 }}>
          <label style={{ fontSize: 13 }}>Your sessions</label>
        </div>
        {sessions.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--mid-gray)" }}>
            No sessions assigned yet — the Momentum+ team schedules these with
            you.
          </div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            style={{
              borderTop: "1px solid var(--warm-gray)",
              padding: "12px 0",
            }}
          >
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.title}</div>
                <div style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
                  {whenLabel(s.startsAt)} ET · {s.enrolled} enrolled ·{" "}
                  <span style={{ textTransform: "capitalize" }}>{s.status}</span>
                </div>
              </div>
              {s.hasMeeting && s.status !== "archived" && (
                <a className="btn-mini" href={`/api/sessions/${s.id}/start`}>
                  Start Zoom (host)
                </a>
              )}
              <button
                type="button"
                className="btn-mini"
                onClick={() => {
                  setNoticeFor(noticeFor === s.id ? null : s.id);
                  setMsg(null);
                }}
              >
                {noticeFor === s.id ? "Close notice" : "Message enrollees"}
              </button>
            </div>

            {noticeFor === s.id && (
              <div style={{ marginTop: 12, background: "#fbfaf8", borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 10 }}>
                  Goes by email to all {s.enrolled} enrolled member
                  {s.enrolled === 1 ? "" : "s"}. You won&apos;t see their
                  addresses — Momentum+ delivers it for you. Attach a document
                  or video, or paste a link.
                </div>
                <div className="admin-field">
                  <label htmlFor={`n-subject-${s.id}`}>Subject</label>
                  <input
                    id={`n-subject-${s.id}`}
                    value={notice.subject}
                    onChange={(e) => setNotice({ ...notice, subject: e.target.value })}
                    placeholder="e.g. Pre-session worksheet for Tuesday"
                  />
                </div>
                <div className="admin-field">
                  <label htmlFor={`n-message-${s.id}`}>Message</label>
                  <textarea
                    id={`n-message-${s.id}`}
                    rows={4}
                    value={notice.message}
                    onChange={(e) => setNotice({ ...notice, message: e.target.value })}
                    style={{ width: "100%", resize: "vertical" }}
                  />
                </div>
                <div className="admin-field-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <div className="admin-field">
                    <label htmlFor={`n-link-${s.id}`}>Link (optional)</label>
                    <input
                      id={`n-link-${s.id}`}
                      type="url"
                      value={notice.linkUrl}
                      onChange={(e) => setNotice({ ...notice, linkUrl: e.target.value })}
                      placeholder="https://…"
                    />
                  </div>
                  <div className="admin-field">
                    <label htmlFor={`n-file-${s.id}`}>
                      Attach (PDF, Word, PowerPoint, image, MP4 — 25 MB max)
                    </label>
                    <input
                      id={`n-file-${s.id}`}
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.mp4,.docx,.pptx"
                      onChange={(e) => setNoticeFile(e.target.files?.[0] ?? null)}
                      style={{ fontSize: 12 }}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-mini"
                  disabled={pending || !notice.subject.trim() || !notice.message.trim()}
                  onClick={() =>
                    run(async () => {
                      const fd = new FormData();
                      fd.append("sessionId", s.id);
                      fd.append("subject", notice.subject);
                      fd.append("message", notice.message);
                      fd.append("linkUrl", notice.linkUrl);
                      if (noticeFile) fd.append("file", noticeFile);
                      const res = await sendSessionNotice(fd);
                      if (res.ok) {
                        setNotice({ subject: "", message: "", linkUrl: "" });
                        setNoticeFile(null);
                        setNoticeFor(null);
                      }
                      return res;
                    })
                  }
                >
                  {pending ? "Sending…" : `Send to ${s.enrolled} member${s.enrolled === 1 ? "" : "s"}`}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Speaker page editor */}
      <div className="admin-form" style={{ maxWidth: "none", marginBottom: 20 }}>
        <div className="admin-field" style={{ marginBottom: 6 }}>
          <label style={{ fontSize: 13 }}>Your speaker page</label>
        </div>
        <div className="admin-field-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="admin-field">
            <label htmlFor="sp-page-name">Name</label>
            <input
              id="sp-page-name"
              value={page.name}
              onChange={(e) => setPage({ ...page, name: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label htmlFor="sp-page-title">Title</label>
            <input
              id="sp-page-title"
              value={page.title}
              onChange={(e) => setPage({ ...page, title: e.target.value })}
            />
          </div>
        </div>
        <div className="admin-field">
          <label htmlFor="sp-page-bio">Bio</label>
          <textarea
            id="sp-page-bio"
            rows={4}
            value={page.bio}
            onChange={(e) => setPage({ ...page, bio: e.target.value })}
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>
        <div className="admin-field">
          <label htmlFor="sp-page-ind">Topics / industries (comma-separated)</label>
          <input
            id="sp-page-ind"
            value={page.industries}
            onChange={(e) => setPage({ ...page, industries: e.target.value })}
          />
        </div>
        <div className="admin-field">
          <label htmlFor="sp-headshot">
            Headshot — square crop looks best (PNG/JPG/WebP, under 4 MB)
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {speaker.headshotUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={speaker.headshotUrl}
                alt="Current headshot"
                style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }}
              />
            )}
            <input
              id="sp-headshot"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setHeadshotFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="btn-mini"
              disabled={pending || !headshotFile}
              onClick={() =>
                run(async () => {
                  const fd = new FormData();
                  fd.append("file", headshotFile as File);
                  const res = await uploadOwnHeadshot(fd);
                  if (res.ok) setHeadshotFile(null);
                  return res;
                })
              }
            >
              {speaker.headshotUrl ? "Replace headshot" : "Upload headshot"}
            </button>
          </div>
        </div>
        <div className="admin-form-actions" style={{ marginTop: 4 }}>
          <button
            type="button"
            className="btn-mini"
            disabled={pending}
            onClick={() => run(() => updateOwnSpeakerPage(page))}
          >
            Save speaker page
          </button>
        </div>
      </div>

      {/* Business resource editor */}
      <div className="admin-form" style={{ maxWidth: "none", marginBottom: 20 }}>
        <div className="admin-field" style={{ marginBottom: 6 }}>
          <label style={{ fontSize: 13 }}>
            Your business resource — shown to members under Resources
          </label>
        </div>
        <div className="admin-field-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="admin-field">
            <label htmlFor="sp-biz-title">Business / product name</label>
            <input
              id="sp-biz-title"
              value={biz.title}
              onChange={(e) => setBiz({ ...biz, title: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label htmlFor="sp-biz-url">Link</label>
            <input
              id="sp-biz-url"
              type="url"
              value={biz.url}
              onChange={(e) => setBiz({ ...biz, url: e.target.value })}
              placeholder="https://…"
            />
          </div>
        </div>
        <div className="admin-field">
          <label htmlFor="sp-biz-desc">Description</label>
          <textarea
            id="sp-biz-desc"
            rows={3}
            value={biz.description}
            onChange={(e) => setBiz({ ...biz, description: e.target.value })}
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>
        <div className="admin-field">
          <label htmlFor="sp-biz-logo">
            Logo / card image (PNG/JPG/WebP, under 4 MB)
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {resource.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resource.imageUrl}
                alt="Current logo"
                style={{ width: 64, height: 48, borderRadius: 4, objectFit: "contain", background: "#fff", border: "1px solid var(--border)" }}
              />
            )}
            <input
              id="sp-biz-logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="btn-mini"
              disabled={pending || !logoFile}
              onClick={() =>
                run(async () => {
                  const fd = new FormData();
                  fd.append("file", logoFile as File);
                  const res = await uploadOwnResourceLogo(fd);
                  if (res.ok) setLogoFile(null);
                  return res;
                })
              }
            >
              {resource.imageUrl ? "Replace logo" : "Upload logo"}
            </button>
          </div>
          {!resource.title && (
            <p style={{ fontSize: 12, color: "var(--mid-gray)", marginTop: 4 }}>
              Save your resource page first — the logo attaches to it.
            </p>
          )}
        </div>
        <div className="admin-form-actions" style={{ marginTop: 4 }}>
          <button
            type="button"
            className="btn-mini"
            disabled={pending || !biz.title.trim()}
            onClick={() => run(() => updateOwnResource(biz))}
          >
            Save resource page
          </button>
        </div>
      </div>

      {/* Library items */}
      <div className="admin-form" style={{ maxWidth: "none" }}>
        <div className="admin-field" style={{ marginBottom: 6 }}>
          <label style={{ fontSize: 13 }}>Your library items</label>
        </div>
        {videos.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--mid-gray)" }}>
            Recordings of your sessions appear here once the team publishes
            them.
          </div>
        )}
        {videos.map((v) => {
          const edit = videoEdits[v.id] ?? { title: v.title, category: v.category };
          return (
            <div
              key={v.id}
              className="admin-field-row"
              style={{
                gridTemplateColumns: "2fr 1fr auto",
                alignItems: "end",
                borderTop: "1px solid var(--warm-gray)",
                paddingTop: 10,
              }}
            >
              <div className="admin-field">
                <label htmlFor={`v-title-${v.id}`}>
                  Title{v.published ? "" : " (unpublished)"}
                </label>
                <input
                  id={`v-title-${v.id}`}
                  value={edit.title}
                  onChange={(e) =>
                    setVideoEdits({
                      ...videoEdits,
                      [v.id]: { ...edit, title: e.target.value },
                    })
                  }
                />
              </div>
              <div className="admin-field">
                <label htmlFor={`v-cat-${v.id}`}>Category</label>
                <input
                  id={`v-cat-${v.id}`}
                  value={edit.category}
                  onChange={(e) =>
                    setVideoEdits({
                      ...videoEdits,
                      [v.id]: { ...edit, category: e.target.value },
                    })
                  }
                />
              </div>
              <button
                type="button"
                className="btn-mini"
                disabled={pending}
                onClick={() => run(() => updateOwnVideo(v.id, edit))}
                style={{ marginBottom: 14 }}
              >
                Save
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
