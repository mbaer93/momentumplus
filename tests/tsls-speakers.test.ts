import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTslsSpeakers, speakerNameKey } from "../lib/tsls-speakers";

describe("speakerNameKey", () => {
  it("drops credentials, middle initials, periods, and casing", () => {
    assert.equal(speakerNameKey("Holly Bertone, PMP"), "holly bertone");
    assert.equal(speakerNameKey("Holly J. Bertone"), "holly bertone");
    assert.equal(speakerNameKey("HOLLY BERTONE"), "holly bertone");
    assert.equal(speakerNameKey("Rob Wentz"), "rob wentz");
  });

  it("keeps real multi-part names intact", () => {
    assert.equal(speakerNameKey("Mary Ann Smith"), "mary ann smith");
    assert.equal(speakerNameKey("Katie Nelson"), "katie nelson");
  });
});

describe("parseTslsSpeakers", () => {
  it("parses well-formed entries with role defaulting to main", () => {
    const parsed = parseTslsSpeakers({
      speakers: [
        {
          name: "Holly Bertone, PMP",
          email: "Holly@Example.com",
          title: "Keynote",
          role: "main",
          tags: ["Leadership"],
        },
        { name: "Panel Person", role: "panelist" },
        { name: "The Emcee", role: "emcee" },
        { name: "No Role Given" },
      ],
    });
    assert.equal(parsed.length, 4);
    assert.equal(parsed[0].email, "holly@example.com");
    assert.equal(parsed[1].role, "panelist");
    assert.equal(parsed[2].role, "emcee");
    assert.equal(parsed[3].role, "main");
  });

  it("skips malformed entries and tolerates junk payloads", () => {
    assert.deepEqual(parseTslsSpeakers(null), []);
    assert.deepEqual(parseTslsSpeakers({}), []);
    assert.deepEqual(parseTslsSpeakers({ speakers: "nope" }), []);
    const parsed = parseTslsSpeakers({
      speakers: [{ name: "" }, 42, { name: "Real Person", email: "not-an-email" }],
    });
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].name, "Real Person");
    assert.equal(parsed[0].email, null);
  });
});
