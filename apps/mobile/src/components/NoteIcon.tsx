import { View } from 'react-native';
import { FileText } from 'lucide-react-native';
import { useTheme } from '../theme';

export function NoteIcon({ size, radius }: { size?: number; radius?: number }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: size ?? t.layout.noteIconWidth,
        height: size ?? t.layout.noteIconHeight,
        flexShrink: 0,
        backgroundColor: t.accentSoft,
        borderRadius: radius ?? t.radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <FileText
        size={t.layout.noteIconGlyphSize}
        color={t.accent}
        strokeWidth={1.5}
        accessible={false}
      />
    </View>
  );
}
