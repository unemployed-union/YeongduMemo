import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
import { tokenSchema, type Tokens } from '@yeongdu/shared';

const settingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  lockEnabled: z.boolean().default(false),
  lockPolicy: z.enum(['immediate', '30s', 'restart']).default('immediate'),
  serverUrl: z.string().default(''),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings = settingsSchema.parse({});
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export async function readSettings(): Promise<Settings> {
  const raw = await SecureStore.getItemAsync('settings');
  return raw ? settingsSchema.parse(JSON.parse(raw)) : defaultSettings;
}
export const writeSettings = (settings: Settings) =>
  SecureStore.setItemAsync('settings', JSON.stringify(settings), options);
export async function readTokens(): Promise<Tokens | null> {
  const raw = await SecureStore.getItemAsync('session');
  return raw ? tokenSchema.parse(JSON.parse(raw)) : null;
}
export const writeTokens = (tokens: Tokens) =>
  SecureStore.setItemAsync('session', JSON.stringify(tokens), options);
export const deleteTokens = () => SecureStore.deleteItemAsync('session');
export const readSecret = (key: string) => SecureStore.getItemAsync(key);
export const writeSecret = (key: string, value: string) =>
  SecureStore.setItemAsync(key, value, options);
