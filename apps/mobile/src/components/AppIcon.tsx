import { Image } from 'react-native';
import { useTheme } from '../theme';
import brandIcon from '../../assets/brand-icon.png';

export function AppIcon({ size = 44, radius }: { size?: number; radius?: number }) {
  const t = useTheme();
  return (
    <Image
      source={brandIcon}
      accessible={false}
      resizeMode="contain"
      style={{ width: size, height: size, borderRadius: radius ?? t.radius.sm }}
    />
  );
}
