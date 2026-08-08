import assert from "node:assert/strict";
import { test } from "node:test";
import { imageSrcOk, safeImageSrc } from "../lib/image-src";

/*
 * next/image THROWS on a host outside next.config's remotePatterns, taking
 * the whole page down rather than the one image — so these cases are the
 * difference between a missing headshot and a blank Speakers directory.
 */

test("accepts the hosts next.config actually allows", () => {
  assert.equal(
    imageSrcOk("https://abcdefg.supabase.co/storage/v1/object/public/logos/a.png"),
    true,
  );
  assert.equal(imageSrcOk("https://image.mux.com/abc/thumbnail.jpg"), true);
  assert.equal(imageSrcOk("/slc-seal.png"), true, "same-origin path");
});

test("rejects foreign hosts — the bridge/ad-manager entry points", () => {
  assert.equal(imageSrcOk("https://example.com/headshot.jpg"), false);
  assert.equal(imageSrcOk("https://cdn.thetsls.com/speaker.jpg"), false);
});

test("rejects a supabase URL outside the public storage path", () => {
  // remotePatterns pins pathname to /storage/v1/object/public/**, so a
  // matching host alone is not enough.
  assert.equal(imageSrcOk("https://abc.supabase.co/rest/v1/whatever.png"), false);
});

test("rejects a host that merely ends in the allowed domain", () => {
  // The wildcard is one label deep; evil-supabase.co and a.b.supabase.co
  // must both fail.
  assert.equal(
    imageSrcOk("https://notsupabase.co/storage/v1/object/public/x.png"),
    false,
  );
  assert.equal(
    imageSrcOk("https://evil.com/storage/v1/object/public/x.png"),
    false,
  );
});

test("rejects non-https and non-URL junk", () => {
  assert.equal(imageSrcOk("http://abc.supabase.co/storage/v1/object/public/a.png"), false);
  assert.equal(imageSrcOk("javascript:alert(1)"), false);
  assert.equal(imageSrcOk("not a url"), false);
  assert.equal(imageSrcOk("//evil.com/x.png"), false, "protocol-relative");
});

test("empty and nullish are simply 'no image'", () => {
  for (const v of [null, undefined, "", "   "]) {
    assert.equal(imageSrcOk(v), false);
    assert.equal(safeImageSrc(v), null);
  }
});

test("safeImageSrc returns the trimmed URL or null", () => {
  const ok = "https://image.mux.com/abc/thumbnail.jpg";
  assert.equal(safeImageSrc(`  ${ok}  `), ok);
  assert.equal(safeImageSrc("https://example.com/x.png"), null);
});
