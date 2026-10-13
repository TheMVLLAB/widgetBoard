# Widget Playground v0.3 · Notion OAuth 개발 및 배포 가이드

> 상태: **구현 소스 + 모의 통합 테스트 검증 완료**, 실제 Notion OAuth와 GitHub Pages/Cloudflare 배포 및 프론트엔드 전체 빌드는 계정과 네트워크 접근이 필요해 **미검증** 상태입니다.
>
> **비밀키를 GitHub, 이 채팅, `VITE_*` 변수나 임베드 주소에 기록하지 마세요.**

## 기능 요약

- 기존 7개 위젯 유지. Mini Charts에 **Notion OAuth** 연결 모드 추가.
- 사용자에게 `NOTION_TOKEN`, `NOTION_SOURCES_JSON`, `ADMIN_ACCESS_KEY` 입력을 요구하지 않음.
- Notion Public Connection의 **Read content** 권한으로 사용자별 워크스페이스 연결.
- D1에 워크스페이스별 OAuth 토큰을 AES-GCM 암호화하여 저장, Workers Secret에 암호화 키 보관.
- DB 검색 → 속성 매핑 → 월/일/카테고리별 합계·평균·건수 → 차트 미리보기.
- 차트는 **비공개로 저장**. 명시적 동의 후 공개한 경우 서버에서 집계한 **스냅샷**만 공개 임베드 URL로 표시.
- 공개 스냅샷은 **자동 갱신되지 않음**. 내 차트 목록에서 갱신하거나 공유를 해제할 수 있음.
- 비공개 차트는 임베드에서 자동 인증되지 않으며 외부 Builder 링크로 안내함.
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
npx wrangler d1 create widget-playground-oauth --config worker/wrangler.jsonc
```

생성 결과에서 실제 `database_id` UUID를 복사하여 `worker/wrangler.jsonc`의 `REPLACE_WITH_YOUR_D1_DATABASE_ID`를 교체하세요. **DB ID는 비밀키가 아닙니다.**

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

마이그레이션에서는 `users`, `connections`, `source_grants`, `oauth_states`, `auth_tickets`, `sessions`, `widgets` 테이블을 생성합니다. 운영 DB 마이그레이션은 실제 데이터를 변경하므로 적용 대상을 확인하세요.

## 3. 환경변수 등록

`worker/.dev.vars.example`을 `worker/.dev.vars`로 복사하여 로컬 개발에 사용하고, 프로덕션에는 `npx wrangler secret put ... --config worker/wrangler.jsonc`로 각각 등록하세요.

```bash
npx wrangler secret put NOTION_CLIENT_ID --config worker/wrangler.jsonc
npx wrangler secret put NOTION_CLIENT_SECRET --config worker/wrangler.jsonc
npx wrangler secret put NOTION_REDIRECT_URI --config worker/wrangler.jsonc
npx wrangler secret put TOKEN_ENCRYPTION_KEY --config worker/wrangler.jsonc
npx wrangler secret put FRONTEND_URL --config worker/wrangler.jsonc
```

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
npm run worker:deploy
```

GitHub 저장소 `main` 브랜치에 프로젝트를 푸시한 후 **Settings → Pages → Source: GitHub Actions**로 설정하세요. 프로젝트 내 `.github/workflows/deploy.yml`가 프론트엔드 정적 사이트를 배포합니다. Worker는 별도로 배포해야 합니다.

## 5. 실제 사용

1. GitHub Pages에서 **Mini Charts → Customize widget**을 엽니다.
2. 데이터 소스를 `Notion DB`로 선택한 뒤 **Notion 계정 연결** 클릭.
3. Notion 공식 승인 화면에서 워크스페이스와 공유할 페이지/DB를 선택합니다.
4. GitHub Pages로 돌아오면 연결한 데이터 소스가 나타납니다.
5. 날짜·숫자·카테고리 필드를 선택하여 비공개 차트를 미리봅니다.
6. **차트 비공개 저장** 클릭.
7. 노션 앱 내에서 인증 없이 표시해야 한다면 수치와 그룹 이름의 **공개에 명시적으로 동의**하고 **공개 집계 스냅샷 생성** 클릭.
8. 생성된 **공개 임베드 URL**을 `/embed` 블록에 추가합니다.
9. 새 데이터 반영은 **내가 저장한 차트 → 스냅샷 갱신** 버튼으로 수행합니다. 공개 중단은 **공유 해제** 버튼을 사용합니다.

## 6. 사용자 경험과 보안 제약

- **임베드 URL만으로 다른 사용자의 Notion DB가 연결되는 것은 아닙니다.** 각 사용자가 먼저 OAuth 승인 및 DB 선택을 거쳐 **자신의 위젯**을 생성해야 합니다.
- 브라우저 세션 토큰은 `sessionStorage`에만 보관하며 2시간 후 만료됩니다. OAuth 원본 access/refresh 토큰은 브라우저에 전달되지 않습니다. 세션 만료 후 Notion 연결을 다시 열어야 할 수 있습니다.
- 같은 사용자·워크스페이스의 새 OAuth 승인은 기존 연결 자격증명을 교체하며, 다른 계정과 분리됩니다.
- 브라우저의 iframe 제약 때문에 개인용 로그인 상태가 노션 데스크톱·모바일 앱 안으로 자동 전달되지는 않습니다. 비공개 차트는 잠금 안내와 외부 Builder 링크를 보여줍니다.
- 공개 임베드의 데이터는 링크를 아는 누구나 볼 수 있습니다. 공개를 승인하기 전 수치와 분류명에 민감한 정보가 없는지 확인하세요.
- 공개 모드는 **Notion의 원본 행을 직접 내보내지 않지만, 그룹명과 집계 숫자는 노출**합니다. 공개 응답은 저장된 스냅샷만 읽으며 Notion API를 실시간 호출하지 않습니다.
- 토큰은 AES-GCM으로 암호화 저장; 토큰 갱신 및 서버 측 사용자 격리를 적용했습니다. 공개 차트 취소 후 링크는 더 이상 작동하지 않습니다.
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

`test:worker`는 실제 Notion 서버 없이 SQLite 기반 모의 D1과 모의 Notion API 응답을 사용합니다. 서버 권한 오류·CSRF·일회성 코드·사용자 분리·공개 동의·공개 취소 등을 검증합니다.

**미검증**: 실제 Notion OAuth 설정/권한, GitHub Pages 배포, Cloudflare Workers/D1 배포, 노션 웹·앱의 iframe 동작. 환경상 npm 패키지 설치가 되지 않아 프론트엔드 빌드 검증도 남아 있습니다.

### 공식 참고 자료
- https://developers.notion.com/guides/get-started/authorization
- https://developers.notion.com/reference/post-search
- https://developers.notion.com/reference/query-a-data-source
- https://developers.cloudflare.com/d1/worker-api/
- https://developers.cloudflare.com/d1/reference/migrations/
