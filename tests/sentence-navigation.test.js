import { describe, expect, it, vi } from "vitest";
import { addBlockSeparators, buildTextMap, orderTextNodesByPosition, segmentSentences, rangesForSentence } from "../sentence-navigation.js";

describe("sentence navigation", () => {
  it("segments Georgian and English sentences", () => {
    const result = segmentSentences("ეს პირველია. ეს მეორეა! Third one?");
    expect(result).toHaveLength(3);
  });

  it("maps a sentence across PDF text nodes", () => {
    const first = { nodeValue: "Hello" };
    const second = { nodeValue: "world. Next." };
    const map = buildTextMap([first, second]);
    expect(map.text).toBe("Hello world. Next.");
    const [sentence] = segmentSentences(map.text, "en");
    const range = { setStart: vi.fn(), setEnd: vi.fn() };
    const ranges = rangesForSentence(sentence, map.entries, () => range);
    expect(ranges).toHaveLength(2);
    expect(range.setStart).toHaveBeenCalled();
    expect(range.setEnd).toHaveBeenCalled();
  });

  it("orders scrambled PDF fragments by page, line, and horizontal position", () => {
    const first = { nodeValue: "First sentence." };
    const second = { nodeValue: "Second sentence." };
    const third = { nodeValue: "Third sentence." };
    const records = [
      { node: third, page: 2, top: 20, left: 10, height: 12 },
      { node: second, page: 1, top: 40, left: 10, height: 12 },
      { node: first, page: 1, top: 20, left: 10, height: 12 }
    ];

    const ordered = orderTextNodesByPosition(records);
    expect(ordered).toEqual([first, second, third]);
    expect(segmentSentences(buildTextMap(ordered).text, "en")).toHaveLength(3);
  });

  it("keeps fragments on the same visual line in left-to-right order", () => {
    const left = { nodeValue: "Left" };
    const right = { nodeValue: "right." };
    const ordered = orderTextNodesByPosition([
      { node: right, page: 1, top: 20.5, left: 100, height: 12 },
      { node: left, page: 1, top: 20, left: 10, height: 12 }
    ]);
    expect(buildTextMap(ordered).text).toBe("Left right.");
  });

  it("does not collect the same nested PDF text node more than once", () => {
    const node = { nodeValue: "Only once." };
    const ordered = orderTextNodesByPosition([
      { node, page: 1, top: 20, left: 10, height: 12 },
      { node, page: 1, top: 20, left: 10, height: 12 }
    ]);
    expect(ordered).toEqual([node]);
    expect(buildTextMap(ordered).text).toBe("Only once.");
  });

  it("separates a large heading from body sentences", () => {
    const heading = { nodeValue: "Sample PDF" };
    const body = { nodeValue: "This is a body sentence." };
    const records = new Map([
      [heading, { node: heading, page: 1, top: 20, left: 10, height: 36 }],
      [body, { node: body, page: 1, top: 80, left: 10, height: 16 }]
    ]);
    const text = buildTextMap(addBlockSeparators([heading, body], records)).text;
    expect(text).toBe("Sample PDF\n\nThis is a body sentence.");
    expect(segmentSentences(text, "en")).toHaveLength(2);
  });

  it("keeps one sentence continuous across a page boundary", () => {
    const pageOne = { nodeValue: "This book is a treatise on the theory of" };
    const pageTwo = { nodeValue: "ethics, very popular during the Renaissance." };
    const records = new Map([
      [pageOne, { node: pageOne, page: 1, top: 700, left: 10, height: 16 }],
      [pageTwo, { node: pageTwo, page: 2, top: 80, left: 10, height: 16 }]
    ]);
    const text = buildTextMap(addBlockSeparators([pageOne, pageTwo], records)).text;
    expect(text).toBe("This book is a treatise on the theory of ethics, very popular during the Renaissance.");
    expect(segmentSentences(text, "en")).toHaveLength(1);
  });

  it("orders right-to-left line fragments from right to left", () => {
    const right = { nodeValue: "שלום" };
    const left = { nodeValue: "עולם." };
    const ordered = orderTextNodesByPosition([
      { node: left, page: 1, top: 20, left: 10, height: 12, direction: "rtl" },
      { node: right, page: 1, top: 20, left: 100, height: 12, direction: "rtl" }
    ]);
    expect(ordered).toEqual([right, left]);
  });

  it("orders vertical text by column and then top-to-bottom", () => {
    const topRight = { nodeValue: "一" }, bottomRight = { nodeValue: "二" }, left = { nodeValue: "三" };
    const ordered = orderTextNodesByPosition([
      { node: left, page: 1, top: 10, left: 50, width: 8, height: 20 },
      { node: bottomRight, page: 1, top: 40, left: 100, width: 8, height: 20 },
      { node: topRight, page: 1, top: 10, left: 100, width: 8, height: 20 }
    ]);
    expect(ordered).toEqual([topRight, bottomRight, left]);
  });
});
