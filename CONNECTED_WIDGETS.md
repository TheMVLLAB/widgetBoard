# Widget Playground v0.2 · 개인용 Notion DB 연동

> 상태: **연동 기능의 소스 코드 및 자동화 테스트 작성 완료. 실제 Notion 계정과 GitHub/Cloudflare 배포 환경 연결은 별도 진행 필요.**
>
> **내부 연결 비밀키, 개인 접근 키, 세션 서명키를 GitHub 저장소, 채팅, 위젯 URL에 입력하지 마세요.**

## 구성

```
Notion 데이터 소스 (읽기 전용 내부 연결)
             │ Notion-Version: 2026-03-11
             ▼
Cloudflare Worker (허용 목록/인증/조회/집계)
             ▲ Authorization: Bearer <30분짜리 세션 토큰>
             │ CORS: 허용된 사이트 출처만
GitHub Pages (React Builder 및 위젯 임베드)
             └── 노션의 /embed 블록에서 위젯 URL 로드
```

- 기존 7개 위젯은 유지되며 Mini Charts에 `Manual` / `Notion DB` 모드가 추가되었습니다.
- 토큰은 **Worker 환경변수 Secret**에만 저장합니다.
- 공유 가능한 URL에는 위젯 스타일, 등록된 데이터 소스 **별칭**, 속성 ID 및 집계 설정만 포함됩니다. 데이터 항목 및 비밀키는 들어가지 않습니다. DB 별칭·속성 ID도 외부에 알려질 수 있으므로 민감하게 관리한다면 링크 공유를 삼가세요.
- 인증용 접근 키는 32자 이상 충분히 무작위로 만들어야 하며, 인증 성공 시 **30분 유효**한 메모리 전용 세션 토큰을 발급합니다. 새로고침 또는 새 임베드 로드 때 재인증이 필요할 수 있습니다.
- Notion 데스크톱·모바일 앱에서는 임베드의 로그인/저장 기능에 제약이 있을 수 있습니다. **실기기 검증 전에는 앱에서 항상 작동한다고 보장하지 않습니다.**

## 1. Notion 준비

