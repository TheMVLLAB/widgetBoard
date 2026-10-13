# Widget Playground v0.4 · Notion Embed Experience

> Development package, not a verified public deployment. Do not publish private Notion data as part of a shared template.

## Goal

Widget Playground remains a **public widget library**. Notion templates are independently created and sold by their authors. There is no Template Distribution Mode, creator subscription, license enforcement or marketplace integration. The only product feature added is a safe, convenient embed experience.

## What's new

- **Embed settings** in the existing Builder: compact/standard/wide layout, heading, border, transparent background, reduced motion.
- **Two preview modes**: personal widget vs. template-duplicate experience.
- **Two link types** for regular widgets: individual embed and **template-safe embed**. A Notion-connected chart only exposes the template-safe demo link in the link area; explicit public snapshot links are managed separately.
- **Template-safe URL**: `?embed=<widget>&config=<encoded>&mode=template&v=1`. `mode=template` forces stateless browser behavior for progress widgets. Never treat it as an individual user's unique installation.
- **Notion chart template-safe URL**: omits creator's Notion data-source keys and property IDs and renders only built-in demo data, even when the viewer is already authenticated. Users must click “내 위젯으로 설정” to connect their own DB in the external Builder.
- **Standalone customization link**: `#/build/<widget>?config=<sanitized preset>` launches a new instance ID, preserving colors and safe settings but not creator access credentials.
- **Compatibility**: older v0.1/v0.2/v0.3 URLs with `?embed=...&config=...` still decode with new embed defaults. A corrupt `config` falls back to defaults with a warning.
- **Adaptive layout**: CSS container queries accommodate small embed widths. Actual iframe size/height is controlled by Notion, not by the widget.

## For authors of commercial Notion templates

1. Open the widget gallery and choose a widget → **Customize**.
2. Configure its appearance, content and `NOTION EMBED` settings.
3. In the preview switch, select **템플릿 복제 화면**. Confirm it looks good with demo data, or without saved progress.
4. Copy **템플릿 복제용 링크**. Add it to the Notion template using `/임베드`.
5. Duplicate the template into a separate test workspace and ensure that it contains neither the creator's Notion data nor their personal progress.
6. For connected charts, leave the sample chart in the product. Tell buyers to click **내 위젯으로 설정**, approve Notion OAuth, choose their own DB, select and verify fields, then replace the sample embed URL with their own. Publishing an aggregated snapshot is **optional, explicit and publicly link-accessible**.

### Buyer UX by widget type

| Widget | Copied template behavior | Buyer setup |
|---|---|---|
| Clock, daily vocabulary, roulette | Immediately usable with copied preset | Optional styling |
| Focus Garden, Flashcards, Habit Stamps | Interactive but **no persistent progress** in template-mode URLs | Customize to generate a unique standard personal embed if persistence is needed; local storage may still be blocked in Notion |
| Mini Charts (manual) | Uses authored non-private chart values | Optional personalization; do not put confidential numbers in a shareable URL |
| Mini Charts (Notion) | Demo-only, no creator DB identifiers | OAuth + buyer's own DB + chart settings; explicit publishing for unauthenticated embed snapshots |

**Why no automatic per-buyer data?** Notion does not give an iframe a buyer's identity, workspace, database ID, or credentials when the template is duplicated. It also does not automatically rewrite embedded links. Never pretend an unchanged URL is an individual user-specific connection.

## Security promises and limitations

- A template-safe link strips connected Notion source keys, property IDs and the creator's runtime state identifier from its encoded `config`.
- OAuth tokens are never part of an embed URL. The existing v0.3 backend protects them behind Cloudflare Workers + D1.
- Template mode disables use of localStorage for study progress to avoid shared-state surprises across copies of identical links. As a tradeoff, **the progress resets after reload**.
- Individual links have distinct instance IDs when created from a template preset. Browser-local persistence is best-effort and may be blocked or partitioned by Notion web/desktop/mobile or the browser.
- Connected non-template/private embeds require an authenticated user; there is no guarantee of OAuth/session compatibility inside Notion desktop/mobile. Open Builder outside Notion to connect and manage the chart.
- Public snapshots reveal aggregated values to **anyone with the URL** and are not automatically updated. Choose them only for data safe to disclose publicly.
- This version contains no payment, purchase verification, automatic instance provisioning per template duplicate, account-based persistence for study widgets, or write-back to Notion blocks.
- The normal URL can contain text entered by the author, so never store private information inside a shared widget's preset.

## URL examples (illustrative, not live links)

```text
# Existing personal link (still supported)
https://example.github.io/widget-playground/?embed=smart-clock&config=ENCODED

# Template-safe link (new)
https://example.github.io/widget-playground/?embed=smart-clock&config=ENCODED&mode=template&v=1

# Customize from template: new safe instance ID
https://example.github.io/widget-playground/#/build/mini-charts?config=SANITIZED
```

## Run and validate

From the project root:

```bash
npm install
npm test
npm run typecheck:worker
npm run test:worker
npm run build
npm run dev
```

Deployment remains GitHub Pages for the React site and Cloudflare Worker/D1 for the optional Notion OAuth integration. See `OAUTH_SETUP.md` to configure your own deployment; never commit secrets.

### Manual Notion acceptance tests (required before production use)

- [ ] `?embed=...` renders only widget UI; no gallery nav or site header
- [ ] Standard URL still displays and does not lose legacy settings
- [ ] Template URL renders without login (including Notion-connected chart demo)
- [ ] Template chart has no creator DB/connection identifiers
- [ ] Template-mode activity does not persist between reloads
- [ ] “내 위젯으로 설정” opens the correct standalone Builder preset
- [ ] Builder creates a new state instance rather than reusing creator instance
- [ ] Notion desktop/web/mobile render at compact, standard, wide embed sizes
- [ ] Focus/keyboard operation and reduced-motion settings work
- [ ] Real OAuth and public/private snapshot behavior tested only after secure backend deployment

**Current verification:** previous Cloudflare Worker tests and independent config/URL smoke tests passed here; full React build and actual Notion web/app integration have not yet been performed because npm dependency downloads failed in this environment.
