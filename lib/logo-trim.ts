/*
 * Sponsor logos render height-capped at their natural size, so baked-in
 * transparent or solid margins make a logo look tiny on the page (the cap
 * applies to the whole canvas, padding included). This trims those margins
 * off raster logos — sharp's trim removes edges matching the corner color,
 * transparent or white alike. SVGs are vectors and pass through untouched.
 */

export interface TrimResult {
  buffer: Buffer;
  contentType: string;
  /** False when the image was already tight (or trimming wasn't possible). */
  trimmed: boolean;
  before: { width: number; height: number };
  after: { width: number; height: number };
}

const RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Trim margin around the artwork of a PNG/JPG/WebP logo. Returns the input
 * unchanged (trimmed: false) for SVGs, undecodable images, images that are
 * already tight, and degenerate results (a trim that would leave almost
 * nothing means the corner color bled through the artwork — keep the
 * original rather than mangle it). Never throws.
 */
export async function trimLogoBuffer(
  input: Buffer,
  contentType: string,
): Promise<TrimResult> {
  const untouched = (w = 0, h = 0): TrimResult => ({
    buffer: input,
    contentType,
    trimmed: false,
    before: { width: w, height: h },
    after: { width: w, height: h },
  });
  if (!RASTER_TYPES.has(contentType)) return untouched();
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(input).metadata();
    const before = { width: meta.width ?? 0, height: meta.height ?? 0 };
    if (!before.width || !before.height) return untouched();

    // Threshold 12 forgives JPEG compression noise in "white" margins.
    const out = await sharp(input)
      .trim({ threshold: 12 })
      .toBuffer({ resolveWithObject: true });
    const after = { width: out.info.width, height: out.info.height };

    const changed =
      after.width < before.width || after.height < before.height;
    const degenerate =
      after.width < 16 ||
      after.height < 16 ||
      after.width * after.height < before.width * before.height * 0.01;
    if (!changed || degenerate) {
      return { ...untouched(before.width, before.height), after };
    }
    return { buffer: out.data, contentType, trimmed: true, before, after };
  } catch {
    return untouched();
  }
}
