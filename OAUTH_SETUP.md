# Widget Playground · 비공개 Notion OAuth 위젯 개발 및 배포 가이드

> Notion OAuth가 사용자 인증을 대신하며 별도 회원가입은 없습니다. 공개 스냅샷 대신 위젯 소유자만 조회하는 최신 데이터 임베드를 사용합니다. 실제 계정 승인 및 Notion 웹·앱 호환성은 운영 환경에서 확인하세요.
>
> **비밀키를 GitHub, 이 채팅, `VITE_*` 변수나 임베드 주소에 기록하지 마세요.**

## 기능 요약

- 기존 7개 위젯 유지. Mini Charts에 **Notion OAuth** 연결 모드 추가.
- 사용자에게 `NOTION_TOKEN`, `NOTION_SOURCES_JSON`, `ADMIN_ACCESS_KEY` 입력을 요구하지 않음.
- Notion Public Connection의 **Read content** 권한으로 사용자별 워크스페이스 연결.
- D1에 워크스페이스별 OAuth 토큰을 AES-GCM 암호화하여 저장, Workers Secret에 암호화 키 보관.
- DB 검색 → 속성 매핑 → 월/일/카테고리별 합계·평균·건수 → 차트 미리보기.
- 차트는 **소유자 전용 비공개**로 저장합니다. 위젯 ID를 아는 것만으로는 조회할 수 없습니다.
- 임베드에서 **내 Notion 계정 인증**을 누르면 외부 창에서 OAuth를 진행하고, 원래 화면이 일회성 검증 값으로 인증 결과를 받습니다. 제3자 쿠키나 팝업 `opener`에 의존하지 않습니다.
- 저장한 차트는 조회할 때 Notion DB를 집계합니다. 공개 스냅샷 생성·공유 API는 제거되었습니다.
- 기존 v0.2의 개인용 `NOTION_TOKEN`/`ADMIN_ACCESS_KEY` 환경변수는 새 Worker에서 **더 이상 사용되지 않음**. 기존 Worker 및 환경 설정은 v0.3 설정으로 교체해야 함.

## 1. 사전 준비

- Node.js 22 이상 (권장 22 LTS), npm
- GitHub Pages로 배포할 GitHub 저장소
- Cloudflare 계정 및 D1 / Workers
- Notion Developer Portal에서 생성한 **Public Connection**
  - 앱 이름 예: Widget Playground
  - **Read content**만 부여 (읽기 전용)
  - 다른 사용자도 연결하게 하려면 설치 범위를 `Any workspace`로 선택
  - Redirect URI는 개발/운영을 각각 허용한 경우에만 등록. 예: `https://widget-playground-notion.YOUR_SUBDOMAIN.workers.dev/api/auth/notion/callback`
  - `client ID`, `client secret` 확인
  - 변경할 수 없는 설치 범위 설정을 주의해서 선택할 것

> Redirect URI는 Notion Developer Portal, Workers Secret 값, 실제 Worker 엔드포인트에서 **완전히 동일**해야 합니다. `http://localhost:8787`를 Notion Developer Portal이 허용하지 않으면 운영 Worker 또는 별도의 HTTPS 터널에서 OAuth 테스트하세요.

## 2. 설치 및 D1 생성

프로젝트 루트에서:

```bash
npm install
npx wrangler login
npm run db:create
```

새 DB를 생성한 경우 출력된 UUID를 `worker/wrangler.jsonc`의 `database_id`에 설정하세요. 이미 `widgetboard` DB가 있으면 생성 단계는 건너뜁니다. **DB ID는 비밀키가 아닙니다.** D1 `binding`은 코드가 사용하는 `DB`, `database_name`은 npm 스크립트의 `widgetboard`와 일치해야 합니다.

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

마이그레이션에서는 `users`, `connections`, `source_grants`, `oauth_states`, `auth_tickets`, `sessions`, `widgets` 테이블을 생성합니다. 운영 DB 마이그레이션은 실제 데이터를 변경하므로 적용 대상을 확인하세요.

OAuth API Worker 이름은 `widget-playground-notion`입니다. 프론트엔드를 제공하는 `widgetboard` Worker와 별도로 배포하여 기존 프론트엔드를 덮어쓰지 마세요.

