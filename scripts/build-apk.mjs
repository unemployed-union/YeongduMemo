import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mobileDirectory = join(rootDirectory, 'apps', 'mobile');
const arguments_ = new Set(process.argv.slice(2));
const supportedArguments = new Set(['--debug', '--arm64', '--help']);

for (const argument of arguments_) {
  if (!supportedArguments.has(argument)) {
    console.error(`지원하지 않는 옵션입니다: ${argument}`);
    process.exit(1);
  }
}

if (arguments_.has('--help')) {
  console.log('사용법: pnpm apk [--arm64] 또는 pnpm apk:debug [--arm64]');
  console.log('APK 출력 위치: dist/apk/');
  process.exit(0);
}

const variant = arguments_.has('--debug') ? 'debug' : 'release';
const arm64Only = arguments_.has('--arm64');
const env = {
  ...process.env,
  NODE_ENV: variant === 'release' ? 'production' : 'development',
};

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`빌드 명령이 실패했습니다 (종료 코드: ${result.status ?? result.signal}).`);
  }
}

try {
  const mobileRequire = createRequire(join(mobileDirectory, 'package.json'));
  const expoDirectory = dirname(mobileRequire.resolve('expo/package.json'));
  run(
    process.execPath,
    [join(expoDirectory, 'bin', 'cli'), 'prebuild', '--platform', 'android', '--no-install'],
    mobileDirectory,
  );

  const androidDirectory = join(mobileDirectory, 'android');
  const task = variant === 'release' ? ':app:assembleRelease' : ':app:assembleDebug';
  const gradleArgs = [task, '--console=plain'];

  if (arm64Only) {
    gradleArgs.push('-PreactNativeArchitectures=arm64-v8a');
  }

  if (process.platform === 'win32') {
    // cmd is needed for the batch wrapper. Every argument comes from the fixed list above.
    run(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', `gradlew.bat ${gradleArgs.join(' ')}`],
      androidDirectory,
    );
  } else {
    run('./gradlew', gradleArgs, androidDirectory);
  }

  const apkPath = join(
    androidDirectory,
    'app',
    'build',
    'outputs',
    'apk',
    variant,
    `app-${variant}.apk`,
  );
  const mobilePackage = JSON.parse(readFileSync(join(mobileDirectory, 'package.json'), 'utf8'));
  const outputDirectory = join(rootDirectory, 'dist', 'apk');
  const architectureSuffix = arm64Only ? '-arm64' : '';
  const outputPath = join(
    outputDirectory,
    `YeongduMemo-${mobilePackage.version}-${variant}${architectureSuffix}.apk`,
  );

  mkdirSync(outputDirectory, { recursive: true });
  copyFileSync(apkPath, outputPath);
  console.log(`\nAPK 내보내기 완료: ${outputPath}`);

  if (variant === 'debug') {
    console.log('개발용 APK입니다. 실행 시 pnpm mobile로 Metro 서버를 켜세요.');
  } else {
    console.log(
      'Metro 없이 실행할 수 있는 APK입니다. 로컬 서명 설정은 android/app/build.gradle을 따릅니다.',
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
