# ✳ Widget Playground

**v0.4: safer Notion embeds for duplicated and sold templates.**

> New: see [`EMBED_V04.md`](EMBED_V04.md) for template-safe URL mode, preview workflow, buyer reconfiguration, security and limitations. An interactive **standalone UI demonstration** is available in [`embed-v0.4-preview.html`](embed-v0.4-preview.html); this preview is not the deployed React application. This is a development build pending actual Notion embed checks.

**Small widgets. Big personality.** A playful collection of embeddable, interactive widgets for Notion, hosted on GitHub Pages. **Notion charts use user-specific OAuth connections, D1 storage and owner-only live embeds, without separate registration. Start with [OAUTH_SETUP.md](./OAUTH_SETUP.md).**

### Included in v0.1

1. **Daily Word**: stable word-of-the-day per date, difficulty selection, definition reveal, speech (if supported), learning check.
2. **Flashcard Deck**: tap to flip, advance, shuffle, mark memorized.
3. **Focus Garden**: a 5/15/25/50-minute timer and growing plant, session confirmation.
4. **Habit Stamps**: configurable habits and a 7-day record.
5. **Decision Roulette**: customizable choices and animated random selection.
6. **Mini Charts**: editable values in bar, line and donut charts.
7. **Smart Clock**: digital or analog, time zones and 12/24-hour format.

Plus a responsive **Discover gallery**, working **detail previews**, **Widget Builder**, three themes, reusable registry, and embed-only pages.

Widget spacing is fixed to the former **Compact** layout (18px × 20px padding, with narrower responsive padding in small embeds). Spacing and round-corner controls have been removed from the Builder and private chart display settings. Preview frames retain the default 22px corners; standalone embeds retain their existing surface styling. Old URLs remain readable, but their `density` and `radius` settings are ignored and omitted from new links. Embed layout widths remain configurable.

### Line chart design

Line charts use a cream-and-lavender momentum layout with a smooth SVG curve, a zero baseline, purple positive areas and coral negative areas. Mint and Midnight themes retain their own palette. Curves stay within adjacent data values rather than introducing artificial peaks. No chart dependency, blur filter or continuous animation is used.

- Manual chart input accepts up to **12 ordered label/value pairs**, including negative values, bounded to ±1,000,000. Existing embed links keep the same format. Bar charts support signed values; donut charts show an explanation instead of displaying negative values.
- **Net Change** is the last value minus the first. **Positive Points** counts values strictly greater than zero; it does not assume labels represent months.
- Select a point by clicking or by focusing it and pressing Enter/Space. Full labels and values appear below the plot; axis labels are thinned to avoid crowding. Narrative annotations are not fabricated from numeric data.
- Narrow embeds stack the summary cards; standalone embeds can be narrower than the gallery's 320px minimum. The Notion-backed chart uses the same renderer and keeps its existing authentication and data access contract.
- Line chart headings, values, labels and body text use **Pretendard Variable 1.3.9**, loaded from jsDelivr with dynamic Unicode subsets and `font-display: swap`. If the CDN is unavailable, system sans-serif fonts are used; other widgets retain their existing fonts.
- Verified locally in Chromium: 12 signed points, summary calculations, click/keyboard selection, single zero point, three themes, and a 310px iframe without horizontal overflow. Actual Notion clients and device performance have not been measured.


## Local development

Requirements: Node.js 22 or newer and an internet connection for the first `npm install`.

```bash
npm install       # creates package-lock.json on first install
npm run dev
npm test
npm run build
npm run preview
```

Open the URL printed by Vite. The app uses hash URLs so it can work under GitHub Pages subpaths without server rewrites.

## Deploy to GitHub Pages

1. Create a **public** GitHub repository named `widget-playground` (or any name). Run `npm install` once locally and commit the generated `package-lock.json` when possible.
2. Push this folder's contents to the `main` branch at the repository root.
3. Go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. The included `.github/workflows/deploy.yml` installs, tests and builds the app, then deploys `dist/`.
5. Once Pages finishes, open `https://YOUR_USERNAME.github.io/REPOSITORY_NAME/`.

In GitHub Actions, `vite.config.ts` uses the `GITHUB_REPOSITORY` environment variable to set `base` to `/REPOSITORY_NAME/`. A user/organization site named `username.github.io` uses `/`. For custom domains, set `VITE_BASE_PATH=/` as a workflow environment variable.

### Add to Notion

1. Pick a widget → **Customize widget**.
2. Choose theme and content; click **Copy link**.
3. In a Notion page, type `/embed` (or `/임베드`), paste the widget URL and select **Embed**.
4. Resize the block as desired.

Example structure (your actual URL is generated by the Builder):

