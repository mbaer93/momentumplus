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

export async function getZoomAccessToken(): Promise<string> {
  if (!isZoomConfigured()) throw new ZoomNotConfiguredError();

  const accountId = process.env.ZOOM_ACCOUNT_ID!;
  const basic = Buffer.from(
    `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`,
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

export interface ZoomParticipant {
  name: string;
  email: string;
  duration: number; // seconds
}

// Past-meeting participant report (used to mark attendance). Handles paging.
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
