import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

// Rendering only: editor storage never runs through this parser.
export const markdownParser = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
}).use(taskLists);

/** Extract readable text for list previews without changing the stored Markdown. */
export function markdownPreview(input: string): string {
  const tokens = markdownParser.parse(input, {});
  const parts: string[] = [];

  for (const token of tokens) {
    if (token.type === 'inline' && token.children) {
      for (const child of token.children) {
        if (child.type === 'text' || child.type === 'code_inline' || child.type === 'image') {
          parts.push(child.content);
        } else if (child.type === 'softbreak' || child.type === 'hardbreak') {
          parts.push(' ');
        }
      }
    } else if (token.type === 'fence' || token.type === 'code_block') {
      parts.push(token.content);
    } else if (token.block && token.nesting === -1) {
      parts.push(' ');
    }
  }

  return parts.join('').replace(/\s+/g, ' ').trim();
}
