"use client";

import { useState, useTransition } from "react";
import {
  addEpisodeManual,
  assignSeasonRange,
  deleteEpisode,
  importPodcastBackCatalog,
  savePodcastSettings,
  setEpisodeHidden,
  syncPodcastNow,
  updateEpisode,
} from "@/app/(portal)/admin/podcast/actions";

export interface AdminEpisodeRow {
  id: string;
  youtubeVideoId: string;
  title: string;
  showNotes: string;
  publishedAt: string | null;
  source: "auto" | "manual";
  hidden: boolean;
  season: number | null;
}

/* Admin manager for the Branching Out podcast: auto-sync channel, sync-now,
   manual add for past episodes, and hide/delete per episode. */
export function PodcastManager({
  channelId,
  spotifyUrl,
  youtubeApiReady,
  episodes,
}: {
  channelId: string;
  spotifyUrl: string;
  /** YouTube Data API key connected (Admin → Connections)? With it the
      import reads exact dates + full notes for every episode. */
  youtubeApiReady: boolean;
  episodes: AdminEpisodeRow[];
}) {
  const [channel, setChannel] = useState(channelId);
  const [spotify, setSpotify] = useState(spotifyUrl);
  // Bulk season assignment (Matt, 2026-08-05: carve the back catalog into
  // seasons by date range).
  const [range, setRange] = useState({ from: "", to: "", season: "" });
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  // Inline episode editing (Matt, 2026-08-05): fix a title/notes/date in
  // place — saving marks the episode Manual so nothing auto ever
  // overwrites the correction.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ title: "", notes: "", date: "", season: "" });
  const startEdit = (ep: AdminEpisodeRow) => {
    setEditingId(ep.id);
    setEdit({
      title: ep.title,
      notes: ep.showNotes,
      date: ep.publishedAt ? ep.publishedAt.slice(0, 10) : "",
      season: ep.season === null ? "" : String(ep.season),
    });
  };

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      setStatus(
        res.message ? { ok: res.ok, text: res.message } : res.ok ? null : {
          ok: false,
          text: "Something went wrong",
        },
      );
    });

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontSize: 13,
    background: "var(--cream)",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    display: "block",
    marginBottom: 4,
  };

  return (
    <div className="sessions-pad" style={{ display: "grid", gap: 20 }}>
      <div className="section-header">
        <div>
          <h2>Branching Out</h2>
          <p>Podcast episodes — auto-synced from YouTube, plus manual adds</p>
        </div>
      </div>

      {status && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 4,
            fontSize: 13,
            border: `1px solid ${status.ok ? "rgba(58,112,85,0.4)" : "rgba(155,60,60,0.4)"}`,
            color: status.ok ? "var(--accent-green)" : "#9B3C3C",
            background: status.ok ? "rgba(58,112,85,0.07)" : "rgba(155,60,60,0.06)",
          }}
        >
          {status.text}
        </div>
      )}

      {/* Auto-sync settings */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0, marginBottom: 6 }}>Auto-sync</h3>
        <p style={{ fontSize: 12.5, color: "var(--mid-gray)", marginTop: 0 }}>
          New uploads on the show&apos;s YouTube channel appear on the
          Branching Out tab automatically (checked every 6 hours) — title,
          show notes, and thumbnail come from YouTube, so there&apos;s nothing
          to upload each week. Paste the channel URL or its UC… id.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            style={{ ...inputStyle, flex: "1 1 280px" }}
            placeholder="youtube.com/channel/UC… or the UC… id"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          />
          <input
            style={{ ...inputStyle, flex: "1 1 280px" }}
            placeholder="Spotify show link (optional) — open.spotify.com/show/…"
            value={spotify}
            onChange={(e) => setSpotify(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            onClick={() => run(() => savePodcastSettings(channel, spotify))}
          >
            Save settings
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={pending || !channelId}
            title={channelId ? "" : "Save the channel first"}
            onClick={() => run(() => syncPodcastNow())}
          >
            {pending ? "Working…" : "Sync now"}
          </button>
          <button
            type="button"
            className="btn-gold"
            disabled={pending || !channelId}
            title={channelId ? "" : "Save the channel first"}
            onClick={() => run(() => importPodcastBackCatalog())}
          >
            {pending ? "Working…" : "Import full back catalog"}
          </button>
        </div>
        <p style={{ fontSize: 12, color: "var(--mid-gray)", marginBottom: 0, marginTop: 8 }}>
          Sync now grabs recent uploads; <strong>Import full back catalog</strong>{" "}
          walks the channel&apos;s entire video list and pulls every past
          episode — title, show notes, publish date, and thumbnail.{" "}
          {youtubeApiReady ? (
            <>
              The YouTube API is connected, so the import uses YouTube&apos;s
              exact publish dates and full notes, and trues up episodes that
              drifted — only episodes marked Manual are left alone.
            </>
          ) : (
            <>
              YouTube hides exact dates on older videos, so imported dates are
              approximate. For exact dates and full notes on every episode,
              connect a free YouTube API key in{" "}
              <a href="/admin/connections" style={{ color: "var(--gold)", fontWeight: 600 }}>
                Admin → Connections
              </a>{" "}
              and run the import again.
            </>
          )}
        </p>
      </div>

      {/* Manual add — past episodes */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0, marginBottom: 6 }}>Add a past episode</h3>
        <p style={{ fontSize: 12.5, color: "var(--mid-gray)", marginTop: 0 }}>
          The feed only carries recent uploads — add the back catalog here.
          Leave the title blank to pull it from YouTube automatically.
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <label style={labelStyle}>YouTube link *</label>
            <input
              style={inputStyle}
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Title (optional)</label>
              <input
                style={inputStyle}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Published (optional)</label>
              <input
                type="date"
                style={inputStyle}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Show notes (optional)</label>
            <textarea
              style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div>
            <button
              type="button"
              className="btn-primary"
              disabled={pending || !url.trim()}
              onClick={() =>
                run(async () => {
                  const res = await addEpisodeManual({
                    url,
                    title,
                    showNotes: notes,
                    publishedAt: date,
                  });
                  if (res.ok) {
                    setUrl("");
                    setTitle("");
                    setNotes("");
                    setDate("");
                  }
                  return res;
                })
              }
            >
              Add episode
            </button>
          </div>
        </div>
      </div>

      {/* Seasons: bulk assignment by date range */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0, marginBottom: 6 }}>Seasons</h3>
        <p style={{ fontSize: 12.5, color: "var(--mid-gray)", marginTop: 0 }}>
          Group episodes into seasons so members can browse them easily.
          Assign a whole date range at once here, or set a single
          episode&apos;s season in its Edit panel. The member tab shows
          season tabs as soon as any episode has one.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div>
            <label style={labelStyle}>From</label>
            <input
              type="date"
              style={inputStyle}
              value={range.from}
              onChange={(e) => setRange((p) => ({ ...p, from: e.target.value }))}
            />
          </div>
          <div>
            <label style={labelStyle}>To</label>
            <input
              type="date"
              style={inputStyle}
              value={range.to}
              onChange={(e) => setRange((p) => ({ ...p, to: e.target.value }))}
            />
          </div>
          <div>
            <label style={labelStyle}>Season</label>
            <input
              type="number"
              min={1}
              style={{ ...inputStyle, width: 90 }}
              placeholder="1"
              value={range.season}
              onChange={(e) => setRange((p) => ({ ...p, season: e.target.value }))}
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={pending || !range.from || !range.to || !range.season}
            onClick={() => run(() => assignSeasonRange(range))}
          >
            Assign season to range
          </button>
        </div>
      </div>

      {/* Episode list */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>Episodes ({episodes.length})</h3>
        {episodes.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--mid-gray)" }}>
            No episodes yet — save the channel and sync, or add one manually.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {episodes.map((ep) => (
              <div key={ep.id}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 10px",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  opacity: ep.hidden ? 0.55 : 1,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {ep.title}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--mid-gray)" }}>
                    {ep.publishedAt
                      ? new Date(ep.publishedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "No date"}{" "}
                    · {ep.source === "auto" ? "Auto-synced" : "Manual"}
                    {ep.season !== null ? ` · Season ${ep.season}` : ""}
                    {ep.hidden ? " · Hidden" : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="filter-btn"
                  disabled={pending}
                  onClick={() =>
                    editingId === ep.id ? setEditingId(null) : startEdit(ep)
                  }
                >
                  {editingId === ep.id ? "Close" : "Edit"}
                </button>
                <button
                  type="button"
                  className="filter-btn"
                  disabled={pending}
                  onClick={() =>
                    run(() => setEpisodeHidden(ep.id, !ep.hidden))
                  }
                >
                  {ep.hidden ? "Show" : "Hide"}
                </button>
                <button
                  type="button"
                  className="filter-btn"
                  disabled={pending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete "${ep.title}"? Auto-sync may re-add it if it's still in the channel feed — use Hide to keep it off the tab permanently.`,
                      )
                    ) {
                      run(() => deleteEpisode(ep.id));
                    }
                  }}
                >
                  Delete
                </button>
              </div>
              {editingId === ep.id && (
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderTop: "none",
                    borderRadius: "0 0 4px 4px",
                    padding: "10px 12px",
                    display: "grid",
                    gap: 8,
                    background: "var(--cream)",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                    <div>
                      <label style={labelStyle}>Title</label>
                      <input
                        style={inputStyle}
                        value={edit.title}
                        onChange={(e) => setEdit((p) => ({ ...p, title: e.target.value }))}
                      />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <label style={labelStyle}>Published</label>
                        <input
                          type="date"
                          style={inputStyle}
                          value={edit.date}
                          onChange={(e) => setEdit((p) => ({ ...p, date: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Season</label>
                        <input
                          type="number"
                          min={1}
                          style={inputStyle}
                          placeholder="e.g. 2"
                          value={edit.season}
                          onChange={(e) => setEdit((p) => ({ ...p, season: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Show notes</label>
                    <textarea
                      style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
                      value={edit.notes}
                      onChange={(e) => setEdit((p) => ({ ...p, notes: e.target.value }))}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={pending || !edit.title.trim()}
                      onClick={() =>
                        run(async () => {
                          const res = await updateEpisode(ep.id, {
                            title: edit.title,
                            showNotes: edit.notes,
                            publishedAt: edit.date,
                            season: edit.season,
                          });
                          if (res.ok) setEditingId(null);
                          return res;
                        })
                      }
                    >
                      {pending ? "Saving…" : "Save episode"}
                    </button>
                    <span style={{ fontSize: 11.5, color: "var(--mid-gray)" }}>
                      Saving marks it Manual — future syncs and imports never
                      overwrite it.
                    </span>
                  </div>
                </div>
              )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
