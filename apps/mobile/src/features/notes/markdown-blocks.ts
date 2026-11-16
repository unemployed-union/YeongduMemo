import { LIVE_MARKDOWN_LIMIT } from './live-markdown';

export type BlockKind = 'paragraph' | 'heading' | 'bullet' | 'ordered' | 'task' | 'quote' | 'code';
export interface MarkdownBlock {
  kind: BlockKind;
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  prefix: string;
  ending: string;
  indent: string;
  depth: number;
  level: number;
  number: number;
  checked: boolean;
  fenced: boolean;
  language: string;
}
export interface MarkdownSelection {
  start: number;
  end: number;
}
export interface BlockEdit {
  source: string;
  selection: MarkdownSelection;
}
export const BLOCK_COUNT_LIMIT = 500;

function linesOf(source: string) {
  const lines: { start: number; end: number; text: string; ending: string }[] = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    lines.push({ start: match.index, end: pattern.lastIndex, text: match[1]!, ending: match[2]! });
    if (!match[2]) {
      break;
    }
  }
  return lines;
}

/** Source offsets are authoritative. Parsing and rendering never serialize the document. */
export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = linesOf(source);
  const blocks: MarkdownBlock[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const block: MarkdownBlock = {
      kind: 'paragraph',
      start: line.start,
      end: line.end,
      contentStart: line.start,
      contentEnd: line.end - line.ending.length,
      prefix: '',
      ending: line.ending,
      indent: '',
      depth: 0,
      level: 0,
      number: 0,
      checked: false,
      fenced: false,
      language: '',
    };
    const fence = /^ {0,3}(`{3,}|~{3,})([^`~]*)$/.exec(line.text);
    if (fence && line.ending) {
      let closing = index + 1;
      while (closing < lines.length) {
        const match = /^ {0,3}(`{3,}|~{3,})[\t ]*$/.exec(lines[closing]!.text);
        if (match && match[1]![0] === fence[1]![0] && match[1]!.length >= fence[1]!.length) {
          break;
        }
        closing++;
      }
      const last = lines[closing];
      block.kind = 'code';
      block.fenced = true;
      block.language = fence[2]!.trim();
      block.prefix = source.slice(line.start, line.end);
      block.contentStart = line.end;
      block.contentEnd = last?.start ?? source.length;
      block.end = last?.end ?? source.length;
      block.ending = last?.ending ?? '';
      blocks.push(block);
      index = last ? closing : lines.length;
      continue;
    }

    const list = /^([\t ]*)([-+*]|\d{1,9}[.)])([\t ]+)(?:\[([ xX])\]([\t ]+))?/.exec(line.text);
    const heading = /^( {0,3})(#{1,6})[\t ]+/.exec(line.text);
    const quote = /^( {0,3})((?:>[\t ]?)+)/.exec(line.text);
    if (list) {
      block.indent = list[1]!;
      block.prefix = list[0];
      block.depth = Math.min(8, Math.floor(block.indent.replace(/\t/g, '    ').length / 2));
      if (list[4] !== undefined && !/^\d/.test(list[2]!)) {
        block.kind = 'task';
        block.checked = list[4]!.toLowerCase() === 'x';
      } else if (/^\d/.test(list[2]!)) {
        block.kind = 'ordered';
        block.prefix = list[1]! + list[2]! + list[3]!;
        block.number = Number.parseInt(list[2]!, 10);
      } else {
        block.kind = 'bullet';
      }
    } else if (heading) {
      block.kind = 'heading';
      block.level = heading[2]!.length;
      block.indent = heading[1]!;
      block.prefix = heading[0];
    } else if (quote) {
      block.kind = 'quote';
      block.indent = quote[1]!;
      block.prefix = quote[0];
      block.depth = [...quote[2]!].filter((character) => character === '>').length - 1;
    }
    block.contentStart += block.prefix.length;
    blocks.push(block);
  }
  return blocks;
}

export function supportsBlockEditing(source: string): boolean {
  if (source.length > LIVE_MARKDOWN_LIMIT) {
    return false;
  }
  return parseMarkdownBlocks(source).length <= BLOCK_COUNT_LIMIT;
}

export function blockText(source: string, block: MarkdownBlock) {
  return source.slice(block.contentStart, block.contentEnd);
}

function result(source: string, cursor: number): BlockEdit {
  return { source, selection: { start: cursor, end: cursor } };
}

function splice(source: string, start: number, end: number, replacement: string): BlockEdit {
  return result(
    source.slice(0, start) + replacement + source.slice(end),
    start + replacement.length,
  );
}

function nextPrefix(block: MarkdownBlock) {
  if (block.kind === 'ordered') {
    return block.prefix.replace(/\d+/, String(block.number + 1));
  }
  if (block.kind === 'task') {
    return block.prefix.replace(/\[[ xX]\]/, '[ ]');
  }
  if (block.kind === 'bullet' || block.kind === 'quote') {
    return block.prefix;
  }
  return '';
}

function withoutOneIndent(indent: string) {
  if (indent.endsWith('\t')) {
    return indent.slice(0, -1);
  }
  return indent.slice(0, Math.max(0, indent.length - 2));
}

/** Only changes the range edited by the user; untouched Markdown and line endings survive. */
export function editBlockText(source: string, block: MarkdownBlock, text: string): BlockEdit {
  const previous = blockText(source, block);
  let commonStart = 0;
  while (
    commonStart < previous.length &&
    commonStart < text.length &&
    previous[commonStart] === text[commonStart]
  ) {
    commonStart++;
  }
  let commonEnd = 0;
  while (
    commonEnd < previous.length - commonStart &&
    commonEnd < text.length - commonStart &&
    previous[previous.length - 1 - commonEnd] === text[text.length - 1 - commonEnd]
  ) {
    commonEnd++;
  }
  const inserted = text.slice(commonStart, text.length - commonEnd);
  const removedLength = previous.length - commonStart - commonEnd;
  const isReturn =
    (inserted === '\n' || inserted === '\r\n') && removedLength === 0 && !block.fenced;
  if (isReturn) {
    const structured = block.kind !== 'paragraph' && block.kind !== 'code';
    if (structured && previous.trim() === '') {
      const nestedList =
        block.indent &&
        (block.kind === 'bullet' || block.kind === 'ordered' || block.kind === 'task');
      const prefix = nestedList
        ? withoutOneIndent(block.indent) + block.prefix.slice(block.indent.length)
        : '';
      return splice(source, block.start, block.contentEnd, prefix);
    }
    const ending = block.ending || /\r\n|\n|\r/.exec(source)?.[0] || '\n';
    const continuation = nextPrefix(block);
    const replacement =
      previous.slice(0, commonStart) + ending + continuation + previous.slice(commonStart);
    const changed = splice(source, block.contentStart, block.contentEnd, replacement);
    return result(
      changed.source,
      block.contentStart + commonStart + ending.length + continuation.length,
    );
  }
  const changed = splice(source, block.contentStart, block.contentEnd, text);
  return result(changed.source, block.contentStart + text.length - commonEnd);
}

export function backspaceBlockStart(
  source: string,
  blocks: MarkdownBlock[],
  index: number,
): BlockEdit | null {
  const block = blocks[index];
  if (!block) {
    return null;
  }
  if (block.fenced) {
    if (blockText(source, block) === '') {
      return splice(source, block.start, block.end, block.ending);
    }
    return null;
  }
  if (block.prefix) {
    let replacement = block.indent;
    if (block.kind === 'task') {
      replacement = block.prefix.replace(/\[[ xX]\][\t ]+$/, '');
    } else if (block.indent && (block.kind === 'bullet' || block.kind === 'ordered')) {
      replacement = withoutOneIndent(block.indent) + block.prefix.slice(block.indent.length);
    } else if (block.kind === 'quote' && block.depth > 0) {
      replacement = block.prefix.replace(/>[\t ]?/, '');
    }
    return splice(source, block.start, block.contentStart, replacement);
  }
  const previous = blocks[index - 1];
  if (!previous || previous.fenced) {
    return null;
  }
  return splice(source, previous.end - previous.ending.length, block.start, '');
}

export function toggleTask(source: string, block: MarkdownBlock): BlockEdit {
  if (block.kind !== 'task') {
    return result(source, block.contentStart);
  }
  const checkbox = /\[([ xX])\]/.exec(block.prefix)!;
  const position = block.start + checkbox.index + 1;
  return splice(source, position, position + 1, block.checked ? ' ' : 'x');
}

export function insertBlockFormat(
  source: string,
  selection: MarkdownSelection,
  before: string,
  after: string,
): BlockEdit {
  selection = {
    start: Math.max(0, Math.min(source.length, selection.start)),
    end: Math.max(0, Math.min(source.length, selection.end)),
  };
  const blocks = parseMarkdownBlocks(source);
  const block =
    blocks.find((item) => selection.start >= item.start && selection.start < item.end) ??
    blocks.at(-1)!;
  const isBlockPrefix =
    /^(?:#{1,6} |[-*+] |\d+[.)] |[-*+] \[[ xX]\] |> )$/.test(before) && after === '';
  if (isBlockPrefix && !block.fenced) {
    return splice(source, block.start, block.contentStart, block.indent + before);
  }
  const replacement = before + source.slice(selection.start, selection.end) + after;
  const changed = splice(source, selection.start, selection.end, replacement);
  return result(changed.source, selection.end + before.length);
}
