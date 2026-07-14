"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { recordVideoView } from "@/app/(portal)/library/actions";

const MuxPlayer = dynamic(() => import("@mux/mux-player-react"), {
  ssr: false,
});

interface VideoPlayerProps {
  videoId: string;
  playbackId: string | null;
  playbackToken: string | null;
  title: string;
}

/**
 * Signed Mux playback (SPEC.md §4) with view tracking. Without Mux configured
 * (or no asset yet) renders the processing placeholder.
 */
export function VideoPlayer({
  videoId,
  playbackId,
  playbackToken,
  title,
}: VideoPlayerProps) {
  const watchedRef = useRef(0);

  // Report watch time when the member leaves the page.
  useEffect(() => {
    const started = Date.now();
    return () => {
      const seconds = Math.max(
        watchedRef.current,
        Math.min((Date.now() - started) / 1000, 4 * 3600),
      );
      if (seconds >= 5) void recordVideoView(videoId, seconds);
    };
  }, [videoId]);

  if (!playbackId) {
    return (
      <div className="video-stage">
        <div className="video-stage-placeholder">
          <h3>Recording processing</h3>
          <p>
            This recording will be available to stream once video hosting (Mux)
            is connected and the asset is processed. The AI summary and your
            notes are available below.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="video-stage">
      <MuxPlayer
        playbackId={playbackId}
        tokens={playbackToken ? { playback: playbackToken } : undefined}
        metadata={{ video_title: title }}
        accentColor="#B8965A"
        onTimeUpdate={(e) => {
          const el = e.target as HTMLVideoElement | null;
          if (el?.currentTime) watchedRef.current = el.currentTime;
        }}
      />
    </div>
  );
}
