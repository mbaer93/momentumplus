import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractOgImage } from "../lib/og-image";

describe("extractOgImage", () => {
  const base = "https://example.com/tools/workbook";

  it("finds og:image in either attribute order", () => {
    assert.equal(
      extractOgImage(
        `<meta property="og:image" content="https://cdn.example.com/a.png"/>`,
        base,
      ),
      "https://cdn.example.com/a.png",
    );
    assert.equal(
      extractOgImage(
        `<meta content="https://cdn.example.com/b.jpg" property="og:image" />`,
        base,
      ),
      "https://cdn.example.com/b.jpg",
    );
  });

  it("falls back to twitter:image and resolves relative URLs", () => {
    assert.equal(
      extractOgImage(`<meta name="twitter:image" content="/img/card.png">`, base),
      "https://example.com/img/card.png",
    );
    assert.equal(
      extractOgImage(
        `<meta property="og:image" content="//cdn.example.com/c.webp">`,
        base,
      ),
      "https://cdn.example.com/c.webp",
    );
  });

  it("returns null when the page advertises no preview image", () => {
    assert.equal(extractOgImage("<html><body>plain</body></html>", base), null);
    assert.equal(extractOgImage(`<meta property="og:title" content="x">`, base), null);
  });
});
