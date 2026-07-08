import { describe, expect, it, vi } from "vitest";
import { buildTextMap, orderTextNodesByPosition, segmentSentences, rangesForSentence } from "../sentence-navigation.js";

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
});
