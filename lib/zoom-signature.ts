import { createHmac } from "crypto";

/*
 * Zoom Meeting SDK (Web) join signature — SPEC.md §4. A JWT (HS256) signed with
 * the Meeting SDK app secret, generated server-side only and short-lived. The
 * client fetches it from /api/zoom/signature (which checks enrollment) and hands
 * it to the embedded SDK. The SDK secret is NEVER exposed to the client.
 *
 * Payload matches Zoom's documented Meeting SDK auth spec:
 *   { appKey, sdkKey, mn, role, iat, exp, tokenExp }
 */

export type ZoomRole = 0 | 1; // 0 = attendee, 1 = host

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface SignatureInput {
  sdkKey: string;
  sdkSecret: string;
  meetingNumber: string;
  role?: ZoomRole;
  /** Signature/JWT lifetime in seconds (Zoom requires 30 min ≤ exp ≤ 48 h). */
  expSeconds?: number;
  /** Injectable clock (seconds since epoch) for testing. */
  nowSeconds?: number;
}

export function generateZoomSignature({
  sdkKey,
  sdkSecret,
  meetingNumber,
  role = 0,
  expSeconds = 60 * 60 * 2,
  nowSeconds = Math.floor(Date.now() / 1000),
}: SignatureInput): string {
  const iat = nowSeconds - 30; // small clock-skew cushion
  const exp = iat + expSeconds;

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    appKey: sdkKey,
    sdkKey,
    mn: meetingNumber,
    role,
    iat,
    exp,
    tokenExp: exp,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = base64url(
    createHmac("sha256", sdkSecret).update(signingInput).digest(),
  );

  return `${signingInput}.${signature}`;
}

export function isZoomSdkConfigured(): boolean {
  return Boolean(
    process.env.ZOOM_SDK_CLIENT_ID && process.env.ZOOM_SDK_CLIENT_SECRET,
  );
}
