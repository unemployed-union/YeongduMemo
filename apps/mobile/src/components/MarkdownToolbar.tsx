import { ScrollView, View } from 'react-native';
import {
  Bold,
  Braces,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table2,
  Paperclip,
} from 'lucide-react-native';
import { Button } from './ui';
import { useTheme } from '../theme';

const formats = [
  { label: '제목 1', icon: Heading1, before: '# ', after: '' },
  { label: '제목 2', icon: Heading2, before: '## ', after: '' },
  { label: '제목 3', icon: Heading3, before: '### ', after: '' },
  { label: '제목 4', icon: Heading4, before: '#### ', after: '' },
  { label: '제목 5', icon: Heading5, before: '##### ', after: '' },
  { label: '제목 6', icon: Heading6, before: '###### ', after: '' },
  { label: '굵게', icon: Bold, before: '**', after: '**' },
  { label: '기울임', icon: Italic, before: '*', after: '*' },
  { label: '취소선', icon: Strikethrough, before: '~~', after: '~~' },
  { label: '체크리스트', icon: ListChecks, before: '- [ ] ', after: '' },
  { label: '목록', icon: List, before: '- ', after: '' },
  { label: '번호 목록', icon: ListOrdered, before: '1. ', after: '' },
  { label: '인용', icon: Quote, before: '> ', after: '' },
  { label: '인라인 코드', icon: Code, before: '`', after: '`' },
  { label: '코드 블록', icon: Braces, before: '\n```\n', after: '\n```\n' },
  { label: '링크', icon: Link, before: '[', after: '](https://)' },
  { label: '구분선', icon: Minus, before: '\n---\n', after: '' },
  { label: '표', icon: Table2, before: '\n| 제목 | 내용 |\n| --- | --- |\n| ', after: ' |  |\n' },
];

export function MarkdownToolbar({
  onInsert,
  onAttach,
  disabled = false,
}: {
  onInsert: (before: string, after: string) => void;
  onAttach: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ borderTopWidth: 1, borderColor: t.line, backgroundColor: t.background }}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: t.spacing.sm,
          paddingVertical: t.spacing.xs,
          gap: t.spacing.xs,
        }}
      >
        <Button
          title="사진·파일 첨부"
          icon={Paperclip}
          iconOnly
          onPress={onAttach}
          disabled={disabled}
        />
        {formats.map((format) => (
          <Button
            key={format.label}
            title={format.label}
            icon={format.icon}
            iconOnly
            disabled={disabled}
            onPress={() => onInsert(format.before, format.after)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
