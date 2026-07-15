"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createVideoUpload,
  finalizeVideoUpload,
  type VideoInput,
} from "@/app/(portal)/admin/videos/actions";

/*
 * In-app video upload: the file goes browser → Mux directly (a direct-upload
 * URL scoped to this site), with a progress bar; the server then resolves
 * the asset and creates the Library recording. Nobody touches the Mux
 * dashboard for day-to-day uploads.
 */

type Phase = "idle" | "uploading" | "finalizing";

export function VideoUploader({ muxConnected }: { muxConnected: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [meta, setMeta] = useState({
    title: "",
    category: "Leadership",
    minAccess: "all_members" as VideoInput["minAccess"],
    published: true,
  });
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // Kept so "Finish" can be retried if Mux is still ingesting the file.
  const [pendingUploadId, setPendingUploadId] = useState<string | null>(null);

  function putWithProgress(url: string, file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Upload failed (${xhr.status})`));
      xhr.onerror = () => reject(new Error("Upload failed — network error"));
      xhr.send(file);
    });
  }

  async function finalize(uploadId: string) {
    setPhase("finalizing");
    const input: VideoInput = {
      title: meta.title,
      category: meta.category,
      muxPlaybackId: "",
      durationMin: 0,
      minAccess: meta.minAccess,
      published: meta.published,
    };
    const res = await finalizeVideoUpload(uploadId, input);
    setMsg(res.message ? { text: res.message, ok: res.ok } : null);
    if (res.ok) {
      setPendingUploadId(null);
      setMeta({ ...meta, title: "" });
      if (fileRef.current) fileRef.current.value = "";
      setPhase("idle");
      setProgress(0);
      router.refresh();
    } else {
      // Keep the upload id so Finish can be retried without re-uploading.
      setPendingUploadId(uploadId);
      setPhase("idle");
    }
  }

  async function startUpload() {
    setMsg(null);
    const file = fileRef.current?.files?.[0];
    if (!meta.title.trim()) {
      setMsg({ text: "Give the recording a title first.", ok: false });
      return;
    }
    if (!file) {
      setMsg({ text: "Choose a video file (MP4, MOV, or similar).", ok: false });
      return;
    }

    try {
      setPhase("uploading");
      setProgress(0);
      const slot = await createVideoUpload();
      if (!slot.ok || !slot.uploadUrl || !slot.uploadId) {
        setMsg({ text: slot.message ?? "Couldn't start the upload.", ok: false });
        setPhase("idle");
        return;
      }
      await putWithProgress(slot.uploadUrl, file);
      await finalize(slot.uploadId);
    } catch (e) {
      setMsg({
        text: e instanceof Error ? e.message : "Upload failed — try again.",
        ok: false,
      });
      setPhase("idle");
    }
  }

  return (
    <div className="admin-form" style={{ maxWidth: "none", marginBottom: 20 }}>
      <div className="admin-field" style={{ marginBottom: 4 }}>
        <label style={{ fontSize: 13 }}>Upload a video</label>
      </div>
      {!muxConnected && (
        <div style={{ fontSize: 12.5, color: "var(--mid-gray)", marginBottom: 8 }}>
          Connect Mux first (Admin → Connections) — then videos upload right
          here, no Mux dashboard needed.
        </div>
      )}
      <div
        className="admin-field-row"
        style={{ gridTemplateColumns: "1.6fr 1fr 1.2fr auto", alignItems: "end" }}
      >
        <div className="admin-field">
          <label htmlFor="vu-title">Title</label>
          <input
            id="vu-title"
            value={meta.title}
            onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            placeholder="e.g. Resilience Rituals — June session"
          />
        </div>
        <div className="admin-field">
          <label htmlFor="vu-cat">Category</label>
          <select
            id="vu-cat"
            value={meta.category}
            onChange={(e) => setMeta({ ...meta, category: e.target.value })}
          >
            <option>Leadership</option>
            <option>Wellness</option>
            <option>Business</option>
          </select>
        </div>
        <div className="admin-field">
          <label htmlFor="vu-access">Who can watch</label>
          <select
            id="vu-access"
            value={meta.minAccess}
            onChange={(e) =>
              setMeta({
                ...meta,
                minAccess: e.target.value as VideoInput["minAccess"],
              })
            }
          >
            <option value="all_members">All members</option>
            <option value="vip_plus">VIP &amp; annual only</option>
            <option value="pro_only">Pro members only (exclusive)</option>
          </select>
        </div>
        <label className="admin-check-row" style={{ marginBottom: 14 }}>
          <input
            type="checkbox"
            className="pref-toggle"
            checked={meta.published}
            onChange={(e) => setMeta({ ...meta, published: e.target.checked })}
          />
          Publish
        </label>
      </div>
      <div className="admin-form-actions" style={{ marginTop: 4 }}>
        <input
          type="file"
          accept="video/*"
          ref={fileRef}
          style={{ fontSize: 12 }}
          aria-label="Video file"
        />
        {pendingUploadId ? (
          <button
            type="button"
            className="btn-purple"
            disabled={phase !== "idle"}
            onClick={() => void finalize(pendingUploadId)}
          >
            Finish processing
          </button>
        ) : (
          <button
            type="button"
            className="btn-purple"
            disabled={phase !== "idle" || !muxConnected}
            onClick={() => void startUpload()}
          >
            {phase === "uploading"
              ? `Uploading… ${progress}%`
              : phase === "finalizing"
                ? "Processing…"
                : "Upload video"}
          </button>
        )}
      </div>
      {phase === "uploading" && (
        <div className="progress-track" style={{ marginTop: 10 }}>
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}
      {msg && (
        <div
          className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}
          style={{ marginTop: 8 }}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
