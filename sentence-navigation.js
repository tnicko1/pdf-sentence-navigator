export function buildTextMap(textNodes) {
  let text = "";
  const entries = [];
  for (const node of textNodes) {
    if (typeof node === "string") {
      text += node;
      continue;
    }
    const value = node.nodeValue ?? "";
    if (!value) continue;
    if (text && !/\s$/.test(text) && !/^\s|^[,.;:!?%\)\]\}]/.test(value)) text += " ";
    const start = text.length;
    text += value;
    entries.push({ node, start, end: text.length });
  }
  return { text, entries };
}

export function addBlockSeparators(nodes, recordByNode) {
  const result = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    result.push(node);
    const next = nodes[index + 1];
    if (!next) continue;

    const currentRecord = recordByNode.get(node);
    const nextRecord = recordByNode.get(next);
    // A PDF page boundary is a layout boundary, not necessarily a text-block
    // boundary. Let sentence punctuation decide whether the text continues.
    if (currentRecord.page !== nextRecord.page) continue;
    const verticalGap = nextRecord.top - (currentRecord.top + currentRecord.height);
    const fontSizeTransition = currentRecord.height > nextRecord.height * 1.35;
    const blockGap = verticalGap > Math.max(8, Math.min(currentRecord.height, nextRecord.height) * 0.75);
    if (fontSizeTransition || blockGap) {
      result.push("\n\n");
    }
  }
  return result;
}

export function orderTextNodesByPosition(records) {
  const pages = new Map();
  const seenNodes = new Set();
  for (const record of records) {
    if (seenNodes.has(record.node)) continue;
    seenNodes.add(record.node);
    if (!pages.has(record.page)) pages.set(record.page, []);
    pages.get(record.page).push(record);
  }

  const ordered = [];
  for (const page of [...pages.keys()].sort((a, b) => a - b)) {
    const candidates = pages.get(page).sort((a, b) => a.top - b.top || a.left - b.left);
    const lines = [];

    for (const candidate of candidates) {
      const center = candidate.top + candidate.height / 2;
      const line = lines.find((item) =>
        Math.abs(item.center - center) <= Math.max(3, Math.min(item.height, candidate.height) * 0.6)
      );
      if (line) {
        line.items.push(candidate);
        line.center = (line.center * (line.items.length - 1) + center) / line.items.length;
        line.height = Math.max(line.height, candidate.height);
      } else {
        lines.push({ center, height: candidate.height, items: [candidate] });
      }
    }

    lines.sort((a, b) => a.center - b.center);
    for (const line of lines) {
      line.items.sort((a, b) => a.left - b.left);
      ordered.push(...line.items.map(({ node }) => node));
    }
  }
  return ordered;
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
