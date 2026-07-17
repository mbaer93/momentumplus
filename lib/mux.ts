import { createSign } from "crypto";

/*
 * Mux video (SPEC.md §4): signed playback tokens so URLs can't be shared
 * outside the portal. Tokens are RS256 JWTs signed with the Mux signing key —
 * generated server-side only. Env-gated: without credentials the library
 * renders placeholder players.
 */

export function isMuxConfigured(): boolean {
  return Boolean(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET);
}

export function isMuxSigningConfigured(): boolean {
  return Boolean(
    process.env.MUX_SIGNING_KEY_ID && process.env.MUX_SIGNING_KEY_PRIVATE,
  );
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Signed playback token for a playback ID (aud "v" = video). The private key
 * is stored base64-encoded (Mux dashboard default) or as literal PEM with \n.
 */
export function generateMuxPlaybackToken(
  playbackId: string,
  opts: {
    keyId?: string;
    privateKey?: string;
    expSeconds?: number;
    nowSeconds?: number;
    /** "v" = video playback (default), "t" = thumbnail image. */
    aud?: "v" | "t";
    /** Extra claims — signed URLs carry params here, not in the query string. */
    params?: Record<string, string | number>;
  } = {},
): string {
  const keyId = opts.keyId ?? process.env.MUX_SIGNING_KEY_ID!;
  let privateKey = opts.privateKey ?? process.env.MUX_SIGNING_KEY_PRIVATE!;
  if (!privateKey.includes("BEGIN")) {
    privateKey = Buffer.from(privateKey, "base64").toString("utf8");
  } else {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = base64url(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId }),
  );
  const payload = base64url(
    JSON.stringify({
      sub: playbackId,
      aud: opts.aud ?? "v",
      exp: now + (opts.expSeconds ?? 60 * 60 * 6),
      ...opts.params,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${base64url(signer.sign(privateKey))}`;
}

/**
 * Default card image for a recording: a screen grab Mux extracts from the
 * video itself. Signed when playback is signed (params live in the token).
 */
export function muxThumbnailUrl(playbackId: string): string {
  if (!isMuxSigningConfigured()) {
    return `https://image.mux.com/${playbackId}/thumbnail.jpg?width=640&fit_mode=smartcrop`;
  }
  const token = generateMuxPlaybackToken(playbackId, {
    aud: "t",
    expSeconds: 60 * 60 * 24,
    params: { width: 640, fit_mode: "smartcrop" },
  });
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?token=${token}`;
}

// ---------------------------------------------------------------------------
// Mux REST API (direct uploads: the browser sends the file straight to Mux;
// our server only creates the upload slot and reads back the asset).
// ---------------------------------------------------------------------------

const MUX_API = "https://api.mux.com";

async function muxRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const basic = Buffer.from(
    `${process.env.MUX_TOKEN_ID}:${process.env.MUX_TOKEN_SECRET}`,
  ).toString("base64");
  const res = await fetch(`${MUX_API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${basic}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json()) as { data?: T; error?: { messages?: string[] } };
  if (!res.ok) {
    throw new Error(json.error?.messages?.join("; ") ?? `Mux error ${res.status}`);
  }
  return json.data as T;
}

export interface MuxDirectUpload {
  id: string;
  url: string;
}

/** Create a direct-upload slot; the browser PUTs the file to `url`. */
export async function createMuxDirectUpload(
  corsOrigin: string,
): Promise<MuxDirectUpload> {
  return muxRequest<MuxDirectUpload>("POST", "/video/v1/uploads", {
    cors_origin: corsOrigin,
    new_asset_settings: {
      playback_policy: [isMuxSigningConfigured() ? "signed" : "public"],
    },
  });
}

/**
 * Ingest a video Mux can download itself (e.g. a Zoom cloud-recording
 * download URL with its access token) — the recording pipeline's entry
 * point. Returns the new asset id; poll getMuxAsset for readiness.
 */
export async function createMuxAssetFromUrl(inputUrl: string): Promise<MuxAsset> {
  return muxRequest<MuxAsset>("POST", "/video/v1/assets", {
    input: [{ url: inputUrl }],
    playback_policy: [isMuxSigningConfigured() ? "signed" : "public"],
  });
}

export interface MuxUploadStatus {
  id: string;
  status: string; // waiting | asset_created | errored | cancelled | timed_out
  asset_id?: string;
}

export async function getMuxUpload(id: string): Promise<MuxUploadStatus> {
  return muxRequest<MuxUploadStatus>("GET", `/video/v1/uploads/${id}`);
}

export interface MuxTrack {
  id: string;
  type: string; // video | audio | text
  status?: string; // preparing | ready | errored
  text_type?: string; // subtitles
}

export interface MuxAsset {
  id: string;
  status: string; // preparing | ready | errored
  duration?: number; // seconds (present once ready)
  playback_ids?: { id: string; policy: string }[];
  tracks?: MuxTrack[];
}

export async function getMuxAsset(assetId: string): Promise<MuxAsset> {
  return muxRequest<MuxAsset>("GET", `/video/v1/assets/${assetId}`);
}

/**
 * Ask Mux to auto-generate English captions for an asset's audio track.
 * The transcript these produce feeds the AI summary for uploaded videos.
 */
export async function requestMuxAutoCaptions(
  assetId: string,
  audioTrackId: string,
): Promise<void> {
  await muxRequest(
    "POST",
    `/video/v1/assets/${assetId}/tracks/${audioTrackId}/generate-subtitles`,
    {
      generated_subtitles: [{ language_code: "en", name: "English (auto)" }],
    },
  );
}

/** Plain-text transcript of a ready text track (token needed when signed). */
export async function fetchMuxTranscript(
  playbackId: string,
  trackId: string,
  token?: string | null,
): Promise<string | null> {
  const url = `https://stream.mux.com/${playbackId}/text/${trackId}.txt${
    token ? `?token=${token}` : ""
  }`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const text = await res.text();
  return text.trim().length > 0 ? text : null;
}