```text
https://YOUR_USERNAME.github.io/widget-playground/?embed=daily-word&config=...
```

The `?embed=...` query route renders **only the widget**, not the gallery UI. A query string is used for external embeds because some iframe providers discard URL fragments.

## Architecture

- `src/lib/registry.ts`: the authoritative widget catalog and metadata.
- `src/lib/config.ts`: versionable widget settings, serialization and input sanitization.
- `src/lib/storage.ts`: browser-local state with try/catch fallback for blocked iframe storage.
- `src/data/words.ts`: offline, hand-curated English/Korean seed set (63 entries total, 21 per level).
- `src/widgets/Widgets.tsx`: seven functional widgets, same config and runtime contract.
- `src/App.tsx`: hash-routed gallery/detail/builder, with a query-routed standalone embed.
- `src/styles.css`: complete responsive styling and three widget themes.
- `src/lib/config.test.ts`: data safety and deterministic word selection tests.

The original seven local widget modes require no backend. **v0.4 adds template-safe embed links, a separate embed preview, responsive layout controls and stateless template-mode progress**. See [EMBED_V04.md](./EMBED_V04.md). **Notion chart mode** uses a Notion Public Connection, OAuth 2.0, a Cloudflare Worker and D1. Initial Notion OAuth establishes a two-hour HttpOnly browser session. Private embeds first reuse an unexpired localStorage bearer, then attempt cookie-based restoration through a strict-origin credentialed POST. Production root cookies use `SameSite=None; Secure`; if third-party cookies are blocked, the existing explicit confirmation and verifier-bound handoff remain available without requiring third-party cookies. Restored sessions never extend the root expiry. Previously issued Lax cookies need one explicit reuse confirmation or fresh OAuth to upgrade their attributes. App/profile storage isolation still prevents universal automatic sign-in. The URL alone grants no data access; the server checks widget ownership on every query. Logout revokes the browser session and its linked embeds. Saved charts query current Notion data. Public snapshot routes have been removed. No Notion write-back is supported. See [OAUTH_SETUP.md](./OAUTH_SETUP.md).

## Important limitations

- **State is local to the browser's storage environment**, not a Notion database or a cloud account. Some Notion desktop/mobile or browser environments restrict embedded third-party storage. The widget will remain usable, but persistence may be unavailable. Opening the URL on another device does not synchronize progress.
- **Never enter passwords, personal financial information or private data** into content that is encoded into the share URL. A URL is not confidential.
- The 63-word seed set is a first release sample, not a dictionary service. Pronunciation depends on `speechSynthesis` browser support and may be disabled by host permissions.
- The Focus Garden counts a session **only when manually confirmed** after the timer ends. Background tabs and OS throttling affect animation, but elapsed time is re-evaluated from timestamps.
- Public GitHub Pages deployment and actual Notion embed compatibility **must be checked on the user's devices**; build success alone cannot prove Notion client behavior.
- Line charts request Pretendard CSS and glyph subsets from jsDelivr; all font stacks retain system fallbacks if the network is unavailable.
- `offline-preview.html` is a self-contained UI preview, not the production React bundle.

## Add a new widget

1. Append metadata to `src/lib/registry.ts` and the identifier to `src/lib/config.ts`.
2. Implement a component and a thumbnail in `src/widgets/Widgets.tsx`.
3. Register it in `WidgetRenderer`, add its Builder controls in `src/App.tsx`.
4. Add tests for new config inputs and any data conversion.

## Roadmap

Post-MVP ideas: Daily Quiz, Knowledge Capsule, Desktop Pet, Quote Collector, Goal Ring, and cloud sync.

License: This project is a personal starter implementation; no license has been assigned. Add a license before accepting public contributions.

---

## v0.2 historical notes (superseded by v0.3 OAuth)

The v0.2 source adds **read-only Notion database-connected Mini Charts** with a separate Cloudflare Worker API. The existing seven widgets and their manual-data behavior remain available. The Builder now supports `Manual` and `Notion DB` chart sources. Authentication uses a high-entropy personal access key (never embedded in a URL), short-lived in-memory access token and explicit allowlist of data source aliases. The Worker aggregates page data on the server.

**Start with [CONNECTED_WIDGETS.md](./CONNECTED_WIDGETS.md)** for full Korean deployment, secret, and personal-Notion-connection instructions.

Additional project commands after `npm install`:

```bash
npm run typecheck:worker
npm run test:worker
npm run worker:dev
npm run worker:deploy
```

This is **source implementation with mocked API tests**, not an assertion that your actual Notion workspace or GitHub/Cloudflare accounts have been connected or deployed. `offline-preview.html` still previews the original v0.1 interface only; it does not run the new connected data feature.
