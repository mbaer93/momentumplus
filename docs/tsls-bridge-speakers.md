# TSLS handoff — add `GET /api/bridge/speakers`

**Why:** Momentum+ now has a "Pull speakers from TSLS" button (Admin → Speakers,
PR #171). It calls this endpoint on the TSLS app. Until TSLS exposes it, the
button reports "TSLS doesn't expose its speaker list yet."

**The rule it serves (Matt, 2026-08-05):** every TSLS speaker is a Momentum+
speaker — main stage AND panelists — **except the Emcee**, the one exception.
Momentum+ does the filtering and matching on its side; TSLS just needs to
report the lineup **with roles**, including the emcee (labeled as such).

---

## Contract (already documented in Momentum+ `lib/tsls-speakers.ts`)

```
GET /api/bridge/speakers
Header:  x-api-key: <TSLS_SSO_SECRET>     ← the existing M+→TSLS trust pair
                                            (Momentum+ sends its TSLS_SSO_KEY)
200 → {
  "speakers": [
    {
      "name": "Holly Bertone, PMP",        // required
      "email": "holly@example.com",        // optional but STRONGLY wanted — best match key
      "title": "Keynote — Leadership",     // optional
      "bio": "…",                          // optional
      "headshotUrl": "https://…",          // optional
      "website": "https://…",              // optional
      "tags": ["Leadership"],              // optional
      "role": "main" | "panelist" | "emcee" // optional; absent = "main"
    }
  ]
}
401 → bad/missing key
```

Notes for the implementer:
- Auth must mirror the existing `/api/bridge/update` receiver (timing-safe
  compare against `TSLS_SSO_SECRET`).
- Include ALL speakers — main, panelists, AND the emcee. Momentum+ skips the
  emcee itself; TSLS's job is only to label roles truthfully.
- Exclude soft-deleted/withdrawn speakers if the schema has such a state.
- Map whatever TSLS's real role/type column is onto the three contract values
  (anything that isn't a panelist or the emcee → "main").

## Reference route (adapt the query to the real TSLS schema)

```ts
// app/api/bridge/speakers/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

// Auth: same trust pair as /api/bridge/update — Momentum+ sends its
// TSLS_SSO_KEY, which must equal our TSLS_SSO_SECRET.
function authorized(req: NextRequest): boolean {
  const secret = process.env.TSLS_SSO_SECRET ?? "";
  const given =
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // >>> ADAPT: query the real TSLS speakers table via the service client.
  // Select every non-deleted speaker; map the real role/type column to
  // "main" | "panelist" | "emcee".
  const rows = await loadSpeakersSomehow();

  return NextResponse.json({
    speakers: rows.map((s) => ({
      name: s.name,
      email: s.email ?? null,
      title: s.title ?? null,
      bio: s.bio ?? null,
      headshotUrl: s.headshot_url ?? null,
      website: s.website ?? null,
      tags: s.tags ?? [],
      role: s.role, // "main" | "panelist" | "emcee"
    })),
  });
}
```

---

## Paste-in prompt for a Claude session in the TSLS repo

> Add a `GET /api/bridge/speakers` endpoint that reports the full speaker
> lineup to Momentum+. Auth: accept `x-api-key` (or Bearer) equal to
> `TSLS_SSO_SECRET`, timing-safe compare, mirroring the existing
> `/api/bridge/update` receiver — no new env vars. Response shape:
> `{ speakers: [{ name, email?, title?, bio?, headshotUrl?, website?,
> tags?: string[], role: "main" | "panelist" | "emcee" }] }`.
> Include ALL current-season speakers — main stage, panelists, and the
> emcee — mapping our real speaker role/type onto those three values
> (default "main"); exclude withdrawn/deleted speakers. Include email
> whenever we have it (it's Momentum+'s primary match key). Add a route
> test for 401-without-key and the response shape. Run the repo's lint,
> typecheck, and tests, then commit, push, and open a draft PR titled
> "Bridge: expose speaker lineup to Momentum+ (GET /api/bridge/speakers)".
> Context: the Momentum+ side is already merged-ready in
> mbaer93/momentumplus PR #171 — its `lib/tsls-speakers.ts` documents this
> exact contract; Momentum+ skips the emcee on import, so we must label
> roles truthfully rather than filter here.
