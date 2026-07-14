import { createSign } from "crypto";

/*
 * Google Sheets access for the TSLS registration import (SPEC.md §4), using a
 * service account and plain REST — no heavyweight SDK. The registration sheet
 * must be shared with GOOGLE_SERVICE_ACCOUNT_EMAIL. Scope includes write so
 * the import can mark rows processed in the sheet itself.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

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
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
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

export async function writeSheetCell(
  token: string,
  rangeA1: string,
  value: string,
): Promise<void> {
  const id = process.env.TSLS_REGISTRATION_SHEET_ID!;
  const res = await fetch(
    `${SHEETS_BASE}/${id}/values/${encodeURIComponent(rangeA1)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [[value]] }),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`Sheets write failed: ${res.status} ${await res.text()}`);
  }
}

// ---------------------------------------------------------------------------
// Pure row parsing (unit-tested): header-driven, order-independent columns.
// ---------------------------------------------------------------------------

export interface RegistrationRow {
  /** 1-based row number in the sheet (for marking processed). */
  rowNumber: number;
  name: string;
  email: string;
  registrationType: string;
  processed: boolean;
}

export interface ParsedSheet {
  rows: RegistrationRow[];
  /** 0-based index of the "processed" column (appended if absent). */
  processedCol: number;
}

const HEADER_MATCHERS: Record<string, (h: string) => boolean> = {
  name: (h) => h === "name" || h.includes("full name"),
  email: (h) => h.includes("email"),
  type: (h) => h.includes("type") || h.includes("registration"),
  processed: (h) => h.includes("processed") || h.includes("imported"),
};

export function parseRegistrationSheet(values: string[][]): ParsedSheet {
  if (values.length === 0) return { rows: [], processedCol: 0 };

  const header = values[0].map((h) => h.trim().toLowerCase());
  const col = (key: keyof typeof HEADER_MATCHERS) =>
    header.findIndex(HEADER_MATCHERS[key]);

  const nameCol = col("name");
  const emailCol = col("email");
  const typeCol = col("type");
  let processedCol = col("processed");
  if (processedCol === -1) processedCol = header.length; // append to the right

  const rows: RegistrationRow[] = [];
  if (emailCol === -1 || typeCol === -1) return { rows, processedCol };

  for (let i = 1; i < values.length; i++) {
    const raw = values[i];
    const email = (raw[emailCol] ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    rows.push({
      rowNumber: i + 1,
      name: (nameCol >= 0 ? raw[nameCol] : "")?.trim() ?? "",
      email,
      registrationType: (raw[typeCol] ?? "").trim(),
      processed: Boolean((raw[processedCol] ?? "").trim()),
    });
  }
  return { rows, processedCol };
}

/** Convert a 0-based column index to its A1 letter(s): 0→A, 25→Z, 26→AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
