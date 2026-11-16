import { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { revealRecoveryKey } from '../services/encryption';
import { gate, useRuntime } from '../services/runtime';
import { useTheme } from '../theme';
import { SettingsButton } from './SettingsButton';

export function RecoveryKeyBackup() {
  const t = useTheme();
  const state = useRuntime();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setKey('');
  }, [state.active, state.unlocked, state.categoryVersion]);
  async function reveal() {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const store = useRuntime.getState().store!;
      const version = store.categoryAccessVersion();
      const assertCurrent = () => {
        gate.assertAccess();
        if (
          !mounted.current ||
          !useRuntime.getState().active ||
          store.categoryAccessVersion() !== version
        ) {
          throw new Error('확인이 만료되었습니다. 앱으로 돌아와 다시 인증해 주세요.');
        }
      };
      assertCurrent();
      const identity = await store.accountIdentity();
      if (!identity) {
        throw new Error('서버에 연결한 후 이 기기에 저장된 복구 키를 확인할 수 있습니다.');
      }
      const value = await revealRecoveryKey(identity, assertCurrent);
      assertCurrent();
      if (value) {
        setKey(value);
      }
    } catch (error) {
      Alert.alert(
        '복구 키 확인',
        error instanceof Error ? error.message : '키를 확인하지 못했습니다.',
      );
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  }
  return (
    <View style={{ gap: t.spacing.sm }}>
      <SettingsButton
        title="저장된 복구 키 확인·보관"
        disabled={busy}
        onPress={() => {
          void reveal();
        }}
      />
      <Text style={{ color: t.secondary, lineHeight: 21, fontSize: 13 }}>
        비밀번호 관리자나 안전한 오프라인 장소에 키를 별도로 보관하세요. 키와 모든 기기를 잃으면
        로그인 비밀번호나 서버 백업으로도 암호문을 복구할 수 없습니다. 현재 키 교체는 지원하지
        않습니다.
      </Text>
      {state.active && state.unlocked && !!key && (
        <>
          <Text
            selectable
            style={{
              color: t.text,
              backgroundColor: t.inset,
              padding: t.spacing.sm,
              lineHeight: 23,
              borderRadius: t.radius.sm,
            }}
          >
            {key}
          </Text>
          <Text style={{ color: t.secondary, lineHeight: 21 }}>
            주변 화면과 화면 녹화에 주의하세요. 보관한 값이 64자리인지 확인하세요. 앱을 나가면
            화면에서 지웁니다.
          </Text>
          <SettingsButton title="키 화면 닫기" onPress={() => setKey('')} />
        </>
      )}
    </View>
  );
}
