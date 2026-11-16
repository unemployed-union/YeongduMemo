import { useMemo, type ComponentRef, type Ref } from 'react';
import { Platform, TextInput, type TextInputProps } from 'react-native';
// The native entry avoids loading the unused ExpensiMark parser and its legacy web dependencies.
import MarkdownTextInput from '@expensify/react-native-live-markdown/src/MarkdownTextInput';
import { parseInlineMarkdown, parseLiveMarkdown } from '../features/notes/live-markdown';
import { useTheme } from '../theme';

export function MarkdownInput({
  live,
  hideSyntax = false,
  inlineOnly = false,
  inputRef,
  ...props
}: TextInputProps & {
  live: boolean;
  hideSyntax?: boolean;
  inlineOnly?: boolean;
  inputRef: Ref<ComponentRef<typeof TextInput>>;
}) {
  const t = useTheme();
  const markdownStyle = useMemo(() => {
    const fontFamily = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
    return {
      syntax: { color: t.secondary, hidden: hideSyntax },
      h1: { fontSize: 25 },
      link: { color: t.accent },
      code: { fontFamily, fontSize: 16, color: t.text, backgroundColor: t.code },
      pre: { fontFamily, fontSize: 16, color: t.text, backgroundColor: t.code },
      blockquote: { borderColor: t.accent, borderWidth: 3, marginLeft: 2, paddingLeft: 10 },
    };
  }, [t.secondary, t.accent, t.text, t.code, hideSyntax]);

  if (!live) {
    return <TextInput {...props} ref={inputRef} />;
  }

  return (
    <MarkdownTextInput
      {...props}
      ref={inputRef}
      parser={inlineOnly ? parseInlineMarkdown : parseLiveMarkdown}
      markdownStyle={markdownStyle}
    />
  );
}
