import qrcode from "qrcode-generator";

/*
 * Check-in QR for the summit ticket, rendered server-side as inline SVG so
 * it works offline-ish (no image request) and scales crisply on any phone.
 * qrcode-generator is dependency-free and runs fine in the Node runtime.
 */

export function qrSvg(payload: string, label = "Check-in QR code"): string {
  const qr = qrcode(0, "M"); // auto type number, medium error correction
  qr.addData(payload);
  qr.make();

  const n = qr.getModuleCount();
  const quiet = 2; // quiet-zone modules around the symbol
  const size = n + quiet * 2;
  let d = "";
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.isDark(row, col)) {
        d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
    `role="img" aria-label="${label}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/>` +
    `<path d="${d}" fill="#0B1622"/></svg>`
  );
}
