# 영두메모 · YeongduMemo

Expo 기반 iOS·Android Markdown 메모 앱과 개인 NAS에 올릴 수 있는 Fastify 서버입니다. 서버를 연결하지 않아도 암호화된 로컬 DB에서 메모를 읽고 작성합니다. 서버는 선택 사항이며 외부 인증·유료 서비스가 필요하지 않습니다.

## 구현된 기능

- 사진·파일 첨부: 편집기 클립 메뉴에서 사진 원본/2560px/1280px 또는 파일을 선택합니다. 이미지는 본문 안에 표시하며 파일은 열기·공유 카드로 표시합니다. E2EE 조각 업로드와 오프라인 저장·재시도를 지원하고 서버 디스크 또는 S3 호환 비공개 버킷을 선택할 수 있습니다. 파일당 20MiB, 메모당 64개, 계정 기본 1GiB입니다. 새 네이티브 빌드가 필요합니다. [사용법·저장소 설정·백업](docs/attachments.md).
- 메모 작성·수정, 400ms debounce 자동 저장, 화면을 닫을 때와 백그라운드 전환 시 저장. 저장 실패 시 화면을 유지하고 재시도할 수 있습니다.
- 제목·본문 검색, 최근 수정 순 정렬, 상단 고정·즐겨찾기·보관, 휴지통·복원·삭제 확인·영구 삭제. 빈 메모는 편집을 마칠 때 휴지통으로 정리합니다.
- 메모마다 카테고리 하나를 지정할 수 있습니다. 편집 화면의 `카테고리 · 미분류` 버튼에서 새 이름(최대 40자)을 추가하거나 기존 카테고리를 선택하고, `미분류`를 선택해 해제합니다. 목록의 `전체·미분류·카테고리` 필터를 검색·즐겨찾기·보관함·휴지통과 함께 사용할 수 있으며, 카테고리를 선택한 상태에서 새 메모를 만들면 해당 분류로 생성합니다. 사용 중인 이름은 메모에서 모아 표시하고 휴지통 메모의 분류도 영구 삭제 전까지 유지합니다. 카테고리 이름도 메모와 함께 종단 간 암호화·동기화·JSON 내보내기에 포함됩니다.
- `설정 → 카테고리 보호` 또는 목록의 `카테고리 관리`에서 생체 인증·기기 암호로 인증한 뒤 카테고리별 잠금과 숨김을 설정합니다. 잠긴 메모는 인증 전 제목·본문·검색 결과·개수에 노출하지 않으며 숨긴 카테고리 이름도 기본 필터에서 제외합니다. 숨긴 메모는 관리 화면의 `카테고리 열기`로 인증한 해당 분류에서만 표시하고 전체 목록·검색에는 포함하지 않습니다. `다시 잠그기` 또는 앱을 벗어나면 접근 권한을 지웁니다. 보호 설정은 암호화하여 다른 기기에 동기화하지만 잠금 해제 권한은 기기별·세션별이며 동기화하지 않습니다. 보호된 메모를 포함해 내보낼 때도 별도 인증을 요구합니다.
- Markdown 블록 편집: `* `·`- `는 글머리 목록, `1. `는 번호 목록, `# `–`###### `는 제목, `> `는 인용, `- [ ] `는 누를 수 있는 체크리스트로 바로 표시합니다. Enter로 목록을 이어 쓰고 빈 항목에서 Enter로 끝냅니다. 굵게·기울임·취소선·코드·링크도 입력 중 서식으로 표시하며 기호는 화면에서 숨깁니다. 모드 전환 없이 실시간으로 편집하며 아이콘 서식 도구를 제공합니다. 저장·동기화·내보내기는 Markdown 원문을 유지합니다. 외부 이미지는 자동 다운로드하지 않습니다.
- 설정·뒤로 가기·더보기·고정·즐겨찾기 등에 Lucide 벡터 아이콘을 적용했습니다. 하단 메뉴와 새 메모 바에는 영두뮤직과 같은 Ionicons를 사용합니다. 아이콘 버튼에도 접근성 이름과 44pt 이상의 터치 영역을 제공합니다.
- 시스템·라이트·다크 테마, Safe Area, 키보드 회피, 접근성 레이블, 햅틱.
- 영두뮤직 v2를 참고한 로즈 핑크 강조색과 큰 제목, 둥근 메모 카드·설정 그룹. 휴대전화는 메모/즐겨찾기/보관함/휴지통 하단 메뉴를 사용하고 넓은 화면은 사이드바로 전환합니다. 색상·간격·모서리·화면 너비는 중앙 테마 토큰에서 관리합니다.
- 설정 그룹은 영두뮤직의 15pt 모서리와 간격을 적용하고 각 항목의 장식 아이콘을 제거했습니다. 잠금 토글도 같은 크기·색상·애니메이션을 사용하며 인증에 성공한 뒤 상태를 변경합니다. 메인 화면의 방패·저장 상태는 정렬 순서 바로 왼쪽에 오른쪽 정렬로 표시합니다.
- 메인 목록의 위·아래에는 스크롤에 따라 나타나는 투명 그라데이션을 적용했습니다. 하단 메뉴는 영두뮤직 Android와 같은 전체 폭의 반투명 로즈 배경·블러·얇은 상단선과 기본 탭 리플 효과를 사용합니다. 새 메모 바는 영두뮤직 미니 플레이어 형태의 블러 배경·두 줄 문구·원형 추가 버튼을 사용하며 전체를 눌러 작성합니다. 썸네일은 메모 카드와 같은 문서 아이콘과 배경입니다. 바의 아래 간격은 최대 너비로 인해 늘어나는 실제 좌우 여백에 연동하며, Android에서는 하단 네비게이션의 그림자 공간을 추가로 확보합니다. 추가 표시의 오른쪽·아래 여백은 기본 높이에서 8pt입니다. 목록은 두 바 뒤까지 이어지고 마지막 메모가 가려지지 않도록 여백을 확보합니다. 검색 키보드가 열리면 두 바를 숨깁니다. 방패 아이콘과 저장/동기화 상태는 검색창 아래 메모 개수 옆에 표시합니다. `expo-blur`와 `expo-linear-gradient`가 없는 기존 앱은 네이티브 빌드를 업데이트해야 합니다.
- 로즈 핑크와 접힌 메모지를 모티프로 한 전용 앱 아이콘. iOS 기본 아이콘, Android 적응형/테마 아이콘과 앱 내 브랜드 이미지에 적용했습니다. [아이콘 파일과 생성 기록](apps/mobile/assets/README.md).
- 한국어 기본 UI. 주요 공통 문자열은 타입이 있는 한/영 사전으로 분리했습니다. 전체 영어 번역과 언어 선택 UI는 후속 작업입니다.
- 생체 인증과 OS 기기 암호 폴백, 즉시·30초 후·앱 재실행 잠금. 초기 인증 전에 메모 화면과 DB를 열지 않습니다. 잠기면 repository도 접근을 거부합니다.
- SecureStore의 DB 키·토큰, SQLCipher 런타임 확인, Android 화면 캡처 차단과 iOS 앱 전환 화면 보호. SQLCipher가 없는 빌드는 평문으로 폴백하지 않고 시작을 차단합니다.
- 자체 이메일·Argon2id 인증, 15분 access / 30일 refresh 세션, refresh rotation·재사용 시 세션 폐기, 로그인 요청 제한, 사용자 소유 데이터 분리.
- 서버 revision·증분 cursor·로컬 outbox·멱등 operation UUID 동기화. 오프라인 수정 충돌은 별도 사본으로 보존합니다. 삭제·복원·영구 삭제 tombstone을 전파합니다.
- 서버 동기화 시 AES-256-GCM 종단 간 암호화. 제목·Markdown 본문·카테고리와 보호 설정·즐겨찾기·고정·보관·시각 정보를 기기에서 암호화하며, 별도 256비트 복구 키를 같은 계정의 기기에서 공유합니다. 서버는 복구 키를 받지 않습니다. 카테고리와 보호 기능을 사용하려면 동기화하는 모든 기기의 앱을 업데이트해야 합니다. 이전 앱은 잠금·숨김을 강제할 수 없고 메모를 수정할 때 분류·보호 설정을 지울 수 있습니다.
- 서버 DB 식별자·복원 세대·사용자별 checkpoint로 관찰한 서버 이력의 롤백·교체·분기를 전송 전에 검사합니다. 이상 시 기기별 동기화를 지속 중단하고 메모·오프라인 수정·충돌 사본을 유지하며 설정에서 수동 복구를 안내합니다. 구버전 동기화는 426으로 차단합니다.
- 로그인/서버 연결, 수동 동기화와 재연결 재시도, JSON 내보내기와 검증 후 새 사본으로 가져오기(Markdown 원문 포함). 보호된 메모는 별도 기기 인증을 요구하며 휴지통·카테고리 보호를 보존합니다. 복구 키는 보관한 값 재입력과 확인 뒤 연결하고, 저장된 키도 기기 인증 후 확인할 수 있습니다.
- 비root Docker 구성, 영구 볼륨, health check, 온라인 SQLite 백업 CLI, GHCR amd64·arm64 워크플로.