## 3. 환경변수 등록

`worker/.dev.vars.example`을 `worker/.dev.vars`로 복사하여 로컬 개발에 사용하고, 프로덕션에는 `npx wrangler secret put ... --config worker/wrangler.jsonc`로 각각 등록하세요.

```bash
npx wrangler secret put NOTION_CLIENT_ID --config worker/wrangler.jsonc
npx wrangler secret put NOTION_CLIENT_SECRET --config worker/wrangler.jsonc
npx wrangler secret put NOTION_REDIRECT_URI --config worker/wrangler.jsonc
npx wrangler secret put TOKEN_ENCRYPTION_KEY --config worker/wrangler.jsonc
npx wrangler secret put FRONTEND_URL --config worker/wrangler.jsonc
```

로컬에 운영 값이 준비되어 있다면 다음 명령으로 필수 Secret과 API를 함께 배포할 수 있습니다. 이 파일은 Git에 커밋하지 마세요.

```bash
npm run worker:deploy -- --secrets-file worker/.env.production.local
```

배포 후 `https://widget-playground-notion.YOUR_SUBDOMAIN.workers.dev/api/health`가 `{"ok":true,...}` JSON을 반환하는지 확인하세요. 프론트엔드 API 주소는 이 Worker의 루트 URL, Notion에 등록할 Redirect URI와 `NOTION_REDIRECT_URI`는 같은 URL의 `/api/auth/notion/callback`이어야 합니다.

| 이름 | 설명 | 예시 |
| --- | --- | --- |
| `NOTION_CLIENT_ID` | Notion Public Connection Client ID | 직접 복사 |
| `NOTION_CLIENT_SECRET` | Notion Public Connection Client Secret | 직접 복사, **비공개** |
| `NOTION_REDIRECT_URI` | Worker OAuth Callback | `https://my-worker.workers.dev/api/auth/notion/callback` |
| `TOKEN_ENCRYPTION_KEY` | 32바이트 암호화 키의 hex 표현(64자리) | 아래 명령으로 생성 |
| `FRONTEND_URL` | GitHub Pages 앱의 정확한 배포 URL(끝의 `/` 포함 권장) | `https://YOUR_NAME.github.io/widget-playground/` |

Windows PowerShell에서 **암호화 키** 생성:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

프로덕션 암호화 키를 분실하면 기존 암호화된 OAuth 토큰을 복원할 수 없습니다. 암호화 키를 변경할 때는 재연결 또는 별도 키 마이그레이션이 필요합니다.

Worker 주소(비밀키가 아님)를 GitHub 저장소 **Settings → Secrets and variables → Actions → Variables**에서 `VITE_NOTION_API_BASE`로 등록하세요. 로컬 프론트엔드는 루트 `.env.local`에 `VITE_NOTION_API_BASE=http://localhost:8787`을 설정합니다.

## 4. 실행

```bash
npm run typecheck:worker
npm run test:worker
npm run worker:dev
```

다른 터미널:

```bash
npm run dev
```

Worker 및 앱의 OAuth Redirect URI는 환경에 맞춰 서로 일치시켜야 합니다. 로컬 실행 전에 `npm run db:migrate:local`을 실행해야 D1 테이블이 생성됩니다.

운영 배포:

```bash
npm run db:migrate:remote
npm run worker:deploy
```

GitHub 저장소 `main` 브랜치에 프로젝트를 푸시한 후 **Settings → Pages → Source: GitHub Actions**로 설정하세요. 프로젝트 내 `.github/workflows/deploy.yml`가 프론트엔드 정적 사이트를 배포합니다. Worker는 별도로 배포해야 합니다.

## 5. 실제 사용

