import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { trimLogoBuffer } from "../lib/logo-trim";

/** A 400×200 "logo" (solid navy block) centered on a padded canvas. */
async function paddedLogo(
  canvasW: number,
  canvasH: number,
  background: { r: number; g: number; b: number; alpha: number },
): Promise<Buffer> {
  const art = await sharp({
    create: {
      width: 400,
      height: 200,
      channels: 4,
      background: { r: 11, g: 22, b: 34, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: canvasW, height: canvasH, channels: 4, background },
  })
    .composite([{ input: art, gravity: "center" }])
    .png()
    .toBuffer();
}

test("trims transparent margins down to the artwork", async () => {
  const padded = await paddedLogo(1200, 800, { r: 0, g: 0, b: 0, alpha: 0 });
  const result = await trimLogoBuffer(padded, "image/png");
  assert.equal(result.trimmed, true);
  assert.equal(result.before.width, 1200);
  assert.ok(result.after.width <= 402 && result.after.width >= 398);
  assert.ok(result.after.height <= 202 && result.after.height >= 198);
});

test("trims white margins too", async () => {
  const padded = await paddedLogo(1000, 600, {
    r: 255,
    g: 255,
    b: 255,
    alpha: 1,
  });
  const result = await trimLogoBuffer(padded, "image/png");
  assert.equal(result.trimmed, true);
  assert.ok(result.after.width < 500);
});

test("leaves an already-tight logo alone", async () => {
  const tight = await sharp({
    create: {
      width: 400,
      height: 200,
      channels: 4,
      background: { r: 11, g: 22, b: 34, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const result = await trimLogoBuffer(tight, "image/png");
  assert.equal(result.trimmed, false);
  assert.equal(result.buffer, tight);
});

test("passes SVGs and undecodable input through untouched", async () => {
  const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>");
  const svgResult = await trimLogoBuffer(svg, "image/svg+xml");
  assert.equal(svgResult.trimmed, false);
  assert.equal(svgResult.buffer, svg);

  const junk = Buffer.from("not an image");
  const junkResult = await trimLogoBuffer(junk, "image/png");
  assert.equal(junkResult.trimmed, false);
  assert.equal(junkResult.buffer, junk);
});
