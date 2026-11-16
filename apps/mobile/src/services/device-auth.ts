import * as LocalAuthentication from 'expo-local-authentication';

let authenticating = false;
export const isAuthenticating = () => authenticating;
export async function authenticateDevice(message: string) {
  if (authenticating) return false;
  authenticating = true;
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) {
      throw new Error(
        '기기 설정에서 생체 인증 또는 화면 잠금을 등록하세요. 잠금은 자동 해제되지 않습니다.',
      );
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: message,
      cancelLabel: '취소',
      fallbackLabel: '기기 암호 사용',
      disableDeviceFallback: false,
      biometricsSecurityLevel: 'strong',
    });
    return result.success;
  } finally {
    authenticating = false;
  }
}