1. [Notion 개발자 통합 관리](https://www.notion.so/profile/integrations)에서 **내부 연결(Internal integration)** 을 생성합니다.
2. 권한은 **Read content(읽기)** 만 허용합니다. 불필요한 쓰기 권한은 끕니다.
3. 사용할 **원본 데이터베이스**를 열고 **연결(Connections)** 메뉴를 통해 해당 내부 연결에 접근 권한을 부여합니다. 연결된 뷰(Linked database)만 공유해도 원본에 대한 API 접근이 보장되지는 않습니다.
4. 데이터베이스 설정의 **Manage data sources → Copy data source ID** 를 사용하거나, `GET /v1/databases/{database_id}` 응답의 `data_sources` 목록에서 실제 **data source ID** 를 찾습니다. `database_id`와 `data_source_id`는 서로 다를 수 있습니다.
5. 내부 연결 토큰을 안전하게 보관하세요. 토큰을 위젯 빌더에 직접 입력하지 않습니다.

## 2. Worker 개발 환경

Node.js 22 이상과 npm을 설치합니다.

```bash
npm install
cp worker/.dev.vars.example worker/.dev.vars
```

Windows PowerShell에서는 `Copy-Item worker/.dev.vars.example worker/.dev.vars`를 사용합니다.

`worker/.dev.vars` 파일(절대 커밋 금지)을 다음과 같이 채웁니다.

```
NOTION_TOKEN="...Notion 내부 연결 토큰..."
NOTION_SOURCES_JSON='{"study":"...data_source_id...","finance":"...다른 data_source_id..."}'
ADMIN_ACCESS_KEY="...64자리 무작위 16진수..."
SESSION_SECRET="...ADMIN_ACCESS_KEY와는 다른 64자리 무작위 16진수..."
SITE_ORIGIN="http://localhost:5173,https://YOUR_NAME.github.io"
```

키는 각각 독립적으로 생성하세요. macOS/Linux/WSL: `openssl rand -hex 32`. PowerShell에서도 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 명령으로 만들 수 있습니다.

**`NOTION_SOURCES_JSON`은 접근을 허용할 데이터 소스의 별칭 → ID 매핑** 입니다. 여기에 등록되지 않은 DB는 설령 Notion 토큰에 접근 권한이 있어도 API를 통해 조회할 수 없습니다. 별칭은 영문자로 시작하고 영문·숫자·밑줄·하이픈만 사용할 수 있습니다.

```bash
npm run worker:dev
```

별도 터미널에서 `http://localhost:8787/api/health`로 API 준비 상태를 확인합니다.

루트의 `.env.local`에 아래 주소를 작성합니다. **이 파일에는 어떤 비밀키도 넣지 않습니다.**

```
VITE_NOTION_API_BASE=http://localhost:8787
```

```bash
npm run dev
```

`http://localhost:5173`의 Widget Builder에서 Mini Charts → Data source → Notion DB를 선택하여 접근 키를 입력하면, 허용된 Notion DB의 속성을 목록에서 선택할 수 있습니다.

## 3. Cloudflare Worker 프로덕션 배포

1. [Cloudflare 대시보드](https://dash.cloudflare.com/) 계정에서 Workers를 활성화합니다.
2. `worker/wrangler.jsonc`에서 Worker 이름을 확인합니다.
3. 아래 명령으로 계정에 로그인합니다.

```bash
npx wrangler login
```

4. 필요한 Secret 다섯 개를 등록합니다.

```bash
npx wrangler secret put NOTION_TOKEN --config worker/wrangler.jsonc
npx wrangler secret put NOTION_SOURCES_JSON --config worker/wrangler.jsonc
npx wrangler secret put ADMIN_ACCESS_KEY --config worker/wrangler.jsonc
npx wrangler secret put SESSION_SECRET --config worker/wrangler.jsonc
npx wrangler secret put SITE_ORIGIN --config worker/wrangler.jsonc
```

각 명령에서 입력하는 비밀값은 명령줄 인수 대신 인터랙티브 입력창을 사용합니다. `SITE_ORIGIN`은 실제 GitHub Pages 도메인(예: `https://YOUR_NAME.github.io`)을 허용하며, **경로(`/widget-playground/`)는 넣지 않습니다.** 커스텀 도메인을 사용하면 해당 도메인을 추가하세요.

5. Worker를 배포합니다.

```bash
npm run worker:deploy
```

6. 배포 결과로 반환된 `https://...workers.dev` 주소의 `/api/health`에 접속해 확인합니다.

> `wrangler.jsonc`는 Secret 다섯 개를 필수 항목으로 선언합니다. 처음 배포 시 Cloudflare의 Secret 등록 순서/설정 상태에 따라 추가 단계가 필요할 수 있습니다.

## 4. GitHub Pages 설정

기존 GitHub Pages 배포 워크플로를 그대로 사용합니다.

1. GitHub 저장소 **Settings → Secrets and variables → Actions → Variables**로 이동합니다.
2. `VITE_NOTION_API_BASE`라는 **공개 빌드 변수**를 생성하고 Worker 주소만 입력합니다(예: `https://widget-playground-notion.YOUR_SUBDOMAIN.workers.dev`).
3. **토큰이나 개인 접근 키를 여기에 넣지 마세요.** `VITE_` 접두사가 붙은 값은 웹사이트 코드에 노출됩니다.
4. 기본 브랜치에 푸시하여 GitHub Actions 테스트와 배포를 실행합니다.
5. Widget Builder에서 Mini Charts → Notion DB를 선택하고 DB·속성·집계 방식을 설정한 후 Embed URL을 복사합니다.
6. 노션에서 `/embed` 블록에 URL을 추가합니다. 데이터는 접근 키 입력 및 인증이 완료될 때에만 표시됩니다.

## 5. 구현된 집계 기능

| 분류 | 내용 |
|---|---|
| 그룹 | 월별, 일별, 카테고리별 |
| 연산 | 합계, 평균, 건수 |
| 값 | Number, 숫자 결과 Formula/Rollup |
| 날짜 | Date, Created time, Last edited time |
| 카테고리 | Select, Status, Multi-select, Checkbox |
| 기간 필터 | 시작/종료일, 최대 366일 범위 |
| 최신 정보 | 5분마다 갱신 시도 및 수동 새로고침 |
| 읽기 제한 | 최대 1,000개 항목, 36개 그룹. 초과 시 **불완전한 그래프 대신 오류** |
| 데이터 보호 | Worker에서 집계하고 **원본 페이지 내용은 미전송** |

**주의:** Multi-select의 항목이 A와 B 태그를 모두 가지면 각 카테고리별 집계에 각각 포함합니다. 따라서 카테고리 총합이 전체 합계보다 클 수 있습니다. 카테고리별 **순현금흐름 계산** 등 고급 로직은 현재 지원하지 않습니다. 수입·지출 부호를 부여한 Number 속성이 있다면 합계 차트에 사용할 수 있습니다.

도넛 차트는 음수 데이터를 표현하지 않고 안내 문구를 보여줍니다. 양수와 음수가 함께 있는 경우 막대 또는 꺾은선 차트를 선택하세요.

## 6. 테스트

```bash
npm test                         # 기존 React 유틸 테스트 (설치 필요)
npm run typecheck:worker         # Worker TypeScript
npm run test:worker              # Notion 모의응답·인증·집계 테스트
npm run build                    # Vite 프로덕션 빌드 (설치 필요)
```

테스트는 모의 Notion API 응답에 기반하며 실제 Notion 계정, Cloudflare 또는 노션 클라이언트 호환성 검증을 대체하지 않습니다.

## 7. 개인정보·운영 제한

- 개인 키 기반 로그인은 **1인 사용 시나리오**를 위한 방식입니다. 다수 사용자를 위한 인증·권한 모델이 아닙니다.
- 세션 JWT 유사 서명 토큰은 **메모리에만** 유지하며 페이지 로드 때 사라집니다. 로그아웃은 현재 브라우저 메모리의 토큰을 지우고, 이미 발급된 토큰 자체는 만료 전까지 서버에서 철회되지 않습니다. 만료 시간은 30분입니다.
- 서버는 일반적으로 응답 데이터를 캐시하지 않으며 `Cache-Control: no-store`를 설정합니다.
- 워크스페이스 전체에 대한 접근을 만들지 말고 대상 데이터베이스에만 내부 연결을 공유하세요.
- 클라우드 서비스에는 요청량 및 요금 제한이 있고, 악성 요청 방지를 위한 별도 Cloudflare WAF/Rate Limiting 정책 적용을 권장합니다. 장기 운영 시 OAuth·Cloudflare Access 등으로 강화할 수 있습니다.
- 개인 접근 키 분실 시 Cloudflare Secret에서 새 키를 등록할 수 있습니다. 세션키 `SESSION_SECRET`을 변경하면 기존 세션을 모두 무효화할 수 있습니다.

## 주요 공식 자료

- Notion API: https://developers.notion.com/reference/retrieve-a-data-source
- Notion API: https://developers.notion.com/reference/query-a-data-source
- Notion API 검색: https://developers.notion.com/reference/post-search
- Cloudflare Workers Secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Wrangler 설정: https://developers.cloudflare.com/workers/wrangler/configuration/
