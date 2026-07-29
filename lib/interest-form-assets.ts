/*
 * Files and websites the 2026 sponsor interest form collected (GHL export,
 * 2026-07-29). The form let each business upload up to two logo files,
 * hosted by GHL at services.leadconnectorhq.com — this maps each business
 * (by the sponsor-row name the 0063 import used) to those download URLs and
 * the website they typed, so Admin → Sponsors can pull everything in with
 * one click instead of thirty save-as/upload round-trips.
 *
 * Static data on purpose: the export is a snapshot, and keeping it in code
 * (not the DB) means the import is reviewable and repeatable.
 */

const GHL = "https://services.leadconnectorhq.com/documents/download";

export interface InterestFormAssets {
  /** Matches sponsors.name case-insensitively. */
  name: string;
  /** Uploaded logo files, best candidate first. */
  logoUrls: string[];
  website?: string;
}

export const INTEREST_FORM_ASSETS: InterestFormAssets[] = [
  { name: "Meinelschmidt Distillery", logoUrls: [`${GHL}/AGLGywUjtSvvMDrIjOKf`], website: "https://www.meineldistillery.com" },
  { name: "TOBE DesignGroup", logoUrls: [`${GHL}/E7UvqTufZPFIaJ2sFDaL`, `${GHL}/yf64RPsxJH7hAs1iLTyg`], website: "https://www.tobedesigngroup.com" },
  { name: "Graphics Universal, Inc.", logoUrls: [`${GHL}/ZWbIlbDTVEUon4jabOfw`], website: "https://www.graphicsuniversal.com" },
  { name: "Connect Films", logoUrls: [`${GHL}/FLagnjxMTgV2FQ6fPLXb`], website: "https://www.connectfilms.com" },
  { name: "Allegany County Chamber of Commerce", logoUrls: [`${GHL}/lMFgo8HYORi837obAhcj`], website: "https://alleganycountychamber.com" },
  { name: "Frederick County Chamber of Commerce", logoUrls: [`${GHL}/p93xi8qUOlUAmZ80R0oq`, `${GHL}/T4h6rgCsixp4knB1v3B9`], website: "https://www.frederickchamber.org" },
  { name: "Smartypants Medicine", logoUrls: [`${GHL}/pKojJZlhRlHkQLFCbq9Y`], website: "https://smartypantsmedicine.com" },
  { name: "RM Benefits", logoUrls: [`${GHL}/o4BsAdaN4CSI84HF7tey`, `${GHL}/4yTzgyn6nyMo1O83DBxA`], website: "https://www.rmbenefitsmd.com" },
  // Two submissions (Apr 2026 + Jul 2025) — their files, newest first.
  { name: "Saunders Tax and Accounting", logoUrls: [`${GHL}/7na3NYncaoHajwl8HfzS`, `${GHL}/yTpLeZTAk1fwJtB0WbLH`, `${GHL}/imciDE45CegoZt2LEj5O`], website: "https://www.saunderstax.com" },
  { name: "Humphrey's Cleaning Service LLC", logoUrls: [`${GHL}/wxfamzf40PW0GsNGJ8aR`], website: "https://www.humphreyclean.com" },
  { name: "Wingman Executive Coaching", logoUrls: [`${GHL}/8QuoWWbZkLsJw5uqkADW`, `${GHL}/Tj3jDSLFBNSMtiJVU0at`], website: "https://wingmanexecutivecoaching.com" },
  { name: "Labers Office Furniture", logoUrls: [`${GHL}/su7rU5YTg7jAl3X7pyZZ`], website: "https://www.labersfurniture.com" },
  { name: "Edward Jones (Will Lawrence)", logoUrls: [`${GHL}/z6pflGDDUD4NcRWzVJLU`], website: "https://www.edwardjones.com" },
  { name: "F&M Trust", logoUrls: [`${GHL}/ipr7rzImlM4jXXDNnAll`, `${GHL}/bXkkTw3EU7tfg2B7epfu`], website: "https://fmtrust.bank" },
  { name: "Martinsburg-Berkeley County Chamber of Commerce", logoUrls: [`${GHL}/lU1ZDIbtCxM1kmrB05KF`, `${GHL}/tYLeXlrpsZOYezzz5EjL`], website: "https://www.berkeleycounty.org" },
  { name: "SERVPRO of Washington County", logoUrls: [`${GHL}/5NsG9blipRigO9wlljI0`, `${GHL}/QHWds7L5uaEK8aZXW0zQ`], website: "https://www.servprowashingtoncounty.com" },
  { name: "CMG Home Loans (Joe Gillis)", logoUrls: [`${GHL}/itRKdibmX0Vq7Awi6Njv`], website: "https://www.cmghomeloans.com/mysite/joe-gillis" },
  { name: "Middletown Valley Bank", logoUrls: [`${GHL}/b6lAoK4nfSaOKARdXPxq`, `${GHL}/NMreMpjwQojKcy5SrMQx`], website: "https://mvbbank.com" },
  { name: "Martin's Potato Rolls", logoUrls: [`${GHL}/pNmRCdW88gmXIUc8n33c`], website: "https://www.potatorolls.com" },
  { name: "GS Images", logoUrls: [`${GHL}/InCGNd1wcOofnKelvkGp`], website: "https://gsimages.com" },
  { name: "Hagerstown Magazine", logoUrls: [`${GHL}/A8BwekELZ6nnO745Qz8I`], website: "https://www.hagerstownmagazine.com" },
  { name: "Sterling Settlement Services", logoUrls: [`${GHL}/mEinPxB2wJxeQWqwGSle`, `${GHL}/ntzzxjAqjWaC2PHBW7x9`], website: "https://www.sterlingsettle.com" },
  { name: "River Bottom Roasters", logoUrls: [`${GHL}/m7rdSo2YtXah3eJWU8BZ`] },
  { name: "Barley Snyder", logoUrls: [`${GHL}/tHF4G3VTKCnWbUqHIU2C`], website: "https://www.barley.com" },
  { name: "D.L. Martin Company", logoUrls: [`${GHL}/gMdKNDCGwiKWCpBXyz8Z`], website: "https://www.dlmartin.com" },
  { name: "Shippensburg Area Chamber of Commerce", logoUrls: [`${GHL}/FoASph1El934k1dmo4pJ`], website: "https://shippensburg.org" },
  { name: "Washington County Chamber of Commerce", logoUrls: [`${GHL}/8pzCJrOMi8MqgIDQrBxA`], website: "https://www.hagerstown.org" },
  { name: "Hancock Media", logoUrls: [`${GHL}/9qN33IdpmaM5SRrUs5vk`, `${GHL}/s9MBueYNkYEOEBcBUk5M`], website: "https://www.mhancockmedia.com" },
  { name: "Top of Virginia Regional Chamber", logoUrls: [`${GHL}/RU1L6UV1QzKV5VKz4hIc`], website: "https://www.regionalchamber.biz" },
  { name: "Work Smarter Digital", logoUrls: [`${GHL}/GwUkgXtHlCOL8ZQsAo00`, `${GHL}/n91nPOq32ZLbz0mGnTBs`, `${GHL}/7UwXMiB2Ywuv9uWdsLt8`], website: "https://www.worksmarterdigital.com" },
];

export function assetsForName(name: string): InterestFormAssets | null {
  const key = name.trim().toLowerCase();
  return (
    INTEREST_FORM_ASSETS.find((a) => a.name.toLowerCase() === key) ?? null
  );
}

/** Sniff an image type from magic bytes — GHL serves uploads with generic
    content types, so the header can't be trusted. Returns the storage
    extension, or null for anything that isn't a web-usable image. */
export function sniffImage(
  bytes: Uint8Array,
): { ext: string; contentType: string } | null {
  if (bytes.length < 12) return null;
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { ext: "png", contentType: "image/png" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { ext: "webp", contentType: "image/webp" };
  }
  // SVG: text that opens with an XML/SVG tag (allow BOM + whitespace).
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 256))
    .trimStart()
    .toLowerCase();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) {
    return { ext: "svg", contentType: "image/svg+xml" };
  }
  return null;
}
