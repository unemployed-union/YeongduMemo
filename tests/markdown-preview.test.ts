import { describe, expect, it } from 'vitest';
import { markdownPreview } from '../apps/mobile/src/utils/markdown';

describe('markdownPreview', () => {
  it('shows readable content without Markdown syntax', () => {
    const body = '# 제목\n\n- [x] **완료** [링크](https://example.com)\n> `코드`';

    expect(markdownPreview(body)).toBe('제목 완료 링크 코드');
  });

  it('keeps code and image descriptions while removing their markup', () => {
    const body = '![설명](image.png)\n\n```js\nconst value = 1;\n```';

    expect(markdownPreview(body)).toBe('설명 const value = 1;');
  });

  it('preserves escaped literal punctuation', () => {
    expect(markdownPreview('\\*별표\\*')).toBe('*별표*');
  });
});
