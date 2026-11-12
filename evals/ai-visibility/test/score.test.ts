// Scoring: named, cited and the position of the first mention.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findMentions, isOwnUrl, locate, scoreAnswer } from "../panel.ts";

describe("named", () => {
  it("counts the organization's name, not the generic phrase", () => {
    assert.equal(scoreAnswer("Join Colorado Startups on Slack.", []).named, true);
    assert.equal(scoreAnswer("Resources for Colorado startups and founders.", []).named, false);
    assert.equal(scoreAnswer("colorado startups are many.", []).named, false);
  });

  it("counts the one-word handle and the domain in prose", () => {
    assert.equal(scoreAnswer("Follow @ColoradoStartups.", []).named, true);
    assert.equal(scoreAnswer("See coloradostartups.org for the directory.", []).named, true);
  });

  it("does not count look-alike domains or our domain inside another site's URL", () => {
    const text = "Try notcoloradostartups.org, coloradostartups.org.example.net or https://evil.example/?ref=coloradostartups.org today.";
    assert.deepEqual(findMentions(text), []);
  });

  it("keeps one mention when two patterns overlap, with a snippet for a person to check", () => {
    const m = findMentions("Start at ColoradoStartups.org today.");
    assert.equal(m.length, 1);
    assert.equal(m[0]!.offset, 9);
    assert.match(m[0]!.snippet, /Start at ColoradoStartups\.org today\./);
  });

  it("does not join the name across a line break", () => {
    assert.equal(scoreAnswer("Colorado\nStartups", []).named, false);
  });
});

describe("cited", () => {
  it("accepts the domain and its subdomains, and rejects look-alikes", () => {
    assert.equal(isOwnUrl("https://coloradostartups.org/resources/?utm_source=openai"), true);
    assert.equal(isOwnUrl("https://www.coloradostartups.org/"), true);
    assert.equal(isOwnUrl("coloradostartups.org/leaderboard/"), true);
    assert.equal(isOwnUrl("https://COLORADOSTARTUPS.ORG./"), true);
    assert.equal(isOwnUrl("https://notcoloradostartups.org/"), false);
    assert.equal(isOwnUrl("https://coloradostartups.org.example.net/"), false);
    assert.equal(isOwnUrl("https://evil.example/?ref=coloradostartups.org"), false);
    assert.equal(isOwnUrl("not a url at all"), false);
  });

  it("records where the citation came from", () => {
    assert.deepEqual(scoreAnswer("No links here.", ["https://coloradostartups.org/"]).citedVia, ["citation"]);
    assert.deepEqual(scoreAnswer("See [the directory](https://coloradostartups.org/resources/).", []).citedVia, ["text"]);
    assert.deepEqual(scoreAnswer("Visit coloradostartups.org.", []).citedVia, ["text"]);
    const both = scoreAnswer("See https://coloradostartups.org/.", ["https://www.coloradostartups.org/"]);
    assert.deepEqual(both.citedVia, ["citation", "text"]);
    assert.deepEqual(both.ownUrls, ["https://www.coloradostartups.org/", "https://coloradostartups.org/"]);
  });

  it("is not fooled by our domain inside another site's URL", () => {
    const s = scoreAnswer("A roundup at https://evil.example/?ref=coloradostartups.org now.", ["https://evil.example/?ref=coloradostartups.org"]);
    assert.equal(s.cited, false);
    assert.equal(s.named, false);
  });

  it("can be cited without being named", () => {
    const s = scoreAnswer("Meetups happen across the state [1].", ["https://coloradostartups.org/events/"]);
    assert.equal(s.named, false);
    assert.equal(s.cited, true);
    assert.equal(s.position, null);
    assert.equal(s.namedFirst, false);
  });
});

describe("position", () => {
  it("ranks the list item that holds the first mention", () => {
    const text = "Options:\n\n1. **Peak Labs** in Boulder.\n2. **Colorado Startups** statewide.\n3. **Mesa Hub** in Grand Junction.";
    const s = scoreAnswer(text, []);
    assert.equal(s.position?.unit, "list");
    assert.equal(s.position?.rank, 2);
    assert.equal(s.position?.units, 3);
    assert.equal(s.position?.inLead, false);
    assert.equal(s.position?.offset, text.indexOf("Colorado Startups"));
    assert.equal(s.namedFirst, false);
  });

  it("keeps nested bullets inside their parent item", () => {
    const text = "- Peak Labs\n  - also runs demo days\n  - see their site\n- Colorado Startups\n  - Slack";
    const p = locate(text, text.indexOf("Colorado Startups"));
    assert.equal(p.rank, 2);
    assert.equal(p.units, 2);
  });

  it("ranks a mention in the lead above the list first", () => {
    const text = "Colorado Startups is the place to start.\n\n- Peak Labs\n- Mesa Hub";
    const s = scoreAnswer(text, []);
    assert.equal(s.position?.rank, 1);
    assert.equal(s.position?.inLead, true);
    assert.equal(s.namedFirst, true);
  });

  it("ranks prose after the list after every item", () => {
    const text = "- Peak Labs\n- Mesa Hub\n\nYou can also join Colorado Startups.";
    const p = locate(text, text.indexOf("Colorado Startups"));
    assert.equal(p.rank, 3);
    assert.equal(p.units, 2);
    assert.equal(p.inLead, false);
  });

  it("uses headings when the answer has no list", () => {
    const text = "Intro.\n\n## Peak Labs\nAn accelerator.\n\n## Colorado Startups\nA community.";
    const p = locate(text, text.indexOf("Colorado Startups"));
    assert.equal(p.unit, "heading");
    assert.equal(p.rank, 2);
  });

  it("uses paragraphs when the answer has neither", () => {
    const text = "Boulder has many options.\n\nOne is Peak Labs.\n\nAnother is Colorado Startups.";
    const p = locate(text, text.indexOf("Colorado Startups"));
    assert.equal(p.unit, "paragraph");
    assert.equal(p.rank, 3);
    assert.equal(p.units, 3);
    assert.equal(p.share, Math.round((text.indexOf("Colorado Startups") / text.length) * 100) / 100);
  });
});
