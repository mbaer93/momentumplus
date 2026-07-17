/*
 * Zoom Server-to-Server OAuth client (SPEC.md §4): mints an access token, then
 * creates meetings and pulls participant reports for attendance sync. Uses the
 * S2S OAuth app credentials (separate from the Meeting SDK app used by the
 * in-page embed). Never runs client-side.
 */

const ZOOM_OAUTH_URL = "https://zoom.us/oauth/token";
const ZOOM_API_BASE = "https://api.zoom.us/v2";

export class ZoomNotConfiguredError extends Error {
  constructor() {
    super("Zoom Server-to-Server OAuth is not configured");
    this.name = "ZoomNotConfiguredError";
  }
}

export function isZoomConfigured(): boolean {
  return Boolean(
    process.env.ZOOM_ACCOUNT_ID &&
      process.env.ZOOM_CLIENT_ID &&
      process.env.ZOOM_CLIENT_SECRET,
  );
}

export interface ZoomS2SCreds {
  accountId: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Mint an S2S OAuth token. Credentials resolve through the Connections
 * settings (with env fallback) unless passed explicitly (the connect wizard
 * passes them to validate before saving).
 */
export async function getZoomAccessToken(
  creds?: ZoomS2SCreds,
): Promise<string> {
  let resolved = creds ?? null;
  if (!resolved) {
    const { getZoomCreds } = await import("./service-config");
    const c = await getZoomCreds();
    if (c.accountId && c.clientId && c.clientSecret) {
      resolved = {
        accountId: c.accountId,
        clientId: c.clientId,
        clientSecret: c.clientSecret,
      };
    }
  }
  if (!resolved) throw new ZoomNotConfiguredError();

  const accountId = resolved.accountId;
  const basic = Buffer.from(
    `${resolved.clientId}:${resolved.clientSecret}`,
  ).toString("base64");

  const res = await fetch(
    `${ZOOM_OAUTH_URL}?grant_type=account_credentials&account_id=${accountId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      cache: "no-store",
    },
  );

  if (!res.ok) {
    throw new Error(`Zoom OAuth failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export interface CreatedMeeting {
  id: string;
  joinUrl: string;
  startUrl: string;
  password?: string;
}

export interface CreateMeetingInput {
  topic: string;
  startTime: string; // ISO 8601
  durationMin: number;
  agenda?: string;
  hostEmail?: string; // defaults to the S2S app's default user ("me")
}

export async function createZoomMeeting(
  input: CreateMeetingInput,
): Promise<CreatedMeeting> {
  const token = await getZoomAccessToken();
  const user = input.hostEmail ?? "me";

  const res = await fetch(`${ZOOM_API_BASE}/users/${user}/meetings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic: input.topic,
      type: 2, // scheduled meeting
      start_time: input.startTime,
      duration: input.durationMin,
      agenda: input.agenda,
      settings: {
        join_before_host: false,
        waiting_room: true,
        approval_type: 2,
        auto_recording: "cloud",
        meeting_authentication: false,
      },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Zoom create meeting failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as {
    id: number;
    join_url: string;
    start_url: string;
    password?: string;
  };

  return {
    id: String(json.id),
    joinUrl: json.join_url,
    startUrl: json.start_url,
    password: json.password,
  };
}

/**
 * Sync schedule changes to an existing Zoom meeting — editing a published
 * session must move the Zoom meeting too, or members join a meeting whose
 * clock disagrees with the portal.
 */
export async function updateZoomMeeting(
  meetingId: string,
  input: { topic?: string; startTime?: string; durationMin?: number; agenda?: string },
): Promise<void> {
  const token = await getZoomAccessToken();
  const res = await fetch(`${ZOOM_API_BASE}/meetings/${meetingId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(input.topic !== undefined && { topic: input.topic }),
      ...(input.startTime !== undefined && { start_time: input.startTime }),
      ...(input.durationMin !== undefined && { duration: input.durationMin }),
      ...(input.agenda !== undefined && { agenda: input.agenda }),
    }),
    cache: "no-store",
  });
  // Zoom returns 204 on success.
  if (!res.ok && res.status !== 204) {
    throw new Error(`Zoom update meeting failed: ${res.status} ${await res.text()}`);
  }
}

export interface ZoomParticipant {
  name: string;
  email: string;
  duration: number; // seconds
}

// Past-meeting participant report (used to mark attendance). Handles paging.
/** Host start link for an existing meeting — fetched live so it's always
    valid; only ever handed to the session's own speaker (or an admin). */
export async function getMeetingStartUrl(
  meetingId: string,
  creds?: ZoomS2SCreds,
): Promise<string | null> {
  const token = await getZoomAccessToken(creds);
  const res = await fetch(
    `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { start_url?: string };
  return json.start_url ?? null;
}

export async function getMeetingParticipants(
  meetingId: string,
): Promise<ZoomParticipant[]> {
  const token = await getZoomAccessToken();
  const participants: ZoomParticipant[] = [];
  let nextPageToken = "";

  do {
    const url = new URL(
      `${ZOOM_API_BASE}/report/meetings/${meetingId}/participants`,
    );
    url.searchParams.set("page_size", "300");
    if (nextPageToken) url.searchParams.set("next_page_token", nextPageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        `Zoom participants report failed: ${res.status} ${await res.text()}`,
      );
    }
    const json = (await res.json()) as {
      participants?: { name: string; user_email: string; duration: number }[];
      next_page_token?: string;
    };
    for (const p of json.participants ?? []) {
      participants.push({
        name: p.name,
        email: (p.user_email ?? "").toLowerCase(),
        duration: p.duration ?? 0,
      });
    }
    nextPageToken = json.next_page_token ?? "";
  } while (nextPageToken);

  return participants;
}
