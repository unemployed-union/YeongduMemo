import { describe, expect, it } from 'vitest';
import {
  backspaceBlockStart,
  blockText,
  editBlockText,
  insertBlockFormat,
  parseMarkdownBlocks,
  supportsBlockEditing,
  toggleTask,
  BLOCK_COUNT_LIMIT,
} from '../apps/mobile/src/features/notes/markdown-blocks';
import {
  reconcileBlockDocument,
  rowAtOffset,
} from '../apps/mobile/src/features/notes/block-document';
import { parseInlineMarkdown } from '../apps/mobile/src/features/notes/live-markdown';

describe('Markdown block projection without source serialization', () => {
  it('shows a bullet immediately after typing star and space while retaining the exact Markdown', () => {
    const literal = parseMarkdownBlocks('*')[0]!;
    expect(literal.kind).toBe('paragraph');
    const entered = editBlockText('*', literal, '* ');
    const bullet = parseMarkdownBlocks(entered.source)[0]!;
    expect(entered.source).toBe('* ');
    expect(bullet.kind).toBe('bullet');
    expect(blockText(entered.source, bullet)).toBe('');
    const text = editBlockText(entered.source, bullet, '첫 번째 항목');
    expect(text.source).toBe('* 첫 번째 항목');
    expect(blockText(text.source, parseMarkdownBlocks(text.source)[0]!)).toBe('첫 번째 항목');
  });

  it('projects heading levels, nested lists, ordered punctuation, tasks and quotes', () => {
    const source =
      '# 제목\r\n###### 작은 제목\n  + 중첩\n12) 번호\n- [X] 완료\n> > 인용\n\\* 일반 텍스트\n';
    const blocks = parseMarkdownBlocks(source);
    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'heading',
      'bullet',
      'ordered',
      'task',
      'quote',
      'paragraph',
      'paragraph',
    ]);
    expect(blocks[0]!.level).toBe(1);
    expect(blocks[1]!.level).toBe(6);
    expect(blocks[2]!.depth).toBe(1);
    expect(blocks[3]!.number).toBe(12);
    expect(blocks[4]!.checked).toBe(true);
    expect(blocks[5]!.depth).toBe(1);
    expect(blockText(source, blocks[6]!)).toBe('\\* 일반 텍스트');
    expect(blocks.map((block) => source.slice(block.start, block.end)).join('')).toBe(source);
  });

  it('changes only the edited text, preserving mixed line endings, spaces, escapes and other blocks', () => {
    const source = '제목  \r\n\r\n+   **원문**  \n>  인용\r끝\\*\n';
    const before = source;
    const block = parseMarkdownBlocks(source)[2]!;
    const edit = editBlockText(source, block, '**수정**  ');
    expect(edit.source).toBe('제목  \r\n\r\n+   **수정**  \n>  인용\r끝\\*\n');
    expect(source).toBe(before);
    const parsed = parseMarkdownBlocks(source);
    expect(parsed.map((item) => source.slice(item.start, item.end)).join('')).toBe(source);
  });

  it('keeps complete and unfinished code fences literal, including Markdown-looking lines', () => {
    const source = '```ts\r\n* literal\r\n# heading\r\n```\r\n\n~~~\n- unfinished';
    const blocks = parseMarkdownBlocks(source);
    expect(blocks.map((block) => block.kind)).toEqual(['code', 'paragraph', 'code']);
    expect(blocks[0]!.language).toBe('ts');
    expect(blockText(source, blocks[0]!)).toBe('* literal\r\n# heading\r\n');
    expect(blockText(source, blocks[2]!)).toBe('- unfinished');
    const edit = editBlockText(source, blocks[0]!, '* literal\r\n# unchanged\r\n');
    expect(edit.source).toBe(source.replace('# heading', '# unchanged'));
    expect(parseMarkdownBlocks('```')[0]!.fenced).toBe(false);
  });

  it('does not turn a longer or differently marked fence into a closing fence', () => {
    const source = '````\n```\n~~~\n````\n';
    const blocks = parseMarkdownBlocks(source);
    expect(blockText(source, blocks[0]!)).toBe('```\n~~~\n');
    expect(blocks[0]!.end).toBe(source.length);
  });

  it('bounds native input count and note size for long-document source editing', () => {
    expect(supportsBlockEditing('x'.repeat(100_001))).toBe(false);
    expect(supportsBlockEditing('x\n'.repeat(BLOCK_COUNT_LIMIT))).toBe(false);
    expect(supportsBlockEditing('* 한글\n'.repeat(20))).toBe(true);
  });
});

