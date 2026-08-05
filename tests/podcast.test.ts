import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approxDateFromRelative,
  collectBrowseVideos,
  extractContinuationToken,
  extractInitialData,
  extractVideoIds,
  extractYoutubeVideoId,
  parseWatchPageMeta,
  parseYoutubeFeed,
} from "../lib/podcast";

describe("extractYoutubeVideoId", () => {
  it("accepts a bare 11-char id", () => {
    assert.equal(extractYoutubeVideoId("abcDEF123-_"), "abcDEF123-_");
  });

  it("parses watch, short, shorts, embed, and live URLs", () => {
    const id = "abcDEF123-_";
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://m.youtube.com/watch?v=${id}&t=42s`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/live/${id}`,
    ]) {
      assert.equal(extractYoutubeVideoId(url), id, url);
    }
  });

  it("rejects non-YouTube URLs and junk", () => {
    assert.equal(extractYoutubeVideoId("https://vimeo.com/12345"), null);
    assert.equal(extractYoutubeVideoId("not a url"), null);
    assert.equal(extractYoutubeVideoId("https://youtube.com/watch?v=short"), null);
    // A lookalike host must not pass.
    assert.equal(
      extractYoutubeVideoId("https://notyoutube.com/watch?v=abcDEF123-_"),
      null,
    );
  });
});

