import { describe, expect, it } from 'vitest';
import { palettes, resolveTheme } from '../apps/mobile/src/theme/tokens';
import { markdownParser } from '../apps/mobile/src/utils/markdown';

describe('theme and Markdown rendering', () => {
  it('follows system theme and lets explicit preferences override it', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', null)).toBe('light');
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(Object.keys(palettes.light).sort()).toEqual(Object.keys(palettes.dark).sort());
    expect(palettes.dark.text).not.toBe(palettes.light.text);
    expect(palettes.dark.code).not.toBe(palettes.light.code);
  });
  it('parses GFM tables, task states, source formats, and refuses raw HTML/script links', () => {
    const source =
      '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n\n**bold** *italic* ~~strike~~\n\n- [ ] todo\n- [x] done\n\n1. ordered\n\n> quote\n\n`inline`\n\n```ts\nconst x = 1;\n```\n\n---\n\n[link](https://example.com)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<script>bad()</script>\n\n[bad](javascript:alert(1))';
    const tokens = markdownParser.parse(source, {});
    const types = tokens.flatMap((token) => [
      token.type,
      ...(token.children?.map((child) => child.type) ?? []),
    ]);
    for (const type of [
      'heading_open',
      'strong_open',
      'em_open',
      's_open',
      'bullet_list_open',
      'ordered_list_open',
      'blockquote_open',
      'code_inline',
      'fence',
      'hr',
      'link_open',
      'table_open',
    ]) {
      expect(types).toContain(type);
    }
    const html = markdownParser.render(source);
    expect(html).toContain('checked=""');
    expect(html).toContain('task-list-item-checkbox');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
  });
});
