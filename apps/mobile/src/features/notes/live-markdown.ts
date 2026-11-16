import type { MarkdownRange } from '@expensify/react-native-live-markdown';

export const LIVE_MARKDOWN_LIMIT = 100_000;
const RANGE_LIMIT = 4000;

/** Style ranges only: the Markdown string is never rewritten or serialized as rich text. */
export function parseLiveMarkdown(input: string, inlineOnly = false): MarkdownRange[] {
  'worklet';

  if (input.length > LIVE_MARKDOWN_LIMIT) {
    return [];
  }

  const ranges: MarkdownRange[] = [];
  const protectedRanges: { start: number; end: number }[] = [];

  function add(type: MarkdownRange['type'], start: number, length: number) {
    'worklet';
    if (length > 0 && ranges.length < RANGE_LIMIT) {
      ranges.push({ type, start, length });
    }
  }

  function isEscaped(index: number) {
    'worklet';
    let slashes = 0;
    while (index > 0 && input[--index] === '\\') {
      slashes++;
    }
    return slashes % 2 === 1;
  }

  function isProtected(start: number, end: number) {
    'worklet';
    return protectedRanges.some((range) => start < range.end && end > range.start);
  }

  const lines = inlineOnly ? [] : input.split('\n');
  let offset = 0;
  let fenceStart = -1;
  let fenceMarker = '';

  for (const line of lines) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceStart >= 0) {
      const closesFence =
        fence &&
        fence[1]![0] === fenceMarker[0] &&
        fence[1]!.length >= fenceMarker.length &&
        line.slice(fence[0].length).trim() === '';
      if (closesFence) {
        const end = offset + line.length;
        add('pre', fenceStart, end - fenceStart);
        add('syntax', offset, line.length);
        protectedRanges.push({ start: fenceStart, end });
        fenceStart = -1;
      }
    } else if (fence) {
      fenceStart = offset;
      fenceMarker = fence[1]!;
      add('syntax', offset, line.length);
    }
    offset += line.length + 1;
  }

  if (fenceStart >= 0) {
    add('pre', fenceStart, input.length - fenceStart);
    protectedRanges.push({ start: fenceStart, end: input.length });
  }

  const inlineCode = /(`+)([^`\n]+)\1(?!`)/g;
  let match: RegExpExecArray | null;
  while ((match = inlineCode.exec(input)) !== null && ranges.length < RANGE_LIMIT) {
    const start = match.index;
    const end = start + match[0].length;
    if (isEscaped(start) || isProtected(start, end)) {
      continue;
    }
    const delimiterLength = match[1]!.length;
    add('code', start, match[0].length);
    add('syntax', start, delimiterLength);
    add('syntax', end - delimiterLength, delimiterLength);
    protectedRanges.push({ start, end });
  }

  const headings = /^ {0,3}(#{1,6})[\t ]+([^\r\n]+)/gm;
  while (!inlineOnly && (match = headings.exec(input)) !== null && ranges.length < RANGE_LIMIT) {
    if (isProtected(match.index, match.index + match[0].length)) {
      continue;
    }
    const prefixLength = match[0].length - match[2]!.length;
    add('syntax', match.index, prefixLength);
    add('h1', match.index + prefixLength, match[2]!.length);
    add('bold', match.index + prefixLength, match[2]!.length);
  }

  const quotes = /^ {0,3}(>+[\t ]?)([^\r\n]*)/gm;
  while (!inlineOnly && (match = quotes.exec(input)) !== null && ranges.length < RANGE_LIMIT) {
    if (!isProtected(match.index, match.index + match[0].length)) {
      add('blockquote', match.index, match[0].length);
      add('syntax', match.index, match[0].length - match[2]!.length);
    }
  }

  const markers = /^ {0,3}(?:[-+*]|\d+[.)])[\t ]+(?:\[[ xX]\][\t ]+)?/gm;
  while (!inlineOnly && (match = markers.exec(input)) !== null && ranges.length < RANGE_LIMIT) {
    if (!isProtected(match.index, match.index + match[0].length)) {
      add('syntax', match.index, match[0].length);
    }
  }

  const links = /\[([^\]\r\n]+)\]\(([^\s)]+)\)/g;
  while ((match = links.exec(input)) !== null && ranges.length < RANGE_LIMIT) {
    if (isEscaped(match.index) || isProtected(match.index, match.index + match[0].length)) {
      continue;
    }
    add('syntax', match.index, 1);
    add('link', match.index + 1, match[1]!.length);
    add('syntax', match.index + 1 + match[1]!.length, match[0].length - match[1]!.length - 1);
    protectedRanges.push({ start: match.index + match[1]!.length + 2, end: links.lastIndex });
  }

  const emphasis = [
    { pattern: /(\*\*\*|___)(\S(?:[^\r\n]*?\S)?)\1/g, types: ['bold', 'italic'] as const },
    { pattern: /(\*\*|__)(\S(?:[^\r\n]*?\S)?)\1/g, types: ['bold'] as const },
    { pattern: /(~~)(\S(?:[^\r\n]*?\S)?)\1/g, types: ['strikethrough'] as const },
    { pattern: /([*_])(?!\1)(\S(?:[^\r\n]*?\S)?)\1(?!\1)/g, types: ['italic'] as const },
  ];

  for (const rule of emphasis) {
    while ((match = rule.pattern.exec(input)) !== null && ranges.length < RANGE_LIMIT) {
      const start = match.index;
      const delimiter = match[1]!;
      const end = start + match[0].length;
      const previous = input[start - 1] ?? '';
      const isInnerDelimiter = previous === delimiter[0];
      const isWordUnderscore = delimiter[0] === '_' && /[\p{L}\p{N}]/u.test(previous);
      if (isEscaped(start) || isInnerDelimiter || isWordUnderscore || isProtected(start, end)) {
        continue;
      }
      add('syntax', start, delimiter.length);
      add('syntax', end - delimiter.length, delimiter.length);
      for (const type of rule.types) {
        add(type, start + delimiter.length, match[2]!.length);
      }
    }
  }

  return ranges.sort((left, right) => left.start - right.start || right.length - left.length);
}

/** Block prefixes have already been removed from the displayed input. */
export function parseInlineMarkdown(input: string): MarkdownRange[] {
  'worklet';
  return parseLiveMarkdown(input, true);
}
