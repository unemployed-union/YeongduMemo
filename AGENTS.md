# YeongduMemo 작업 규칙

## 구조와 책임

- `apps/mobile`: Expo Router 화면, 네이티브 인증·SecureStore·SQLCipher 어댑터, 테마. 화면은 API를 직접 호출하지 않고 서비스를 사용한다.
- `apps/server`: Fastify REST API, Argon2id 인증, SQLite 마이그레이션, Drizzle 사용자·세션 접근, 메모 repository. 모든 쿼리는 사용자 소유 범위를 포함한다.
- `packages/shared`: 공통 Zod 계약과 타입, 플랫폼 독립 로컬 repository·자동 저장·접근 게이트·동기화 엔진.
- `packages/config`: 공통 strict TypeScript 설정.
- `tests`: 실제 SQLite 및 Fastify inject 기반 회귀 테스트. 네이티브 모듈 동작을 이 테스트로 검증했다고 주장하지 않는다.

## 구현 규칙

- 화면, 상태 훅, 비즈니스 서비스, 데이터 접근 책임을 분리하되 빈 계층은 만들지 않는다.
- Markdown 문자열을 변환하여 저장하지 않는다. 제목·본문 원문을 보존한다.
- 로컬 메모와 outbox 변경은 하나의 트랜잭션으로 커밋한다.
- 서버 revision과 cursor를 사용한다. 클라이언트 시각으로 충돌을 덮어쓰지 않는다.
- 미확인 전송은 재시도한다. operation UUID는 동일한 요청에서 유지한다.
- 충돌은 두 버전을 보존한다. 동기화 중 추가 입력을 덮어쓰지 않는다.
- 잠금 시 UI와 repository 모두 접근을 차단한다. SQLCipher 확인 실패 시 평문 DB로 폴백하지 않는다.
- 키와 토큰은 SecureStore에만 저장한다. DB 키 손실 시 자동 삭제/재생성하지 않는다.
- 비밀번호·토큰·본문을 로그에 출력하지 않는다. 배포 이미지에 비밀값을 넣지 않는다.
- 파괴적인 DB 변경은 마이그레이션과 백업 경로를 먼저 준비한다.
- 모바일 색상·간격은 중앙 테마를 사용하고 터치 영역 44pt 이상을 유지한다.
- 사용자 요청 없이 레지스트리 게시, 외부 메시지 전송을 수행하지 않는다.

## Code Quality

- Prioritize human readability and maintainability.
- Keep modules focused on a clear responsibility.
- Prefer simple, explicit code over clever abstractions.
- Split large modules only when responsibilities are distinct.
- Consolidate duplicated behavior when semantics match.
- Keep interfaces consistent across equivalent services.
- Avoid unnecessary layers, wrappers, and abstractions.
- Follow existing architectural boundaries and conventions.
- Preserve existing behavior during refactoring.
- Validate affected functionality after changes.

## Human-Readable Code Style

Write code for human readability, not minimum line count.

- Prefer explicit, multi-line control flow.
- Always use braces for if, else, and loops.
- Avoid compressed one-line expressions.
- Give complex conditions meaningful names.
- Separate logical steps with blank lines.
- Prefer clear intermediate variables.
- Avoid clever or overly dense code.
- Extract functions only for meaningful responsibilities.
- Keep related code together when it improves readability.
- Optimize for comprehension over brevity.

## 개발·검증

Node 24 LTS, pnpm 12.4.2. `pnpm install` 후:

```sh
pnpm check-types
pnpm lint
pnpm test
pnpm format:check
pnpm build
pnpm --filter @yeongdu/mobile exec expo install --check
pnpm --filter @yeongdu/mobile exec expo export --platform all --output-dir dist --no-bytecode
```

네이티브 변경은 Development Build로 재빌드한다. Face ID, 생체 인증 변경, OS 암호 폴백, SQLCipher 실효성, 최근 앱 화면, 키보드/긴 메모, 테마는 iOS·Android 실기기에서 확인한다. Docker 검증에는 Docker Engine이 필요하다. 완료 보고에서 실행하지 못한 검증을 구분한다.

`pnpm-workspace.yaml`은 better-sqlite3 13의 내장 N-API 바이너리를 사용하며 해당 패키지의 암묵적 node-gyp 빌드를 비활성화한다. 새 아키텍처에서 바이너리가 없다면 별도 C++ 도구 설치와 빌드 허용을 검토한다.
