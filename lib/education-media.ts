/*
 * education-media is a PRIVATE bucket (migration 0020) — lesson images and
 * documents for gated courses must not be permanent public URLs. Rows store
 * the canonical bucket URL; these helpers swap in short-lived signed URLs at
 * render time, after the RLS-gated course fetch has already decided the
 * viewer may see the lesson.
 */

import { createServiceClient } from "@/lib/supabase/admin";

const BUCKET = "education-media";
const MARKER = `/${BUCKET}/`;

/** Bucket-relative path from a stored URL, or null for foreign URLs. */
function bucketPath(url: string): string | null {
  const i = url.indexOf(MARKER);
  if (i === -1) return null;
  return decodeURIComponent(url.slice(i + MARKER.length).split("?")[0]);
}

/**
 * Sign every education-media URL in the list (1 hour). URLs outside the
 * bucket pass through untouched. Returns a map from original → usable URL.
 */
export async function signEducationUrls(
  urls: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return out;

  const paths: { url: string; path: string }[] = [];
  for (const url of urls) {
    if (!url || out.has(url)) continue;
    const path = bucketPath(url);
    if (path) paths.push({ url, path });
  }
  if (paths.length === 0) return out;

  const { data } = await createServiceClient()
    .storage.from(BUCKET)
    .createSignedUrls(
      paths.map((p) => p.path),
      3600,
    );
  (data ?? []).forEach((signed, i) => {
    if (signed.signedUrl) out.set(paths[i].url, signed.signedUrl);
  });
  return out;
}