describe("parseYoutubeFeed", () => {
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <title>Branching Out</title>
  <entry>
    <id>yt:video:abcDEF123-_</id>
    <yt:videoId>abcDEF123-_</yt:videoId>
    <title>Episode 12 &amp; the "Roots" of Growth</title>
    <published>2026-08-01T12:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/abcDEF123-_/hqdefault.jpg" width="480" height="360"/>
      <media:description>Show notes line one.
Line two &amp; more.</media:description>
    </media:group>
  </entry>
  <entry>
    <yt:videoId>zyxWVU987_-</yt:videoId>
    <title>Episode 11</title>
    <published>2026-07-25T12:00:00+00:00</published>
    <media:group>
      <media:description></media:description>
    </media:group>
  </entry>
</feed>`;

  it("extracts id, title, notes, thumbnail, and date per entry", () => {
    const entries = parseYoutubeFeed(feed);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].videoId, "abcDEF123-_");
    assert.equal(entries[0].title, 'Episode 12 & the "Roots" of Growth');
    assert.equal(entries[0].showNotes, "Show notes line one.\nLine two & more.");
    assert.equal(
      entries[0].thumbnailUrl,
      "https://i.ytimg.com/vi/abcDEF123-_/hqdefault.jpg",
    );
    assert.equal(entries[0].publishedAt, "2026-08-01T12:00:00+00:00");
  });

  it("falls back to the ytimg thumbnail when the feed omits one", () => {
    const entries = parseYoutubeFeed(feed);
    assert.equal(
      entries[1].thumbnailUrl,
      "https://i.ytimg.com/vi/zyxWVU987_-/hqdefault.jpg",
    );
  });

  it("skips malformed entries and empty feeds", () => {
    assert.deepEqual(parseYoutubeFeed("<feed></feed>"), []);
    const bad = "<feed><entry><yt:videoId>too-short</yt:videoId></entry></feed>";
    assert.deepEqual(parseYoutubeFeed(bad), []);
  });
});

describe("extractVideoIds (back-catalog import)", () => {
  it("dedupes and preserves first-seen order", () => {
    const chunk =
      '{"videoId":"abcDEF123-_","x":1}{"videoId":"zyxWVU987_-"}{"videoId":"abcDEF123-_"}';
    assert.deepEqual(extractVideoIds(chunk), ["abcDEF123-_", "zyxWVU987_-"]);
  });

  it("ignores malformed ids and empty input", () => {
    assert.deepEqual(extractVideoIds('{"videoId":"short"}'), []);
    assert.deepEqual(extractVideoIds(""), []);
  });
});

describe("extractContinuationToken", () => {
  it("finds the browse continuation token", () => {
    const chunk =
      '{"continuationItemRenderer":{"continuationEndpoint":{"continuationCommand":{"token":"4qmFsgKq...ABC","request":"CONTINUATION_REQUEST_TYPE_BROWSE"}}}}';
    assert.equal(extractContinuationToken(chunk), "4qmFsgKq...ABC");
  });

  it("returns null when there is no next page", () => {
    assert.equal(extractContinuationToken('{"noMore":true}'), null);
  });
});

describe("parseWatchPageMeta", () => {
  const html =
    '<html><head><meta name="title" content="Branching Out Ep. 3 &amp; Growth"></head>' +
    '<body><script>var ytInitialPlayerResponse = {"videoDetails":{' +
    '"shortDescription":"Line one.\\nLine two with \\"quotes\\"."},' +
    '"microformat":{"playerMicroformatRenderer":{"uploadDate":"2025-11-12"}}};</script></body></html>';

  it("pulls title, unescaped notes, and the exact upload date", () => {
    const meta = parseWatchPageMeta(html);
    assert.equal(meta.title, "Branching Out Ep. 3 & Growth");
    assert.equal(meta.showNotes, 'Line one.\nLine two with "quotes".');
    assert.equal(meta.uploadDate, "2025-11-12");
  });

  it("degrades to empty fields on unrecognized markup", () => {
    const meta = parseWatchPageMeta("<html></html>");
    assert.equal(meta.title, "");
    assert.equal(meta.showNotes, "");
    assert.equal(meta.uploadDate, null);
  });
});

describe("collectBrowseVideos", () => {
  it("reads the current lockupViewModel shape (verified live 2026-08)", () => {
    const node = {
      contents: [
        {
          richItemRenderer: {
            content: {
              lockupViewModel: {
                contentId: "abcDEF123-_",
                contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
                metadata: {
                  lockupMetadataViewModel: {
                    title: { content: "Episode 4 — Deep Roots" },
                    metadata: {
                      contentMetadataViewModel: {
                        metadataRows: [
                          {
                            metadataParts: [
                              { text: { content: "1.2K views" } },
                              { text: { content: "2 years ago" } },
                            ],
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    };
    const vids = collectBrowseVideos(node);
    assert.equal(vids.length, 1);
    assert.equal(vids[0].videoId, "abcDEF123-_");
    assert.equal(vids[0].title, "Episode 4 — Deep Roots");
    assert.equal(vids[0].publishedText, "2 years ago");
  });

  it("reads the classic videoRenderer shape and dedupes", () => {
    const node = [
      {
        videoRenderer: {
          videoId: "zyxWVU987_-",
          title: { runs: [{ text: "Old " }, { text: "Layout" }] },
          descriptionSnippet: { runs: [{ text: "Snippet text" }] },
          publishedTimeText: { simpleText: "3 months ago" },
        },
      },
      { videoRenderer: { videoId: "zyxWVU987_-", title: { runs: [] } } },
    ];
    const vids = collectBrowseVideos(node);
    assert.equal(vids.length, 1);
    assert.equal(vids[0].title, "Old Layout");
    assert.equal(vids[0].snippet, "Snippet text");
    assert.equal(vids[0].publishedText, "3 months ago");
  });

  it("returns nothing for playlists, nulls, and junk", () => {
    assert.deepEqual(
      collectBrowseVideos({
        contentId: "abcDEF123-_",
        contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST",
        metadata: {},
      }),
      [],
    );
    assert.deepEqual(collectBrowseVideos(null), []);
  });
});

describe("approxDateFromRelative", () => {
  const now = Date.UTC(2026, 7, 5, 12, 0, 0);
  it("converts years/months/weeks back from now", () => {
    assert.equal(
      approxDateFromRelative("2 years ago", now)?.slice(0, 4),
      "2024",
    );
    assert.equal(
      approxDateFromRelative("6 months ago", now)?.slice(0, 7),
      "2026-02",
    );
  });
  it("handles Streamed prefix and rejects non-relative text", () => {
    assert.ok(approxDateFromRelative("Streamed 3 weeks ago", now));
    assert.equal(approxDateFromRelative("Premieres tomorrow", now), null);
    assert.equal(approxDateFromRelative("", now), null);
  });
});

describe("extractInitialData", () => {
  it("parses the embedded ytInitialData object", () => {
    const html =
      '<script>var ytInitialData = {"a":{"videoId":"abcDEF123-_"}};</script>';
    assert.deepEqual(extractInitialData(html), {
      a: { videoId: "abcDEF123-_" },
    });
  });
  it("returns null when absent or malformed", () => {
    assert.equal(extractInitialData("<html></html>"), null);
    assert.equal(
      extractInitialData("<script>var ytInitialData = {broken};</script>"),
      null,
    );
  });
});
