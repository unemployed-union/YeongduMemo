import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: '영두메모',
  slug: 'yeongdu-memo',
  version: '0.1.0',
  scheme: 'yeongdumemo',
  platforms: ['ios', 'android'],
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: 'xyz.yeongdu.memo',
    supportsTablet: true,
    infoPlist: { NSFaceIDUsageDescription: '메모 잠금을 해제하기 위해 Face ID를 사용합니다.' },
  },
  android: {
    package: 'xyz.yeongdu.memo',
    allowBackup: false,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      monochromeImage: './assets/monochrome-icon.png',
      backgroundColor: '#D92F5B',
    },
  },
  plugins: [
    'expo-router',
    'expo-dev-client',
    [
      'expo-image-picker',
      {
        photosPermission: '메모에 첨부할 사진을 선택합니다.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    ['expo-sqlite', { useSQLCipher: true }],
    [
      'expo-local-authentication',
      { faceIDPermission: '메모 잠금을 해제하기 위해 Face ID를 사용합니다.' },
    ],
    ['expo-secure-store', { configureAndroidBackup: true }],
  ],
};
export default config;
