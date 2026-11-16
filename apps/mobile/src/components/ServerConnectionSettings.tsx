import { Text, View } from 'react-native';
import { Field, SettingsSection } from './ui';
import { AnimatedSwitch } from './AnimatedSwitch';
import { SettingsButton } from './SettingsButton';
import { RecoveryKeyBackup } from './RecoveryKeyBackup';
import { useServerConnection } from '../features/settings/useServerConnection';
import { synchronize, useRuntime } from '../services/runtime';
import { useTheme } from '../theme';
export function ServerConnectionSettings({
  busy,
  perform,
}: {
  busy: boolean;
  perform: (task: () => Promise<void>) => Promise<void>;
}) {
  const state = useRuntime();
  const t = useTheme();
  const {
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
  } = useServerConnection();
  return (
    <SettingsSection title="나의 동기화 서버">
      <Text style={{ color: t.chromeTint, fontWeight: '700', fontSize: 15 }}>
        종단 간 암호화로 안전하게
      </Text>
      <Text style={{ color: t.secondary, fontSize: 13, lineHeight: 22 }}>
        서버 없이도 모든 메모를 사용할 수 있어요. 연결하면 메모를 기기에서 종단 간 암호화하여
        동기화합니다. 서버에는 제목·본문을 읽을 수 없는 암호문만 저장됩니다.
      </Text>
      <View style={{ gap: t.spacing.sm }}>
        <Field
          placeholder="https://memo.example.com"
          accessibilityLabel="서버 URL"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Field
          placeholder="이메일"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <Field
          placeholder="비밀번호"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
        />
        <Field
          placeholder="암호화 복구 키 (64자리)"
          accessibilityLabel="종단 간 암호화 복구 키"
          value={recoveryKey}
          onChangeText={(value) => {
            setRecoveryKey(value);
            setKeyConfirmation('');
            setKeyBackedUp(false);
            setShowRecoveryKey(false);
          }}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <SettingsButton
          title="최초 연결용 복구 키 만들기"
          disabled={busy}
          onPress={() => {
            void perform(generateKey);
          }}
        />
        {showRecoveryKey && !!recoveryKey && (
          <Text
            selectable
            style={{
              color: t.text,
              lineHeight: 22,
              padding: t.spacing.sm,
              backgroundColor: t.inset,
              borderRadius: t.radius.sm,
            }}
          >
            {recoveryKey}
          </Text>
        )}
        <Text style={{ color: t.secondary, fontSize: 12, lineHeight: 21 }}>
          처음 연결할 때만 새 키를 만드세요. 다른 기기에서는 같은 키를 입력하세요. 키를 별도로
          보관한 후 연결하세요. 로그인 비밀번호만으로는 메모를 복구할 수 없습니다.
        </Text>
        <Field
          placeholder="보관한 복구 키 다시 입력"
          accessibilityLabel="보관한 복구 키 확인"
          value={keyConfirmation}
          onChangeText={(value) => {
            setKeyConfirmation(value);
            setKeyBackedUp(false);
          }}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
          <Text style={{ color: t.text, flex: 1, lineHeight: 22 }}>
            키를 별도로 보관하고 값을 확인했습니다
          </Text>
          <AnimatedSwitch
            accessibilityLabel="복구 키 보관 확인"
            value={keyBackedUp}
            onValueChange={setKeyBackedUp}
            busy={busy}
          />
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
        <SettingsButton
          title={busy ? '처리 중…' : '로그인 및 연결'}
          filled
          disabled={
            busy || !email || !password || !url || !recoveryKey || !keyConfirmation || !keyBackedUp
          }
          onPress={() => {
            void perform(login);
          }}
        />
        <SettingsButton
          title="로그아웃"
          disabled={busy}
          onPress={() => {
            void perform(logout);
          }}
        />
        <SettingsButton
          title="지금 동기화"
          disabled={busy || !state.settings.serverUrl}
          onPress={() => {
            void perform(synchronize);
          }}
        />
      </View>
      <Text accessibilityLiveRegion="polite" style={{ color: t.secondary, fontSize: 12 }}>
        {state.syncStatus}
      </Text>
      <RecoveryKeyBackup />
    </SettingsSection>
  );
}