describe('block editing commands', () => {
  it.each([
    ['* 하나', '* 하나\n* '],
    ['- 하나', '- 하나\n- '],
    ['+   하나', '+   하나\n+   '],
    ['9) 하나', '9) 하나\n10) '],
    ['- [x] 완료', '- [x] 완료\n- [ ] '],
    ['> 인용', '> 인용\n> '],
    ['## 제목', '## 제목\n'],
  ])('continues the appropriate block after Return: %s', (source, expected) => {
    const block = parseMarkdownBlocks(source)[0]!;
    const edit = editBlockText(source, block, blockText(source, block) + '\n');
    expect(edit.source).toBe(expected);
    expect(edit.selection.start).toBe(expected.length);
  });

  it('splits a list in the middle and puts the caret before the remaining text', () => {
    const source = '* 앞뒤';
    const edit = editBlockText(source, parseMarkdownBlocks(source)[0]!, '앞\n뒤');
    expect(edit.source).toBe('* 앞\n* 뒤');
    expect(edit.selection.start).toBe('* 앞\n* '.length);
  });

  it('uses the existing CRLF for a new line and leaves the following source intact', () => {
    const source = '* 첫째\r\n다른 문단\n';
    const edit = editBlockText(source, parseMarkdownBlocks(source)[0]!, '첫째\n');
    expect(edit.source).toBe('* 첫째\r\n* \r\n다른 문단\n');
  });

  it.each(['* ', '- [ ] ', '1. ', '> ', '  ## '])(
    'exits an empty block with Return: %s',
    (source) => {
      const edit = editBlockText(source, parseMarkdownBlocks(source)[0]!, '\n');
      expect(edit.source).toBe('');
      expect(edit.selection.start).toBe(0);
    },
  );

  it('outdents one nested list level before leaving the list', () => {
    let source = '  * ';
    source = editBlockText(source, parseMarkdownBlocks(source)[0]!, '\n').source;
    expect(source).toBe('* ');
    expect(editBlockText(source, parseMarkdownBlocks(source)[0]!, '\n').source).toBe('');
  });

  it('pastes multi-line Markdown without adding or normalizing list markers', () => {
    const source = '* 기존\r\n마지막';
    const edit = editBlockText(
      source,
      parseMarkdownBlocks(source)[0]!,
      '새 내용\n\n## 제목\n- 붙여넣기',
    );
    expect(edit.source).toBe('* 새 내용\n\n## 제목\n- 붙여넣기\r\n마지막');
  });

  it('backspaces through checkbox, list and paragraph boundaries without losing content', () => {
    let source = '이전\n* [ ] 내용';
    let blocks = parseMarkdownBlocks(source);
    source = backspaceBlockStart(source, blocks, 1)!.source;
    expect(source).toBe('이전\n* 내용');
    blocks = parseMarkdownBlocks(source);
    source = backspaceBlockStart(source, blocks, 1)!.source;
    expect(source).toBe('이전\n내용');
    blocks = parseMarkdownBlocks(source);
    const edit = backspaceBlockStart(source, blocks, 1)!;
    expect(edit.source).toBe('이전내용');
    expect(edit.selection.start).toBe(2);
  });

  it('toggles just the checkbox character without changing whitespace, markers or other content', () => {
    const source = '+   [X]\t완료  \r\n본문';
    const changed = toggleTask(source, parseMarkdownBlocks(source)[0]!);
    expect(changed.source).toBe('+   [ ]\t완료  \r\n본문');
  });

  it('does not auto-continue syntax inside code', () => {
    const source = '```\n* 코드\n```';
    const edit = editBlockText(source, parseMarkdownBlocks(source)[0]!, '* 코드\n\n');
    expect(edit.source).toBe('```\n* 코드\n\n```');
  });

  it('replaces a selected block style from the toolbar instead of inserting a prefix inside text', () => {
    const source = '* 한글 문장\r\n뒤';
    const edit = insertBlockFormat(source, { start: 5, end: 5 }, '## ', '');
    expect(edit.source).toBe('## 한글 문장\r\n뒤');
    const bold = insertBlockFormat('한글', { start: 0, end: 2 }, '**', '**');
    expect(bold.source).toBe('**한글**');
    expect(bold.selection.start).toBe(4);
  });
});

describe('native input identity and inline-only rendering', () => {
  it('bounds a delayed native selection event when a prefix has just been hidden', () => {
    const edit = insertBlockFormat('* ', { start: 4, end: 4 }, '**', '**');
    expect(edit.source).toBe('* ****');
    expect(edit.selection.start).toBe(4);
  });
  it('keeps the same input across Korean composition and a block prefix transformation', () => {
    let document = reconcileBlockDocument('');
    const id = document.rows[0]!.id;
    for (const source of ['*', '* ', '* ㅎ', '* 하', '* 한', '* 한ㄱ', '* 한글']) {
      document = reconcileBlockDocument(source, document);
      expect(document.rows[0]!.id).toBe(id);
    }
    expect(document.source).toBe('* 한글');
  });

  it('preserves following native inputs across a line split, join and repeated blocks', () => {
    const original = reconcileBlockDocument('* 첫째\n둘째\n둘째');
    const split = reconcileBlockDocument('* 첫째\n* \n둘째\n둘째', original);
    expect(split.rows[0]!.id).toBe(original.rows[0]!.id);
    expect(split.rows.slice(2).map((row) => row.id)).toEqual(
      original.rows.slice(1).map((row) => row.id),
    );
    expect(new Set(split.rows.map((row) => row.id)).size).toBe(split.rows.length);
    const joined = reconcileBlockDocument('* 첫째\n둘째\n둘째', split);
    expect(joined.rows.map((row) => row.id)).toEqual(original.rows.map((row) => row.id));
    expect(rowAtOffset(split, '* 첫째\n* '.length).id).toBe(split.rows[1]!.id);
  });

  it('never interprets literal heading/list/quote text inside a block as another block prefix', () => {
    for (const source of ['# 내용', '* 내용', '> 내용', '```\n* 내용']) {
      expect(
        parseInlineMarkdown(source).some(
          (range) => range.type === 'h1' || range.type === 'blockquote' || range.type === 'pre',
        ),
      ).toBe(false);
    }
    const source = '**굵게** *기울임* `**코드**`';
    const ranges = parseInlineMarkdown(source);
    expect(ranges.filter((range) => range.type === 'bold')).toHaveLength(1);
    expect(ranges.some((range) => range.type === 'italic')).toBe(true);
    expect(ranges.some((range) => range.type === 'code')).toBe(true);
  });
});
