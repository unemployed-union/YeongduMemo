import { useColorScheme } from 'react-native';
import { useRuntime } from '../services/runtime';
import { palettes, spacing, radius, layout, effects, resolveTheme } from './tokens';

export { palettes, spacing, radius, layout, effects } from './tokens';
export function useTheme() {
  const preference = useRuntime((state) => state.settings.theme);
  const system = useColorScheme();
  const mode = resolveTheme(preference, system);
  return { ...palettes[mode], mode, spacing, radius, layout, effects };
}
