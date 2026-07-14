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
