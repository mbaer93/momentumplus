/*
 * base64url ⇄ ArrayBuffer, for the WebAuthn ceremony (Matt, 2026-08-21).
 *
 * WebAuthn speaks ArrayBuffers; JSON does not. So the options Supabase
 * hands back carry base64url strings that the browser needs as buffers,
 * and the credential the browser produces carries buffers that have to go
 * back as base64url. Nothing here is clever — it exists because getting a
 * single field wrong produces "NotAllowedError" with no clue which one.
 *
 * base64URL, not base64: the WebAuthn JSON encoding uses `-` and `_` and
 * drops padding. Feeding standard base64 to atob-with-substitutions is the
 * usual way this silently corrupts a challenge.
 */

export function base64urlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const raw = atob(withPadding);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

export function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked: String.fromCharCode(...bytes) overflows the call stack on a
  // large attestation object, which only shows up on some authenticators.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The fields WebAuthn requires as buffers, wherever they appear. */
type CredentialOptions = Record<string, unknown>;

/**
 * Turn the JSON options Supabase returns into what
 * navigator.credentials.create/get actually accepts.
 */
export function decodeCredentialOptions(
  options: CredentialOptions,
): PublicKeyCredentialCreationOptions & PublicKeyCredentialRequestOptions {
  const out: CredentialOptions = { ...options };
  if (typeof out.challenge === "string") {
    out.challenge = base64urlToBuffer(out.challenge);
  }
  const user = out.user as { id?: unknown } | undefined;
  if (user && typeof user.id === "string") {
    out.user = { ...user, id: base64urlToBuffer(user.id) };
  }
  for (const key of ["excludeCredentials", "allowCredentials"]) {
    const list = out[key];
    if (Array.isArray(list)) {
      out[key] = list.map((c: { id?: unknown }) =>
        typeof c?.id === "string" ? { ...c, id: base64urlToBuffer(c.id) } : c,
      );
    }
  }
  // Through `unknown`: the input is a JSON bag whose shape the server
  // decides, and asserting it overlaps the DOM types directly is a claim
  // this function cannot make.
  return out as unknown as PublicKeyCredentialCreationOptions &
    PublicKeyCredentialRequestOptions;
}

/**
 * Turn the credential the authenticator produced back into JSON.
 *
 * Both ceremonies are handled: `create` yields an attestation response,
 * `get` yields an assertion (with `signature` and `userHandle`). Sending
 * the wrong shape is rejected server-side with a generic error, so both
 * are built from what is actually present rather than from a flag.
 */
export function encodeCredential(credential: PublicKeyCredential): unknown {
  const response = credential.response as AuthenticatorAttestationResponse &
    AuthenticatorAssertionResponse;
  const json: Record<string, unknown> = {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
    },
  };
  const res = json.response as Record<string, unknown>;
  if (response.attestationObject) {
    res.attestationObject = bufferToBase64url(response.attestationObject);
  }
  if (response.authenticatorData) {
    res.authenticatorData = bufferToBase64url(response.authenticatorData);
  }
  if (response.signature) res.signature = bufferToBase64url(response.signature);
  if (response.userHandle) {
    res.userHandle = bufferToBase64url(response.userHandle);
  }
  return json;
}
