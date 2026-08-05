import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approxDateFromRelative,
  assignSeasonsByNumbering,
  enforceDescendingDates,
  collectBrowseVideos,
  episodeNumberFromText,
  extractContinuationToken,
  extractInitialData,
  extractVideoIds,
  extractYoutubeVideoId,
  parseIsoDuration,
  parsePlaylistItemsPage,
  parsePlaylistsPage,
  parseVideoDurationsPage,
  parseWatchPageMeta,
  parseYoutubeFeed,
  seasonFromText,
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

describe("enforceDescendingDates", () => {
  const now = Date.UTC(2026, 7, 5, 12, 0, 0);
  it("keeps exact dates that already descend", () => {
    const out = enforceDescendingDates(
      ["2026-08-01T00:00:00Z", "2026-07-01T00:00:00Z"],
      now,
    );
    assert.equal(out[0], "2026-08-01T00:00:00.000Z");
    assert.equal(out[1], "2026-07-01T00:00:00.000Z");
  });

  it("clamps out-of-order and duplicate dates below the newer neighbor", () => {
    const dup = "2025-01-01T00:00:00Z";
    const out = enforceDescendingDates([dup, dup, "2026-01-01T00:00:00Z"], now);
    assert.ok(Date.parse(out[0]) > Date.parse(out[1]));
    assert.ok(Date.parse(out[1]) > Date.parse(out[2]));
  });

  it("fills nulls a day below the previous episode", () => {
    const out = enforceDescendingDates(["2026-06-01T00:00:00Z", null, null], now);
    assert.ok(Date.parse(out[0]) > Date.parse(out[1]));
    assert.ok(Date.parse(out[1]) > Date.parse(out[2]));
    assert.equal(Date.parse(out[0]) - Date.parse(out[1]), 24 * 3_600_000);
  });

  it("list order always wins — output is strictly descending for any input", () => {
    const out = enforceDescendingDates(
      [null, "2020-01-01T00:00:00Z", "2024-06-06T00:00:00Z", null, "garbage"],
      now,
    );
    for (let i = 1; i < out.length; i++) {
      assert.ok(Date.parse(out[i]) < Date.parse(out[i - 1]));
    }
  });
});

describe("parseIsoDuration", () => {
  it("parses hour/minute/second combinations", () => {
    assert.equal(parseIsoDuration("PT1H2M10S"), 3730);
    assert.equal(parseIsoDuration("PT58S"), 58);
    assert.equal(parseIsoDuration("PT45M"), 2700);
    assert.equal(parseIsoDuration("P1DT2H"), 93_600);
  });

  it("rejects garbage", () => {
    assert.equal(parseIsoDuration("nope"), null);
    assert.equal(parseIsoDuration("P"), null);
    assert.equal(parseIsoDuration(""), null);
  });
});

describe("parsePlaylistItemsPage", () => {
  const page = {
    nextPageToken: "TOKEN2",
    items: [
      {
        snippet: {
          title: "Episode 40",
          description: "Full show notes here",
          resourceId: { videoId: "abcDEF123-_" },
          thumbnails: { high: { url: "https://i.ytimg.com/vi/abcDEF123-_/hq.jpg" } },
        },
        contentDetails: { videoPublishedAt: "2025-06-01T12:00:00Z" },
      },
      {
        // deleted video: no videoPublishedAt — must be skipped
        snippet: { title: "Deleted video", resourceId: { videoId: "deadbeef000" } },
        contentDetails: {},
      },
      {
        snippet: {
          title: "Episode 39",
          description: "",
          resourceId: { videoId: "zyxWVU987-_" },
        },
        contentDetails: { videoPublishedAt: "2025-05-01T12:00:00Z" },
      },
    ],
  };

  it("keeps published videos with exact dates and skips deleted/private ones", () => {
    const { videos, nextPageToken } = parsePlaylistItemsPage(page);
    assert.equal(nextPageToken, "TOKEN2");
    assert.equal(videos.length, 2);
    assert.equal(videos[0].videoId, "abcDEF123-_");
    assert.equal(videos[0].title, "Episode 40");
    assert.equal(videos[0].showNotes, "Full show notes here");
    assert.equal(videos[0].publishedAt, "2025-06-01T12:00:00.000Z");
    assert.equal(videos[0].thumbnailUrl, "https://i.ytimg.com/vi/abcDEF123-_/hq.jpg");
    // no thumbnails in the payload → i.ytimg fallback
    assert.equal(videos[1].thumbnailUrl, "https://i.ytimg.com/vi/zyxWVU987-_/hqdefault.jpg");
  });

  it("degrades to empty on the last page / malformed payloads", () => {
    assert.deepEqual(parsePlaylistItemsPage({}), { videos: [], nextPageToken: null });
    assert.deepEqual(parsePlaylistItemsPage(null), { videos: [], nextPageToken: null });
  });
});

describe("parseVideoDurationsPage", () => {
  it("maps ids to seconds and skips unparseable rows", () => {
    const map = parseVideoDurationsPage({
      items: [
        { id: "abcDEF123-_", contentDetails: { duration: "PT1H1M" } },
        { id: "shortvid001", contentDetails: { duration: "PT45S" } },
        { id: "broken00000", contentDetails: { duration: "??" } },
        { contentDetails: { duration: "PT1M" } },
      ],
    });
    assert.equal(map.get("abcDEF123-_"), 3660);
    assert.equal(map.get("shortvid001"), 45);
    assert.equal(map.size, 2);
  });
});

