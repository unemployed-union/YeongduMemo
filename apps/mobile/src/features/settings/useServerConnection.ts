import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { connectServer, disconnectServer } from '../../services/server-connection';
import { generateRecoveryKey } from '../../services/encryption';
import { synchronize, useRuntime } from '../../services/runtime';
/** Owns credentials only for this form; background clears match the settings screen policy. */
export function useServerConnection() {
  const state = useRuntime();
  const [url, setUrl] = useState(state.settings.serverUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [showRecoveryKey, setShowRecoveryKey] = useState(false);
  const [keyConfirmation, setKeyConfirmation] = useState('');
  const [keyBackedUp, setKeyBackedUp] = useState(false);
  const keyGeneration = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!state.active || !state.unlocked) {
      keyGeneration.current?.abort();
      setRecoveryKey('');
      setKeyConfirmation('');
      setKeyBackedUp(false);
      setShowRecoveryKey(false);
      setPassword('');
    }
    return () => {
      keyGeneration.current?.abort();
    };
  }, [state.active, state.unlocked]);
  async function login() {
    await connectServer(url, email, password, recoveryKey, {
      confirmation: keyConfirmation,
      backedUp: keyBackedUp,
    });
    setPassword('');
    setRecoveryKey('');
    setKeyConfirmation('');
    setKeyBackedUp(false);
    setShowRecoveryKey(false);
    await synchronize();
    Alert.alert('서버 연결 완료', '이 기기의 메모가 이 계정에 동기화됩니다.');
  }
  async function logout() {
    if (!(await disconnectServer(state.settings.serverUrl))) {
      Alert.alert('로그인된 계정이 없습니다.');
      return;
    }
  }
  async function generateKey() {
    keyGeneration.current?.abort();
    const request = new AbortController();
    keyGeneration.current = request;
    const store = useRuntime.getState().store;
    const accessVersion = store?.categoryAccessVersion();
    try {
      const key = await generateRecoveryKey(request.signal);
      const current = useRuntime.getState();
      const stillVisible =
        store !== null &&
        current.active &&
        current.unlocked &&
        current.store === store &&
        store.categoryAccessVersion() === accessVersion;
      if (request.signal.aborted || !stillVisible) {
        return;
      }
      setRecoveryKey(key);
      setKeyConfirmation('');
      setKeyBackedUp(false);
      setShowRecoveryKey(true);
      Alert.alert(
        '복구 키를 안전하게 보관하세요',
        '다른 기기에서 연결하거나 앱을 재설치할 때 필요합니다. 모든 기기와 키를 잃으면 서버에서도 메모를 복구할 수 없습니다.',
      );
    } catch (error) {
      if (!request.signal.aborted) {
        throw error;
      }
    } finally {
      if (keyGeneration.current === request) {
        keyGeneration.current = null;
      }
    }
  }
  return {
    url,
    setUrl,
    email,
    setEmail,
    password,
    setPassword,
    recoveryKey,
    setRecoveryKey,
    showRecoveryKey,
    setShowRecoveryKey,
    keyConfirmation,
    setKeyConfirmation,
    keyBackedUp,
    setKeyBackedUp,
    login,
    logout,
    generateKey,
  };
}
