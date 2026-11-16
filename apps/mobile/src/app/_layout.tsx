import 'react-native-gesture-handler';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Text, View } from 'react-native';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ScreenCapture from 'expo-screen-capture';
import NetInfo from '@react-native-community/netinfo';
import { Button, Message, Page } from '../components/ui';
import {
  flushEditors,
  gate,
  notifyCategoryAccess,
  relockCategories,
  synchronize,
  useRuntime,
} from '../services/runtime';
import { readSettings } from '../storage/secure';
import { openVault } from '../storage/database';
import { cleanupAttachmentCache } from '../storage/attachment-cache';
import { useTheme } from '../theme';
import { authenticateDevice, isAuthenticating } from '../services/device-auth';
import { Fingerprint, ShieldCheck } from 'lucide-react-native';

let boot: Promise<void> | undefined;
async function initialize() {
  cleanupAttachmentCache();
  const settings = await readSettings();
  gate.enabled = settings.lockEnabled;
  gate.policy = settings.lockPolicy;
  if (!settings.lockEnabled) gate.unlock();
  useRuntime.setState({ settings, ready: true, unlocked: gate.isUnlocked() });
}

function VaultRoot() {
  const state = useRuntime();
  const t = useTheme();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const authenticating = useRef(false);
  const opening = useRef(false);
  const lifecycle = useRef<Promise<void>>(Promise.resolve());
  ScreenCapture.usePreventScreenCapture();

  useEffect(() => {
    boot ??= initialize();
    void boot.catch((reason) => setError(String(reason)));
    if (Platform.OS === 'ios') {
      void ScreenCapture.enableAppSwitcherProtectionAsync().catch(() => {
        setError('최근 앱 보호를 활성화하지 못했습니다. 네이티브 빌드를 확인하세요.');
      });
    }
    const appSub = AppState.addEventListener('change', (next) => {
      const active = next === 'active';
      if (isAuthenticating() || authenticating.current) {
        if (next === 'background') {
          relockCategories();
        }
        useRuntime.setState({ active });
        return;
      }
      // Keep the cover until the foreground timeout is evaluated; no unlocked frame may flash.
      useRuntime.setState({ active: false });
      const time = Date.now();
      lifecycle.current = lifecycle.current
        .catch(() => undefined)
        .then(async () => {
          if (!active) {
            try {
              await flushEditors();
            } catch {
              useRuntime.setState({ syncStatus: '저장 실패 · 잠금 해제 후 다시 저장하세요.' });
            }
            relockCategories();
            gate.background(time);
          } else {
            gate.foreground(time);
          }
          useRuntime.setState({
            unlocked: gate.isUnlocked(),
            active: active && AppState.currentState === 'active',
          });
          if (active && gate.isUnlocked()) void synchronize();
        });
    });
    const unsubscribe = NetInfo.addEventListener((net) => {
      if (net.isConnected) void synchronize();
    });
    const interval = setInterval(() => {
      void synchronize();
    }, 30_000);
    return () => {
      appSub.remove();
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!state.ready || !state.unlocked || state.store || opening.current) return;
    opening.current = true;
    void openVault(
      gate.assertAccess,
      async (message) => {
        const success = await authenticateDevice(message);
        return success && AppState.currentState === 'active' && gate.isUnlocked();
      },
      () => notifyCategoryAccess(false),
    )
      .then(async (store) => {
        useRuntime.setState({ store });
        const syncIssue = await store.syncIssue();
        useRuntime.setState({ syncIssue });
        void synchronize();
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => {
        opening.current = false;
      });
  }, [state.ready, state.unlocked, state.store]);

  async function unlock() {
    if (authenticating.current) return;
    authenticating.current = true;
    setBusy(true);
    setError('');
    try {
      // OS passcode fallback is explicit. No app PIN or server password bypasses the gate.
      const success = await authenticateDevice('영두메모 잠금 해제');
      if (!success) {
        setError('인증을 완료하지 못했습니다. 다시 시도하세요.');
        return;
      }
      gate.unlock();
      useRuntime.setState({ unlocked: true, active: AppState.currentState === 'active' });
      await flushEditors();
      void synchronize();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      authenticating.current = false;
      setBusy(false);
    }
  }

  const visible = state.unlocked && state.active && !!state.store;
  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <StatusBar style={t.mode === 'dark' ? 'light' : 'dark'} />
      {state.store && (
        <View
          style={{ flex: 1, display: visible ? 'flex' : 'none' }}
          accessibilityElementsHidden={!visible}
          importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
        >
          <Slot />
        </View>
      )}
      {!visible && (
        <Page>
          <Message
            icon={ShieldCheck}
            title={state.ready && !state.unlocked ? '나만의 생각, 안전하게' : '영두메모'}
            detail={
              error ||
              (state.ready && !state.unlocked
                ? '인증 후 메모를 열 수 있습니다.'
                : '암호화된 메모 공간을 준비하고 있어요.')
            }
            loading={!error && (!state.ready || (state.unlocked && !state.store))}
          />
          {state.ready && !state.unlocked && (
            <View style={{ padding: 32 }}>
              <Button
                title={busy ? '인증 중…' : '잠금 해제'}
                icon={Fingerprint}
                onPress={() => {
                  void unlock();
                }}
                filled
                disabled={busy}
              />
              <Text style={{ textAlign: 'center', color: t.secondary, marginTop: 16 }}>
                생체 인증 · 기기 암호로 보호
              </Text>
            </View>
          )}
        </Page>
      )}
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <VaultRoot />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
