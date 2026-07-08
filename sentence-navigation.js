export function buildTextMap(textNodes) {
  let text = "";
  const entries = [];
  for (const node of textNodes) {
    const value = node.nodeValue ?? "";
    if (!value) continue;
    if (text && !/\s$/.test(text) && !/^\s|^[,.;:!?%\)\]\}]/.test(value)) text += " ";
    const start = text.length;
    text += value;
    entries.push({ node, start, end: text.length });
  }
  return { text, entries };
}

export function segmentSentences(text, locale) {
  const segmenter = new Intl.Segmenter(locale || undefined, { granularity: "sentence" });
  return [...segmenter.segment(text)]
    .map(({ index, segment }) => ({ start: index, end: index + segment.length }))
    .filter(({ start, end }) => text.slice(start, end).trim().length > 0);
}

export function rangesForSentence(sentence, entries, createRange = () => document.createRange()) {
  const ranges = [];
  for (const entry of entries) {
    const start = Math.max(sentence.start, entry.start);
    const end = Math.min(sentence.end, entry.end);
    if (start >= end) continue;
    const range = createRange();
    range.setStart(entry.node, start - entry.start);
    range.setEnd(entry.node, end - entry.start);
    ranges.push(range);
  }
  return ranges;
}