## 구조

```text
apps/mobile/src/
  app/                  Expo Router 화면
  components/           버튼·필드·Markdown·메뉴
  features/notes/        목록·편집 상태와 자동 저장 연결
  services/             API, 인증, 접근 게이트, 동기화 실행
  storage/              SecureStore, SQLCipher 어댑터
  theme/                중앙 테마 토큰
apps/server/src/
  config/               환경변수 검증
  database/             SQLite 마이그레이션·Drizzle 스키마
  repositories/         사용자별 메모 및 revision·충돌 처리
  services/             인증·세션
  app.ts                Fastify 라우트·입출력 검증
  cli.ts                계정 생성·백업
packages/shared/src/    Zod 계약, 로컬 DB, 자동 저장, 잠금·동기화 엔진
packages/config/        공통 strict TypeScript
tests/                  실제 SQLite 및 Fastify inject 테스트
```

읽기·쓰기는 항상 로컬 DB를 사용합니다. 저장과 outbox 변경을 같은 트랜잭션으로 처리하고, 동기화가 확인된 작업만 큐에서 제거합니다. 서버는 클라이언트의 시각과 관계없이 SQLite 증가 번호로 순서를 정합니다. 동일 작업 재전송은 저장된 receipt를 반환하고, 같은 UUID의 다른 요청은 거부합니다.

편집 화면에서는 동기화를 잠시 보류하여 열어 둔 원문이 원격 변경으로 교체되지 않도록 합니다. 화면을 닫으면 동기화를 재개합니다. 서버 응답 중 추가된 로컬 수정은 다음 revision으로 전송하고, 충돌이 나면 후속 입력도 충돌 사본으로 이동합니다.

### Markdown 블록 편집

편집 화면은 별도 모드 선택 없이 Markdown 원문의 위치를 추적하여 문단별 네이티브 입력란과 글머리표·번호·체크박스·제목·인용·코드 블록으로 보여줍니다. 예를 들어 `*` 다음 **공백**을 입력하면 별표가 화면에서 글머리표로 바뀌고 바로 항목을 작성할 수 있습니다. 단독 `*`는 일반 문자로 유지합니다.