describe("seasonFromText", () => {
  it("reads Season N in playlist and episode titles", () => {
    assert.equal(seasonFromText("Season 2"), 2);
    assert.equal(seasonFromText("Branching Out — Season 3"), 3);
    assert.equal(seasonFromText("Season #4 premiere"), 4);
  });

  it("reads SxEy episode markers", () => {
    assert.equal(seasonFromText("S2E14 — Growing Together"), 2);
    assert.equal(seasonFromText("S02 E05: Roots"), 2);
    assert.equal(seasonFromText("S3, Ep. 1 — New Beginnings"), 3);
  });

  it("ignores titles without a season marker", () => {
    assert.equal(seasonFromText("Why this season matters"), null);
    assert.equal(seasonFromText("Favorites and best-ofs"), null);
    assert.equal(seasonFromText("Season 2026 kickoff"), null); // > 999
    assert.equal(seasonFromText(""), null);
  });
});

describe("parsePlaylistsPage", () => {
  it("collects playlist ids and titles", () => {
    const { playlists, nextPageToken } = parsePlaylistsPage({
      nextPageToken: "T2",
      items: [
        { id: "PL111", snippet: { title: "Season 1" } },
        { id: "PL222", snippet: { title: "Shorts & clips" } },
        { snippet: { title: "no id — skipped" } },
      ],
    });
    assert.equal(nextPageToken, "T2");
    assert.deepEqual(playlists, [
      { id: "PL111", title: "Season 1" },
      { id: "PL222", title: "Shorts & clips" },
    ]);
  });

  it("degrades to empty on malformed payloads", () => {
    assert.deepEqual(parsePlaylistsPage(null), { playlists: [], nextPageToken: null });
    assert.deepEqual(parsePlaylistsPage({}), { playlists: [], nextPageToken: null });
  });
});

describe("episodeNumberFromText", () => {
  it("reads Episode N and Ep. N titles", () => {
    assert.equal(episodeNumberFromText('Episode 9: "Self-Care Is a Leadership Issue"'), 9);
    assert.equal(episodeNumberFromText("Ep. 12 — Growth"), 12);
    assert.equal(episodeNumberFromText("Episode #46: Connecting People"), 46);
    assert.equal(episodeNumberFromText("Season Premiere! Episode 1: Branching Out Again"), 1);
  });

  it("returns null without an episode marker", () => {
    assert.equal(episodeNumberFromText("Two Sides of the Same Coin"), null);
    assert.equal(episodeNumberFromText("Discovering John Maxwell's Growth Laws"), null);
  });
});

describe("assignSeasonsByNumbering", () => {
  const ep = (id: string, title: string, iso: string) => ({
    id,
    title,
    publishedAt: iso,
  });

  it("detects seasons from numbering restarts (real channel shape)", () => {
    const map = assignSeasonsByNumbering([
      // deliberately shuffled — the walk sorts by date
      ep("s2e1", "Season Premiere! Episode 1: Branching Out Again", "2025-01-05T12:00:00Z"),
      ep("s1e46", "Episode 46: Connecting People, Creating Impact", "2024-11-01T12:00:00Z"),
      ep("s1e1", "Episode 1: The Beginning", "2023-01-01T12:00:00Z"),
      ep("s1e47", "Episode 47: Leadership That Stands the Test of Time", "2024-11-08T12:00:00Z"),
      ep("s2e9", "Episode 9: When Tomorrow Never Comes", "2025-03-05T12:00:00Z"),
      ep("clip", "Two Sides of the Same Coin", "2025-02-01T12:00:00Z"),
      ep("s3e1", "Episode 1: Season Premiere - Building a Life", "2026-06-01T12:00:00Z"),
      ep("s3e2", "Episode 2: Dreamers That Do", "2026-06-08T12:00:00Z"),
    ]);
    assert.equal(map.get("s1e1"), 1);
    assert.equal(map.get("s1e46"), 1);
    assert.equal(map.get("s1e47"), 1);
    assert.equal(map.get("s2e1"), 2);
    assert.equal(map.get("s2e9"), 2);
    assert.equal(map.get("s3e1"), 3);
    assert.equal(map.get("s3e2"), 3);
    assert.equal(map.has("clip"), false); // no episode number → Extras
  });

  it("tolerates a missing premiere (restart seen at Episode 2)", () => {
    const map = assignSeasonsByNumbering([
      ep("a", "Episode 46: Finale", "2024-11-01T12:00:00Z"),
      ep("b", "Episode 2: Second episode of the new run", "2025-01-12T12:00:00Z"),
    ]);
    assert.equal(map.get("a"), 1);
    assert.equal(map.get("b"), 2);
  });

  it("does not split on slightly out-of-order numbering", () => {
    const map = assignSeasonsByNumbering([
      ep("a", "Episode 1: Start", "2025-01-01T12:00:00Z"),
      ep("b", "Episode 3: Early", "2025-01-08T12:00:00Z"),
      ep("c", "Episode 2: Late upload", "2025-01-09T12:00:00Z"),
      ep("d", "Episode 4: Onward", "2025-01-15T12:00:00Z"),
    ]);
    assert.equal(map.get("c"), 1);
    assert.equal(map.get("d"), 1);
  });

  it("skips undated episodes without affecting the walk", () => {
    const map = assignSeasonsByNumbering([
      ep("a", "Episode 5: Dated", "2025-01-01T12:00:00Z"),
      { id: "x", title: "Episode 1: No date", publishedAt: null },
    ]);
    assert.equal(map.get("a"), 1);
    assert.equal(map.has("x"), false);
  });
});
