import { createSign } from "crypto";

/*
 * READ-ONLY Google Sheets access to the live TSLS registration sheet. This
 * is the summit app's only tie to the existing intake process, and it is
 * deliberately one-way: the readonly OAuth scope makes writing impossible,
 * so nothing here can ever disturb the sheet or Momentum+'s importer (which
 * keeps its own "processed" markers). Idempotency lives in this app's own
 * attendees table instead.
 *
 * Share the sheet with GOOGLE_SERVICE_ACCOUNT_EMAIL as a Viewer.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export function isSheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
      process.env.TSLS_REGISTRATION_SHEET_ID,
  );
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Service-account OAuth: self-signed RS256 JWT → access token.
export async function getSheetsAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
  // .env stores the key with literal \n sequences.
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(
    /\\n/g,
    "\n",
  );

  const iat = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${base64url(signer.sign(privateKey))}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `Google token exchange failed: ${res.status} ${await res.text()}`,
    );
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function readSheetRange(
  token: string,
  range: string,
): Promise<string[][]> {
  const id = process.env.TSLS_REGISTRATION_SHEET_ID!;
  const res = await fetch(
    `${SHEETS_BASE}/${id}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`Sheets read failed: ${res.status} ${await res.text()}`);
  }
  return ((await res.json()) as { values?: string[][] }).values ?? [];
}

// ---------------------------------------------------------------------------
// Pure row parsing (unit-tested): header-driven, order-independent columns.
// The sheet's "processed" column belongs to Momentum+'s importer and is
// intentionally ignored here — this app tracks its own progress.
// ---------------------------------------------------------------------------

export interface RegistrationRow {
  /** 1-based row number in the sheet (for logging only). */
  rowNumber: number;
  name: string;
  email: string;
  registrationType: string;
}

const HEADER_MATCHERS: Record<string, (h: string) => boolean> = {
  name: (h) => h === "name" || h.includes("full name"),
  email: (h) => h.includes("email"),
  type: (h) => h.includes("type") || h.includes("registration"),
};

export function parseRegistrationSheet(values: string[][]): RegistrationRow[] {
  if (values.length === 0) return [];

  const header = values[0].map((h) => h.trim().toLowerCase());
  const col = (key: keyof typeof HEADER_MATCHERS) =>
    header.findIndex(HEADER_MATCHERS[key]);

  const nameCol = col("name");
  const emailCol = col("email");
  const typeCol = col("type");
  if (emailCol === -1 || typeCol === -1) return [];

  const rows: RegistrationRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const raw = values[i];
    const email = (raw[emailCol] ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    rows.push({
      rowNumber: i + 1,
      name: (nameCol >= 0 ? raw[nameCol] : "")?.trim() ?? "",
      email,
      registrationType: (raw[typeCol] ?? "").trim(),
    });
  }
  return rows;
}
