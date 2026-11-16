import { parseMarkdownBlocks, type MarkdownBlock } from './markdown-blocks';

export interface BlockRow {
  id: string;
  block: MarkdownBlock;
}
export interface BlockDocument {
  source: string;
  rows: BlockRow[];
}

/** Retain native input identity across edits, splits, joins and IME updates. */
export function reconcileBlockDocument(source: string, previous?: BlockDocument): BlockDocument {
  const parsed = parseMarkdownBlocks(source);
  const ids = new Map<number, string>();
  let first = 0;
  let previousLast = (previous?.rows.length ?? 0) - 1;
  let nextLast = parsed.length - 1;
  if (previous) {
    const same = (oldIndex: number, newIndex: number) => {
      const old = previous.rows[oldIndex]!.block;
      const next = parsed[newIndex]!;
      return previous.source.slice(old.start, old.end) === source.slice(next.start, next.end);
    };
    while (first <= previousLast && first <= nextLast && same(first, first)) {
      ids.set(first, previous.rows[first]!.id);
      first++;
    }
    while (previousLast >= first && nextLast >= first && same(previousLast, nextLast)) {
      ids.set(nextLast, previous.rows[previousLast]!.id);
      previousLast--;
      nextLast--;
    }
    // The first changed row keeps its input when its prefix becomes a list/heading.
    for (let index = first; index <= nextLast && index - first <= previousLast - first; index++) {
      ids.set(index, previous.rows[index]!.id);
    }
  }
  const existing = new Set(previous?.rows.map((row) => row.id));
  let sequence = 0;
  const rows = parsed.map((block, index) => {
    let id = ids.get(index);
    if (!id) {
      do {
        id = `block-${sequence++}`;
      } while (existing.has(id));
      existing.add(id);
    }
    return { id, block };
  });
  return { source, rows };
}

export function rowAtOffset(document: BlockDocument, offset: number): BlockRow {
  for (let index = document.rows.length - 1; index >= 0; index--) {
    const row = document.rows[index]!;
    if (offset >= row.block.start) {
      return row;
    }
  }
  return document.rows[0]!;
}
