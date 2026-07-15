/*
 * Open Graph image extraction: given a page's HTML, find the preview image
 * the site itself advertises (og:image / twitter:image) — the same artwork
 * shown when the link is shared on social. Pure and unit-tested; fetching
 * and storage happen in the resources admin action.
 */

const META_PATTERNS = [
  /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/i,
  /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:image(?::src)?["']/i,
];

export function extractOgImage(html: string, baseUrl: string): string | null {
  for (const pattern of META_PATTERNS) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const raw = match[1].trim();
      try {
        // Resolves protocol-relative and path-relative URLs against the page.
        return new URL(raw, baseUrl).toString();
      } catch {
        continue;
      }
    }
  }
  return null;
}
