import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTrimPath,
  rawPathFor,
  storagePathFromUrl,
} from "../lib/logo-derivative";

test("storagePathFromUrl extracts the object path, cache-buster and all", () => {
  assert.equal(
    storagePathFromUrl(
      "https://x.supabase.co/storage/v1/object/public/sponsor-logos/abc.png?v=123",
    ),
    "abc.png",
  );
  assert.equal(
    storagePathFromUrl(
      "https://x.supabase.co/storage/v1/object/public/sponsor-logos/presented-by/logo",
    ),
    "presented-by/logo",
  );
  // External URLs (not our bucket) are refused.
  assert.equal(storagePathFromUrl("https://cdn.example.com/logo.png"), null);
});

test("trim derivatives are recognized and map back to their original", () => {
  assert.equal(isTrimPath("abc-trim-1753800000000.png"), true);
  assert.equal(isTrimPath("abc.png"), false);
  assert.equal(rawPathFor("abc-trim-1753800000000.png"), "abc.png");
  assert.equal(rawPathFor("abc.webp"), "abc.webp");
  // A sponsor id containing "-trim-" text can't be mistaken for a
  // derivative unless it matches the exact -trim-<digits> tail.
  assert.equal(isTrimPath("weird-trim-name.png"), false);
  assert.equal(rawPathFor("weird-trim-name.png"), "weird-trim-name.png");
});
