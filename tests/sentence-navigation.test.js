import { describe, expect, it, vi } from "vitest";
import { buildTextMap, segmentSentences, rangesForSentence } from "../sentence-navigation.js";

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
});
