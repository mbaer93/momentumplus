import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractYoutubeVideoId,
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