| 입력               | 편집 화면                                        |
| ------------------ | ------------------------------------------------ |
| `* `, `- `, `+ `   | 글머리 목록                                      |
| `1. `, `1) `       | 번호 목록                                        |
| `- [ ] `, `* [x] ` | 체크리스트. 체크박스를 누르면 상태를 변경합니다. |
| `# `부터 `###### ` | 제목 1–6                                         |
| `> `               | 왼쪽 선이 있는 인용                              |
| 백틱 3개와 줄바꿈  | 코드 블록. 내부 문법은 일반 코드로 유지합니다.   |

목록에서 Enter를 누르면 같은 종류의 다음 항목을 만들며, 번호는 증가하고 새 할 일은 미완료로 시작합니다. 빈 중첩 항목에서 Enter는 한 단계 들여쓰기를 줄이고, 빈 최상위 항목에서는 일반 문단으로 돌아갑니다. 항목 맨 앞의 Backspace는 체크박스/블록 서식을 차례로 해제하며, 일반 문단 맨 앞에서는 이전 줄과 합칩니다. 아이콘 도구의 제목·목록·인용 버튼은 현재 문단의 서식을 바꿉니다.

인라인 서식은 [React Native Live Markdown](https://github.com/Expensify/react-native-live-markdown)으로 적용합니다. `**굵게**`, `*기울임*`, `~~취소선~~`, 코드·링크의 원문 기호는 보이지 않게 처리하되 실제 텍스트에서 삭제하지 않습니다. 블록 편집도 수정한 원문 범위만 바꾸므로 손대지 않은 줄바꿈·공백·기호는 재직렬화하지 않습니다. 붙여넣은 여러 줄은 입력한 원문대로 처리하며 HTML을 Markdown으로 변환해 저장하지 않습니다.

편집/원문/미리보기 전환 버튼은 제공하지 않습니다. 10만 자 또는 500개 블록을 넘는 메모는 응답성을 위해 자동으로 하나의 원문 입력란을 사용하고 안내합니다. 표 격자 렌더링·직접 편집, 블록 드래그/순서 변경, 여러 블록에 걸친 선택은 블록 편집기에 포함하지 않습니다. 지원하지 않는 문법은 원문을 유지하며, 전체 Markdown 원문은 JSON 내보내기에 포함됩니다.

아이콘은 [Lucide React Native](https://lucide.dev/guide/react-native)를 사용합니다. `react-native-svg`와 네이티브 편집기가 추가되었으므로 기존 Development Build를 다시 빌드하거나 새 APK를 설치해야 합니다.

`patches/@expensify__react-native-live-markdown@0.1.371.patch`는 React Native 0.88의 TextInput ref·공개 CodegenTypes 경로 및 `globalThis` 호환을 보완하고 `syntax.hidden` 옵션을 추가합니다. Android에서는 원문을 변경하지 않는 폭 0 ReplacementSpan, iOS에서는 투명한 최소 크기 폰트로 기호를 숨깁니다. 네이티브 패치가 바뀌었으므로 **Development Build 또는 APK를 다시 빌드해야 합니다.** 앱은 기본 ExpensiMark 파서를 사용하지 않으므로 native source entry를 직접 사용하고 선택적 `expensify-common` peer는 설치하지 않습니다. 버전을 올릴 때 패치와 이 진입점의 API를 함께 확인하세요.

## 개발 환경과 설치

- Node.js **24 LTS** (`>=24.3 <25`), pnpm **12.4.2**.
- Android: JDK 17 이상, Android Studio, Android SDK/NDK. `ANDROID_HOME`, `JAVA_HOME` 설정.
- iOS: macOS와 SDK 58을 지원하는 Xcode, CocoaPods. Windows에서 iOS 네이티브 빌드는 불가능합니다.
- Docker 배포/컨테이너 검증: Docker Engine 또는 Docker Desktop + Compose v2.

```sh
corepack enable
corepack prepare pnpm@12.4.2 --activate
pnpm install
```

Corepack이 없는 Node 설치라면 `npm install -g pnpm@12.4.2`로 설치합니다. 잠금 파일을 커밋하고 CI에서는 `pnpm install --frozen-lockfile`을 사용합니다.

Expo SDK 58.0.23, React Native 0.88.1, React 19.3.0을 사용하고 네이티브 모듈 버전은 `expo install` 권장값으로 맞췄습니다. [SDK 58 안내](https://expo.dev/changelog/sdk-58), [Expo SQLite/SQLCipher 문서](https://docs.expo.dev/versions/latest/sdk/sqlite/)를 참고하세요.

## 모바일 앱 실행

**Expo Go는 지원하지 않습니다.** SQLCipher·Face ID를 사용하는 Development Build가 필요합니다.

```sh
pnpm android                  # Android 네이티브 개발 빌드 및 실행
pnpm ios                      # macOS: iOS 개발 빌드 및 실행
pnpm mobile                   # 이미 설치한 Development Build용 Metro
```

다른 기기 또는 CI의 EAS Build를 사용하려면 Expo 계정으로 로그인하고 `apps/mobile`에서 실행합니다. EAS는 선택 사항이며 Android 로컬 빌드는 Expo 계정이 필요하지 않습니다.

```sh
pnpm dlx eas-cli build --profile development --platform android
pnpm dlx eas-cli build --profile development --platform ios
```

`app.config.ts`에서 앱 식별자/이름을 바꿀 수 있습니다. 네이티브 플러그인이나 SQLCipher 설정을 바꿨다면 `pnpm --filter @yeongdu/mobile exec expo prebuild` 후 다시 빌드합니다. `android/`, `ios/`는 생성물이며 Git 관리 대상이 아닙니다.

### APK 내보내기

Android SDK·JDK와 설치된 의존성이 있는 환경에서 루트에서 실행합니다. Expo 계정이나 EAS 없이 로컬 빌드합니다.

```sh
pnpm apk                  # Metro 없이 실행하는 release APK (전체 지원 아키텍처)
pnpm apk --arm64          # 실제 arm64 기기용으로 빌드 시간/크기 줄이기
pnpm apk:debug --arm64    # Metro가 필요한 Development APK
```

각 명령은 Android prebuild, Gradle 빌드, APK 복사를 순서대로 수행합니다. 성공한 APK는 루트 `dist/apk/`에 저장합니다:

- `YeongduMemo-0.1.0-release.apk`
- `YeongduMemo-0.1.0-release-arm64.apk`
- `YeongduMemo-0.1.0-debug-arm64.apk`

`apps/mobile` 안에서도 `pnpm apk`와 `pnpm apk:debug`를 사용할 수 있습니다. release APK는 [Expo의 APK 빌드 방식](https://docs.expo.dev/build-reference/apk/)에 따라 `:app:assembleRelease`로 생성합니다. 현재 생성된 네이티브 프로젝트는 release에도 개발용 keystore를 사용하므로 개인 설치·테스트용이며, 정식 배포에는 별도 서명 설정이 필요합니다.

## 서버 로컬 실행과 최초 계정

루트 `.env.example`을 `.env`로 복사하고 필요한 값을 수정합니다. 실행/CLI는 루트 `.env`를 읽습니다.

```sh
pnpm server
```

서버는 기본 `http://localhost:3000`, DB는 `apps/server/data/memo.db`에 생성됩니다. 공개 회원가입은 제공하지 않습니다. 계정 비밀번호는 12자 이상으로, **명령 인수가 아닌 표준 입력**으로 전달합니다.

PowerShell에서 비밀번호가 명령 기록에 남지 않도록:

```powershell
$memoCredential = Get-Credential -UserName 'you@example.com' -Message '새 계정 비밀번호 (12자 이상)'
$memoCredential.GetNetworkCredential().Password | pnpm --filter @yeongdu/server user:create $memoCredential.UserName
```

macOS/Linux:

```sh
read -r -s -p '새 비밀번호: ' MEMO_PASSWORD; printf '\n'
printf '%s' "$MEMO_PASSWORD" | pnpm --filter @yeongdu/server user:create you@example.com
unset MEMO_PASSWORD
```

이미 등록된 이메일은 중복 생성할 수 없습니다. 비밀번호 복구·변경 UI는 아직 제공하지 않으므로 관리자 계정과 백업을 보관하세요.

모바일 설정에서 서버 URL·이메일·비밀번호를 입력합니다. 계정 최초 연결에서는 **최초 연결용 복구 키 만들기**를 누르고 표시된 64자리 키를 비밀번호 관리자 등 별도 안전한 위치에 보관합니다. **보관한 키를 다시 입력**하고 보관 확인 후 **로그인 및 연결**을 누릅니다. 다른 기기나 재설치 후에는 새 키를 만들지 말고 원래 키를 입력합니다. 아직 동기화하지 않은 로컬 메모는 기기에서 암호화한 뒤 업로드됩니다. 이미 동기화한 구버전 로컬 DB는 과거 checkpoint가 없어 자동 연결하지 않으며 [원본 보존 수동 복구](docs/operations-recovery.md)를 따릅니다. 하나의 로컬 DB는 최초 서버·계정에 묶이며 계정 전환을 차단합니다. 로그아웃 후 동일 계정·키로 재연결할 수 있지만 기존 복구 중단 표식은 해제하지 않습니다.

복구 키는 로그인 비밀번호와 무관한 256비트 난수입니다. 키의 SHA-256 식별자만 서버에 등록하며 다른 키로 덮어쓸 수 없습니다. 비밀번호를 알아도 메모를 복호화할 수 없습니다. 복구 키와 모든 기기의 SecureStore 키를 함께 잃으면 서버 관리자도 메모를 복구할 수 없습니다. 키 변경·회전 UI는 제공하지 않습니다.

### 기존 평문 서버 DB 전환

기존 서버 DB는 자동으로 삭제하거나 암호화하지 않습니다. 새 서버는 기존 평문 계정의 동기화를 차단하고, 구버전 앱의 `/sync/push`, `/sync/pull`에는 426을 반환합니다. 앱과 서버를 함께 업그레이드하세요.

1. 기존 앱에서 편집을 마치고 동기화한 다음, 별도 JSON 내보내기와 서버 DB 백업을 보관합니다. 앱에서 새 복구 키를 생성하고 보관합니다.
2. 서버를 중지합니다. 가능하면 SQLite 온라인 백업으로 얻은 DB를 신뢰하는 로컬 PC로 가져와 전환하고 완료된 DB를 서버로 옮기세요. **전환 CLI는 평문을 암호화하기 위해 입력한 복구 키를 일시적으로 메모리에서 사용합니다.** 운영 HTTP 서버에는 키를 보내지 않습니다.
3. `.env`의 `DATABASE_PATH`를 전환할 DB로 지정하고 아래 명령을 실행합니다. 복구 키를 명령 인수나 환경변수에 넣지 마세요.

```powershell
$memoRecovery = Get-Credential -UserName 'you@example.com' -Message '앱에서 보관한 64자리 복구 키를 비밀번호 칸에 입력'
$memoRecovery.GetNetworkCredential().Password | pnpm --filter @yeongdu/server e2ee:migrate $memoRecovery.UserName
Remove-Variable memoRecovery
```

CLI는 변경 전에 `DATABASE_PATH.pre-e2ee-시각-UUID.db` 백업을 생성합니다. 현재 메모와 과거 변경 내용을 암호화하면서 메모 ID·revision·cursor를 유지합니다. 평문 요청에 대한 기존 receipt는 전환 트랜잭션에서 제거합니다. 변환 도중 실패하면 전체 변경을 롤백합니다. 성공 후 `secure_delete`, WAL checkpoint와 `VACUUM`으로 현재 DB의 이전 페이지를 정리합니다. 이 명령은 키 교체용이 아니며 이미 전환된 계정에서는 거부됩니다.

4. 여러 계정이 있는 DB는 각 계정을 따로 전환합니다. 서버를 다시 실행하고 **같은 복구 키**를 사용합니다. 이미 동기화한 구버전 기기는 checkpoint가 없어 중단되므로 [수동 복구 절차](docs/operations-recovery.md)에 따라 원본 기기를 유지하고 별도 공간에서 검증·사본 가져오기를 수행합니다. 전환 당시 미확인 작업과 충돌 사본도 원본에서 보존합니다.
5. 별도 백업에서 복구가 가능한지 확인하세요. **전환 전 백업·JSON 내보내기·NAS 스냅샷은 평문을 포함합니다.** 암호화된 보관소에서 관리하고 보존 정책에 따라 직접 정리해야 합니다. SSD·파일시스템 스냅샷의 물리적 안전 소거를 보장하지 않습니다.

HTTPS가 기본입니다. HTTP는 `__DEV__` 개발 빌드에서만 허용됩니다. 실제 휴대전화에서 PC의 `localhost`에 접근할 수 없으므로 LAN 주소를 사용하세요. iOS ATS가 LAN HTTP를 거부하면 로컬 HTTPS 프록시를 사용하세요. 프로덕션 ATS/Android cleartext 정책을 전역 완화하지 않습니다.

## REST API

| 경로                                    | 동작                                         |
| --------------------------------------- | -------------------------------------------- |
| `GET /health`                           | DB 마이그레이션 완료 후 상태 확인            |
| `POST /auth/login`                      | 이메일·비밀번호로 세션 생성                  |
| `POST /auth/refresh`                    | refresh 토큰 회전                            |
| `POST /auth/logout`                     | 현재 세션 폐기 (Bearer)                      |
| `GET /e2ee/key`                         | 사용자 암호화 키 식별자 또는 null (Bearer)   |
| `PUT /e2ee/key`                         | 최초 키 식별자 등록, 변경 금지 (Bearer)      |
| `GET /notes`                            | 사용자 암호문 목록 (Bearer)                  |
| `POST /sync/v4/checkpoint`              | 기기 이력·서버 계보 검증 (Bearer)            |
| `POST /sync/v4/push`                    | checkpoint 검증 후 암호문 전송 (Bearer)      |
| `POST /sync/v4/pull`                    | cursor·checkpoint 검증 후 증분 수신 (Bearer) |
| `POST /attachments/v1/stage`            | 암호문 manifest 예약 (Bearer, witness)       |
| `PUT /attachments/v1/:id/chunks/:index` | 암호문 조각 전송 (Bearer, witness)           |
| `POST /attachments/v1/:id/commit`       | 조각 검증·완료 (Bearer, witness)             |
| `GET /attachments/v1/:id`               | 사용자 소유 완료 manifest (Bearer)           |
| `GET /attachments/v1/:id/chunks/:index` | 사용자 소유 암호문 조각 (Bearer)             |

로컬 계약은 `packages/shared/src/index.ts`, 암호문 계약은 `packages/shared/src/e2ee.ts`, 이력 검증 계약은 `packages/shared/src/sync-safety.ts`입니다. v4는 첨부 없는 이전 암호문 형식을 유지하며 평문 필드나 알 수 없는 필드를 거부합니다. v1/v2/v3 동기화 경로는 426을 반환합니다. push는 최대 50개, pull은 페이지당 100개이며 모바일은 긴 메모도 전송할 수 있도록 작업별로 요청합니다. 요청 본문 제한은 12 MiB입니다. 각 작업은 `operationId`, `clientId`, `baseRevision`과 암호문 envelope를 포함합니다. 암호문은 12바이트 무작위 nonce + UTF-8 JSON의 AES-256-GCM 암호문 + 16바이트 인증 태그를 base64로 인코딩합니다. 설치된 Expo Crypto SDK 58의 네이티브 AES API를 사용하며 추가 암호화 의존성은 없습니다.

AAD는 앱 식별자·프로토콜 버전·사용자 ID·키 식별자·원본 메모 ID·영구 삭제 여부·클라이언트가 미리 생성한 충돌 사본 ID를 결합합니다. 서버는 이 충돌 ID만 사용해 암호문을 복사하고, 클라이언트가 복호화 후 충돌 제목과 상태를 적용합니다. 다른 메모나 계정의 암호문 교체와 임의 ID 재지정을 거부합니다. 암호화한 작업은 SQLCipher DB의 `encrypted_outbox`에 저장하여 응답 유실·앱 재시작 뒤에도 동일 UUID·암호문으로 재전송합니다. 복호화 실패 시 원문이나 cursor를 갱신하지 않습니다.

## Docker Compose 배포

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f server
```

컨테이너는 UID/GID **1000:1000**의 `node` 사용자로 실행합니다. `/data/memo.db`와 WAL/SHM 파일은 `memo-data` named volume에 저장됩니다. 새 named volume은 이미지의 소유권을 이어받습니다. bind mount로 바꾼다면 디렉터리를 해당 UID/GID가 쓸 수 있게 준비하세요. SQLite는 DB 파일뿐 아니라 상위 디렉터리 쓰기 권한도 필요합니다.

최초 계정 생성(PowerShell):

```powershell
$memoCredential = Get-Credential -UserName 'you@example.com' -Message '서버 계정 생성'
$memoCredential.GetNetworkCredential().Password | docker compose exec -T server node dist/cli.js user:create $memoCredential.UserName
```

macOS/Linux에서는 위 표준 입력 예제의 마지막 명령을 `docker compose exec -T server node dist/cli.js user:create you@example.com`으로 바꿉니다. 이미지나 환경변수에 관리자 비밀번호를 넣지 않습니다.

호스트에는 기본 **127.0.0.1:3000**만 바인딩합니다. 같은 호스트의 HTTPS reverse proxy 또는 Cloudflare Tunnel을 이 주소에 연결하세요. 프록시도 Compose 컨테이너라면 `ports`를 삭제하고 동일 Docker 네트워크에서 `http://server:3000`을 사용하면 호스트 포트를 공개할 필요가 없습니다. TLS는 프록시에서 종료합니다. `TRUST_PROXY`에는 신뢰하는 프록시 IP/CIDR만 지정하고 인터넷 전체를 신뢰하지 마세요.

### 환경변수

| 변수                     | 기본값               | 설명                                       |
| ------------------------ | -------------------- | ------------------------------------------ |
| `HOST`                   | `0.0.0.0`            | 서버 리스닝 주소                           |
| `PORT`                   | `3000`               | 서버 포트                                  |
| `DATABASE_PATH`          | `./data/memo.db`     | 로컬 SQLite 경로, Docker는 `/data/memo.db` |
| `TRUST_PROXY`            | 빈 값                | 쉼표로 구분하는 신뢰할 프록시 주소         |
| `MEMO_PORT`              | `3000`               | Compose의 loopback 바인딩 포트             |
| `MEMO_IMAGE`             | `yeongdu-memo:local` | 사용할 컨테이너 이미지                     |
| `ATTACHMENT_STORAGE`     | `filesystem`         | `filesystem` 또는 `s3`                     |
| `ATTACHMENT_PATH`        | DB 옆 `attachments`  | Docker는 `/data/attachments`               |
| `ATTACHMENT_QUOTA_BYTES` | `1073741824`         | 사용자별 예약 포함 한도                    |

S3 bucket·region·endpoint·prefix·자격 증명 공급 방법은 [.env.example](.env.example)과 [첨부 저장소 운영](docs/attachments.md)을 참고하세요. 디스크/S3 자동 이전은 지원하지 않습니다.

스키마는 서버 시작과 백업·백업 검증 이외 CLI 실행 시 트랜잭션으로 마이그레이션합니다. v1/v2/v3 파일은 v4 변경 전에 `.before-v4-UUID.db` 온라인 백업을 먼저 생성하며 실패하면 중단합니다. `backup`·`backup:verify` CLI는 읽기 전용이며 마이그레이션하지 않습니다. DB 버전이 앱보다 새로우면 시작을 중단합니다. 다운그레이드하지 말고 호환 버전으로 복구하세요. SQLite 파일을 여러 컨테이너에서 동시에 운영하거나 네트워크 파일시스템에 두지 마세요.

### 백업과 복원

실행 중에는 SQLite online backup API를 사용합니다. DB 파일만 복사하면 WAL에 남은 변경이 누락될 수 있습니다.

```sh
docker compose exec -T server node dist/cli.js backup /data/backup-2026-11-07.db
docker compose exec -T server node dist/cli.js backup:verify /data/backup-2026-11-07.db
docker compose cp server:/data/backup-2026-11-07.db ./memo-backup.db
docker compose cp server:/data/backup-2026-11-07.db.attachments ./memo-backup.db.attachments
```

로컬 서버는 `pnpm --filter @yeongdu/server backup /absolute/path/backup.db`를 사용합니다. **대상은 매번 새 파일이어야 하며 기존 백업은 덮어쓰지 않습니다.** 백업에는 메모·비밀번호 해시·세션이 포함되므로 암호화된 보관소에 저장하세요. 보존 기간과 원격 복사 스케줄은 운영자가 설정합니다.

복원은 서버를 중지한 상태에서 수행합니다:

1. `docker compose stop server` 후 기존 DB·WAL·SHM을 별도 폴더로 보관합니다. named volume 위치를 직접 수정하기보다 정비용 컨테이너나 `docker compose cp`를 사용하세요.
2. `backup:verify`로 DB와 `.attachments/complete.json`·조각 해시를 검증합니다. 기존 blob 저장소도 보존한 채 [첨부 복원 절차](docs/attachments.md)로 DB와 연결된 파일을 함께 복원합니다. **기존 DB의 `memo.db-wal`, `memo.db-shm`은 새 DB와 섞이지 않게 이동**합니다. 파일 소유권은 1000:1000으로 맞춥니다.
3. 서버를 중지한 상태에서 복원 경로를 확인하고 `sync:renew-generation` CLI를 실행합니다. 갱신 전 백업을 생성한 뒤 세대만 변경합니다. `docker compose run --rm --no-deps server node dist/cli.js sync:renew-generation`은 선택한 볼륨을 실제 변경하므로 먼저 복사본에서 연습하세요.
4. `docker compose up -d server`, health·로그·로그인·암호문 복호화를 확인합니다. 복원된 세션을 신뢰할 수 없다면 외부 접속 전 세션을 폐기하고 재로그인합니다. 구체적인 보존·세션 정비·검증 순서는 [운영·복구 절차](docs/operations-recovery.md)를 따르세요.

복원 후 기존 기기가 동기화를 중단하는 것은 데이터 보존을 위한 정상 동작입니다. 원본 기기·DB·outbox를 유지한 채 별도 기기/앱 데이터 공간에서 서버를 확인하고 JSON을 새 사본으로 가져와 비교하세요. 앱 삭제·cursor 초기화로 우회하지 마세요. 기기가 관찰하지 않은 변경의 소실은 검출할 수 없으므로 **의도적 백업 복원에는 세대 갱신이 필수**입니다. 정상 재시작·완전한 DB 이동에는 갱신하지 않습니다.

JSON 가져오기는 설정의 데이터 보관에서 지원합니다. 최대 50MiB·10,000개를 먼저 검증하며 파일 내 중복 ID는 거부합니다. 기존 메모를 덮어쓰지 않고 모든 메모에 새 ID를 부여하며, 같은 카테고리는 `(복원)`으로 구분하고 보호·휴지통·원문을 보존합니다. 영구 삭제 표식은 건너뛰고 결과 개수를 안내합니다. 같은 파일을 다시 가져오면 사본이 추가됩니다. 평문 파일의 관리와 보호 메모의 인증 요구 등 [전체 계약](docs/operations-recovery.md)을 확인하세요.

사진·첨부파일은 [첨부 기능과 저장소 운영](docs/attachments.md)을 따릅니다. 수정 이력은 아직 구현하지 않았으며 [도입 조사](docs/storage-roadmap.md)에 필요한 설계를 정리했습니다. 안전한 키 교체에 필요한 epoch·오프라인 기기·이전 백업 정책도 [복구 키 설계 제한](docs/operations-recovery.md)에 기록했습니다.

### GHCR

`.github/workflows/container.yml`은 버전 태그(`v0.1.0`) push 또는 수동 실행에서 `linux/amd64`, `linux/arm64`를 빌드하고 `ghcr.io/<owner>/<repo>:latest`, `:0.1.0` 태그로 게시합니다. GitHub Actions의 packages 쓰기 권한을 준비한 뒤 실행하세요. 이 작업에서 실제 레지스트리 게시는 수행하지 않았습니다.

게시한 이미지를 쓸 때 `.env`에 `MEMO_IMAGE`를 지정하고 `docker compose pull && docker compose up -d --no-build`로 시작합니다. 사설 GHCR 패키지라면 먼저 Docker 로그인해야 합니다.

## 보안과 데이터 복구 정책

- 앱 잠금과 DB 암호화는 별개입니다. SQLCipher는 `PRAGMA cipher_version`을 확인한 뒤 raw key를 적용하며, 키로 실제 DB 페이지를 읽을 수 있는지도 확인합니다. 읽기·쓰기 연결 모두에 키를 적용하고, 전용 쓰기 연결에서 트랜잭션을 직렬 실행합니다. 키가 없는 새 연결을 여는 Expo 기본 exclusive transaction helper는 사용하지 않습니다.
- DB 키는 256비트 난수이며 SecureStore의 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`로 저장합니다. 생체 등록 변경으로 유일한 키가 소실되지 않도록 키 자체에는 `requireAuthentication`을 걸지 않고, 인증 뒤 접근 게이트에서 통제합니다. 기기 잠금과 OS 보안 저장소를 신뢰하는 모델입니다.
- 생체 인증이 없어도 **OS 화면 잠금이 등록되어 있으면 기기 암호로 폴백**합니다. 어느 것도 없으면 앱 잠금을 켤 수 없습니다. 잠금 활성화 후 등록이 없어져도 자동 우회하지 않고 기기 보안 재등록을 안내합니다. 잠금 해제 취소·실패는 잠긴 상태를 유지합니다.
- 키를 읽을 수 없거나 DB가 손상되면 기존 파일을 자동 삭제하지 않습니다. 원래 기기의 보안 설정을 복구하고 다시 시도하거나, 보관한 내보내기/서버에서 내용을 복구하세요. 앱 삭제·기기 이전으로 SecureStore 키가 소실될 수 있습니다. OS 백업만으로 로컬 암호화 DB 복원을 보장하지 않습니다.
- 백그라운드에서는 화면을 가리고, Android는 screen-capture 방지, iOS는 app-switcher 보호 API를 사용합니다. OS 버전별 실제 보호 동작은 실기기에서 확인해야 합니다. 이미 손상된 기기나 메모리 분석 공격까지 보호한다고 주장하지 않습니다.
- 서버에는 메모의 암호문과 키 식별자만 저장하고, 원본 복구 키는 기기별 SecureStore에만 지속 저장합니다. 서버에는 사용자·세션, 메모 ID·충돌 관계, 영구 삭제 여부, revision·cursor·기기/작업 ID, 암호문 길이와 접속 시각 등 메타데이터가 보입니다. HTTPS와 서버 접근 통제도 계속 필요합니다. 내보내기 JSON은 평문이며, 전환 전 백업은 별도 보호해야 합니다.
- AEAD는 내용과 연결 정보를 검증합니다. 별도 checkpoint 검사는 기기가 관찰한 이력보다 이전인 DB·다른 분기를 검출해 동기화를 중단하지만, 서버의 가용성·응답 누락·관찰하지 않은 변경 소실이나 악의적 서버의 모든 롤백을 방지하지는 않습니다. 신뢰할 수 없는 앱 빌드나 손상된 기기에서 키가 유출되는 것도 보호하지 못합니다.
- 영구 삭제 시 현재 메모를 빈 내용의 암호화된 tombstone으로 바꾸고 서버 증분 이력·receipt의 해당 암호문도 교체합니다. tombstone은 오래 오프라인인 기기에 삭제를 전달하기 위해 유지합니다. 기존 백업·다른 기기의 미동기화 데이터·충돌 사본·SQLite 여유 페이지까지 안전 소거하지는 않습니다.
- DB 원문을 저장하는 debounce 대기 400ms 이내에 프로세스가 강제 종료되면 마지막 입력을 잃을 수 있습니다. 정상 화면 종료/백그라운드는 flush합니다. OS가 JS 실행을 즉시 중지하는 경우 저장 완료를 보장할 수 없습니다.

## 검증

```sh
pnpm verify
pnpm format:check
pnpm build
pnpm --filter @yeongdu/mobile exec expo install --check
pnpm --filter @yeongdu/mobile exec expo export --platform all --output-dir dist --no-bytecode
node scripts/smoke-production.mjs
```

프로덕션 의존성만 포함한 독립 배포 폴더도 검증할 수 있습니다:

```sh
pnpm --filter @yeongdu/server deploy --prod .artifacts/production
node scripts/smoke-production.mjs .artifacts/production
```

반복 실행할 때에는 새 출력 폴더를 선택합니다. smoke는 임시 DB·무작위 비밀번호로 CLI 계정 생성, HTTP 로그인/전송, 온라인 백업, 서버 재시작 후 세션·메모 보존과 별도 복사본 복원·세대 갱신 후 기존 checkpoint 차단을 검증하고 임시 파일을 정리합니다. 사용자 DB·NAS를 사용하지 않습니다.

자동화 테스트는 실제 SQLite로 CRUD·검색·원문 보존·DB 재오픈, debounce/flush/재시도, 잠금 정책·repository 접근 거부, HTTPS 정책, 로그인 실패·토큰 만료·회전·재사용·로그아웃·요청 제한·사용자 분리, 증분 페이지, 오프라인/응답 유실 재시도, 두 기기 수정 충돌·전송 중 추가 입력·삭제/복원/tombstone을 검증합니다.

### 실기기 확인 체크리스트

Android와 iOS Development Build에서 다음을 확인합니다. 유닛 테스트나 JS 번들 성공을 실기기 검증으로 대신하지 않습니다.

1. 비행기 모드에서 작성·검색·편집·앱 재실행, 온라인 복구 후 두 기기 동기화.
2. 편집/미리보기에서 표·체크리스트·코드, 선택 영역 서식 삽입, 한글 조합 입력, 긴 메모와 키보드 도구 모음.
3. 시스템 테마 변경과 수동 테마, 상태 표시줄·코드 블록·모달 색상.
4. Face ID/Touch ID/Android 생체 인증 성공·취소·반복 실패·기기 암호 폴백. 등록된 생체 정보 변경 후에도 OS 암호로 접근 가능한지 확인.
5. 즉시/30초/재실행 잠금, 뒤로 가기·딥 링크에서 잠금 우회 불가, 최근 앱 미리보기/화면 캡처 보호.
6. 개발 중 SQLCipher를 끈 별도 빌드가 기존 DB를 평문으로 열지 않고 오류로 차단되는지 확인. 운영 데이터로 실험하지 않습니다.
7. 두 기기를 오프라인에서 각각 수정한 뒤 두 버전 보존, 휴지통·복원·영구 삭제 전파.
   같은 복구 키로 새 기기 복원, 틀린 키 거부, SecureStore 키 소실 시 자동 재생성 없이 차단,
   네이티브 AES-GCM 암호화·복호화, 잠금 중 접근 차단도 확인합니다.
8. Docker 볼륨에 메모를 넣고 컨테이너 재시작·재생성 후 보존, amd64/arm64 실제 환경에서 백업·복원.

## 알려진 제한과 오류 해결

- `SQLCipher 미지원 빌드`: Expo Go나 오래된 네이티브 앱입니다. SQLCipher 플러그인이 켜진 Development Build를 재설치하세요. DB를 삭제하지 마세요.
- `암호화 키를 찾을 수 없습니다`: 기존 DB를 남긴 채 키가 소실된 상태입니다. 자동 재생성하지 않습니다. 원래 기기의 키/백업·서버 복구 경로를 사용하세요.
- `다른 서버/계정에 연결`: 잘못된 계정으로 로컬 메모를 전송하는 것을 방지하는 정책입니다. 같은 계정으로 재연결하세요. 데이터 내보내기 후 별도 앱 데이터 공간을 쓰는 계정 전환 UI는 후속 작업입니다.
- Android CMake 4는 Expo SQLite 58.0.15의 `cmake_minimum_required(3.4.1)`을 거부합니다. `patches/expo-sqlite@58.0.15.patch`로 최소 정책 버전을 3.5로 올립니다. 패키지 업그레이드 시 패치 필요성을 다시 확인하세요.
- `.pnpmfile.cjs`는 서버 전용 Drizzle의 선택적 Expo 드라이버 peer를 제거하여 컨테이너에 모바일 툴체인이 포함되지 않게 합니다. 모바일에 Drizzle을 도입한다면 이 규칙부터 수정하세요.
- Windows의 기본 PATH에 Node가 없으면 `fnm` 등 설치 관리자를 활성화하거나 Node 24 설치 폴더를 PATH에 추가하세요. `node --version`부터 확인합니다.
- Docker `SQLITE_CANTOPEN`/readonly: `/data` 디렉터리 소유권과 볼륨 마운트·남은 디스크 공간을 확인하세요.
- iOS 빌드·실기기 생체 인증, Docker Engine이 없는 환경의 컨테이너 실행, 실제 GHCR 게시는 이 저장소 생성만으로 완료되지 않습니다. [검증 기록](docs/verification.md)에 실제 실행 결과를 구분합니다.
- 현재 버전은 전경 동기화만 제공합니다. 앱이 종료된 동안의 백그라운드 작업, 자동 계보 병합·cursor 재설정, 메모 병합 UI·버전 기록, 안전한 키 교체, 계정/비밀번호 관리, 폴더·태그·메모 공동 편집·웹 클라이언트는 포함하지 않습니다. 첨부 암호문의 자동 GC·저장소 간 자동 이전도 지원하지 않습니다. JSON 내보내기·새 사본 가져오기는 자동 백업을 대체하지 않습니다.
- 서버 change/receipt 보존은 무기한이며 별도 압축/정리 정책은 아직 없습니다. 장기간 대규모 사용 시 DB 크기를 점검하세요.

작업 규칙은 [AGENTS.md](AGENTS.md)를 참고하세요.
