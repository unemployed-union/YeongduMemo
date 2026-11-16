import { describe, expect, it } from 'vitest';
import {
  LIVE_MARKDOWN_LIMIT,
  parseLiveMarkdown,
} from '../apps/mobile/src/features/notes/live-markdown';

describe('live Markdown style ranges', () => {
  it('styles standard Markdown headings and emphasis without altering the original text', () => {
    const text = '# 제목\n\n**굵게** *기울임* ~~취소~~\n\n***함께***';
    const original = text;
    const ranges = parseLiveMarkdown(text);
    const fragments = (type: string) =>
      ranges
        .filter((range) => range.type === type)
        .map((range) => text.slice(range.start, range.start + range.length));

    expect(fragments('h1')).toContain('제목');
    expect(fragments('bold')).toContain('굵게');
    expect(fragments('italic')).toContain('기울임');
    expect(fragments('strikethrough')).toContain('취소');
    expect(fragments('bold')).toContain('함께');
    expect(fragments('italic')).toContain('함께');
    expect(text).toBe(original);
    expect(
      ranges.every((range) => range.start >= 0 && range.start + range.length <= text.length),
    ).toBe(true);
  });

  it('does not format emphasis inside inline code or fenced code, including unfinished fences', () => {
    const text = '`**raw**`\n\n```ts\n# literal\n**literal**\n```\n\n~~~\n*unfinished*';
    const ranges = parseLiveMarkdown(text);

    expect(ranges.filter((range) => range.type === 'code')).toHaveLength(1);
    expect(ranges.filter((range) => range.type === 'pre')).toHaveLength(2);
    expect(ranges.some((range) => ['bold', 'italic', 'h1'].includes(range.type))).toBe(false);
  });

  it('keeps escaped markers and underscores inside words literal', () => {
    const text = '\\**literal** and snake_case_word and 한글_단어_연결';
    const ranges = parseLiveMarkdown(text);
    expect(ranges.some((range) => range.type === 'bold' || range.type === 'italic')).toBe(false);
  });

  it('styles link labels, list markers, blockquotes and all heading prefixes', () => {
    const text =
      '## 제목2\n###### 제목6\n> 인용\n- [x] 완료\n1. 목록\n[사이트](https://example.com/path_with_underscores)';
    const ranges = parseLiveMarkdown(text);
    const fragments = (type: string) =>
      ranges
        .filter((range) => range.type === type)
        .map((range) => text.slice(range.start, range.start + range.length));

    expect(fragments('h1')).toEqual(['제목2', '제목6']);
    expect(fragments('link')).toEqual(['사이트']);
    expect(fragments('blockquote')).toEqual(['> 인용']);
    expect(fragments('syntax')).toContain('- [x] ');
    expect(fragments('syntax')).toContain('1. ');
    expect(fragments('italic')).toEqual([]);
  });

  it('bounds formatting work for very large notes while leaving the source editable', () => {
    expect(parseLiveMarkdown('x'.repeat(LIVE_MARKDOWN_LIMIT + 1))).toEqual([]);
    expect(parseLiveMarkdown('')).toEqual([]);
  });
});
