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
      aud: "v",
      exp: now + (opts.expSeconds ?? 60 * 60 * 6),
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${base64url(signer.sign(privateKey))}`;
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