1. GitHub Pages에서 **Mini Charts → Customize widget**을 엽니다.
2. 데이터 소스를 `Notion DB`로 선택한 뒤 **내 Notion 계정 인증**을 누릅니다.
3. 외부 Notion 승인 화면에서 워크스페이스와 공유할 페이지/DB를 선택합니다.
4. 인증 완료 후 원래 Builder 화면에 연결한 데이터 소스가 나타납니다. 입력 중인 설정은 유지됩니다.
5. 날짜·숫자·카테고리 필드를 선택하여 비공개 차트를 미리봅니다.
6. 차트를 비공개 저장하고 생성된 **개인 임베드 URL**을 복사합니다.
7. 자신의 Notion 페이지에 `/embed` 블록으로 추가합니다.
8. 임베드에서 인증이 필요하면 **내 Notion 계정 인증**을 누릅니다. 다른 계정으로 인증한 경우 원래 소유자의 데이터는 표시되지 않습니다.
9. 위젯은 화면이 보일 때 주기적으로 최신 기록을 조회합니다. 즉시 확인하려면 새로고침 버튼을 누릅니다.

## 6. 사용자 경험과 보안 제약

- **임베드 URL만으로 다른 사용자의 Notion DB가 연결되는 것은 아닙니다.** 각 사용자가 먼저 OAuth 승인 및 DB 선택을 거쳐 **자신의 위젯**을 생성해야 합니다.
- 브라우저 세션은 2시간 후 만료됩니다. `sessionStorage`가 허용되면 현재 탭에 저장하고, 차단되면 메모리에만 유지합니다. 만료·로그아웃 시 표시 중인 비공개 기록을 제거합니다.
- 같은 사용자·워크스페이스의 새 OAuth 승인은 기존 연결 자격증명을 교체하며, 다른 계정과 분리됩니다.
- iframe은 Notion에 로그인한 사용자 정보를 자동으로 받지 않습니다. 위젯 인증 버튼은 외부 창에서 OAuth를 진행합니다. 팝업이 차단되면 제공되는 외부 인증 링크를 사용하세요. 저장소가 차단된 환경에서는 위젯을 다시 열 때 재인증이 필요합니다.
- 인증 요청은 10분간 유효하며, 원래 화면만 가진 임의 검증 값의 해시로 결합합니다. 인증 URL에는 요청 ID만 있고 검증 값·세션·Notion 토큰은 없습니다. 완료된 인증은 한 번만 수령할 수 있습니다.
- 서버가 로그인 사용자와 위젯 소유자를 매번 비교합니다. 비인증 요청·다른 계정·복사된 링크로는 소유자의 기록을 조회할 수 없습니다. 브라우저에는 원본 행 대신 집계값만 전달합니다.
- OAuth 토큰은 AES-GCM으로 암호화 저장합니다. 공개 스냅샷 조회·생성·갱신·공유 해제 경로는 제거되어 이전 공개 링크도 데이터를 공개하지 않습니다.
- 접근 제한: 최대 조회 항목 1,000개, 검색 데이터 소스 최대 500개/연결, 그룹 최대 36개. Notion API 요청 제한이 걸리면 오류 표시.
- **서비스 공개 전에는 Rate Limiting, 모니터링, 정기적인 데이터 보존/삭제 정책, 동시 토큰 갱신 및 브라우저별 임베드 테스트를 추가 검증**해야 합니다.
- 개발 및 테스트용 v0.2 Internal Connection 토큰은 제거·폐기하고 공개 코드에 올리지 마세요.

## 7. 검사

```bash
npm run typecheck:worker
npm run test:worker
npm test
npm run build
```

`test:worker`는 실제 Notion 서버 없이 모든 SQL 마이그레이션을 적용한 SQLite 기반 모의 D1과 모의 Notion API를 사용합니다. 소유자 전용 조회·최신 값·CSRF·검증 값·일회성 수령·만료·동시 수령·트랜잭션 실패 시 복구를 검증합니다.

**운영 확인 필요**: 실제 Notion 계정 승인과 DB 권한, Notion 웹·데스크톱·모바일의 iframe/외부 창 동작. 새 `0003_embed_handoffs.sql`을 먼저 적용한 뒤 API와 프론트엔드를 함께 배포하세요. 서버 변경만 배포하면 이전 프론트엔드의 인증·공개 스냅샷 경로는 더 이상 동작하지 않습니다.

### 공식 참고 자료
- https://developers.notion.com/guides/get-started/authorization
- https://developers.notion.com/reference/post-search
- https://developers.notion.com/reference/query-a-data-source
- https://developers.cloudflare.com/d1/worker-api/
- https://developers.cloudflare.com/d1/reference/migrations/
