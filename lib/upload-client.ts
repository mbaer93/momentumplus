"use client";

import { createClient } from "@/lib/supabase/client";

/*
 * Browser-side half of a direct-to-storage upload.
 *
 * A server action mints a signed upload URL (the "ticket"), the browser
 * pushes the bytes straight to Supabase Storage, and a second action records
 * the resulting path. The file never travels through a serverless function,
 * which is the whole point: Vercel rejects request bodies over ~4.5 MB
 * before our own size check can run, so anything larger used to fail with no
 * error the user could see.
 */

export interface UploadTicket {
  ok: boolean;
  message?: string;
  /** Storage key the signed URL was issued for. */
  path?: string;
  token?: string;
  bucket?: string;
  /** Preview mode — no Supabase, so there is nothing to upload to. */
  preview?: boolean;
}

export interface UploadOutcome {
  ok: boolean;
  message?: string;
  /** The stored path, to hand back to the finalize action. */
  path?: string;
  preview?: boolean;
}

/**
 * Push `file` to storage using a ticket from the server.
 *
 * Returns the path on success. Failures are described rather than swallowed:
 * a silent upload is exactly the bug this replaces.
 */
export async function uploadOnTicket(
  ticket: UploadTicket,
  file: File,
): Promise<UploadOutcome> {
  if (ticket.preview) return { ok: true, preview: true };
  if (!ticket.ok || !ticket.path || !ticket.token || !ticket.bucket) {
    return {
      ok: false,
      message: ticket.message ?? "Couldn't start the upload.",
    };
  }

  const supabase = createClient();
  const { error } = await supabase.storage
    .from(ticket.bucket)
    .uploadToSignedUrl(ticket.path, ticket.token, file, {
      contentType: file.type || "application/octet-stream",
    });
  if (error) return { ok: false, message: `Upload failed: ${error.message}` };
  return { ok: true, path: ticket.path };
}
