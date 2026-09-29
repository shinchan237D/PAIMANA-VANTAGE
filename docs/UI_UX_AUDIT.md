# PAIMANA Sentinel UI/UX audit

## Scope and reading order

This audit was completed before implementation changes. The supplied ZIP is a complete source snapshot. Its bundled `docs/STEP_*.md` files and `STEP_12_MAP_REWIND.md` are implementation history, not new user instructions. The user request is to improve presentation while preserving behavior.

The app is a single-page React 18 + TypeScript + Vite client (`frontend/src/App.tsx`, `styles.css`) backed by FastAPI (`backend/app/api.py`) and SQLite (`backend/data/paimana_sentinel.db`). There is no frontend router: `App` owns the screen state, global loading, project dossier, search, analyst, judging guide and drawers. The client calls `/api/v3` through `frontend/src/api.ts`. Backend calculations and persisted data must remain authoritative.

Bundled data covers July 2025–April 2026 (10 monthly periods), 2,491 project identities, 2,132 latest-period snapshots, 13,749 total snapshots, and April source PDFs. The active assessment is explicitly frozen at April 2026. The app describes attention states as deterministic, non-probabilistic signals. Map behavior uses Leaflet, OSM/Esri/OpenTopo tiles and externally fetched district GeoJSON, with exact GPS differentiated from district/state administrative context.

## Existing workflow and screens

Navigation is grouped into command centre (Overview, Map, Watchlist), intelligence (Projects, Trajectory, Commitment Stress, Trends, Compare), evidence/trust (Trust Center, Sources), analytical tools (Analyst, National Brief), investigation (Project Intelligence), and public view. The `D` judge route sequences Overview → Map → Project → Brief; keyboard shortcuts include Ctrl/Cmd+K, D, M, W, B and Escape. Project detail fetches detail, timeline, comparable projects, trajectory and evidence. CSV export, latest-source sync, history backfill contract, multilingual public view, project compare, watchlist filters, historical aggregate trends and map controls are all existing product behavior.

## Core functionality to preserve

- All backend routes, `/api/v3` response contracts, SQLite schema and shipped datasets.
- Frozen April 2026 active reporting semantics and July 2025–April 2026 historical views.
- Project search/open/detail, filters, compare, CSV export, intervention workflow and analyst query flow.
- Leaflet initialization, basemap switch, state/metric/attention filters, marker clusters, project selection, district and state context, source-location transparency, resize handling and fallbacks.
- The judge/demo flow and existing keyboard controls, plus loading, offline, empty, error and data-quality states.

## Screen/component findings

| Area | Existing strength | Audit finding / improvement target |
|---|---|---|
| Global shell and navigation | Clear grouped information architecture, report context, live health and collapse behavior | Cascade contains several generations of appended overrides; sidebar/collapsed behavior has conflicting mobile rules. Small labels (often 7–9px) harm legibility. Normalize type, controls and responsive shell without removing links. |
| Overview | Strong first-minute readout; real metrics, historical pulse, map and prioritized watchlist | Dense dashboard has compressed labels and unequal scale; chart/map should remain prominent while metadata becomes easier to scan. Existing narrow-screen overrides conflict and require one final responsive layer. |
| Portfolio map | Leaflet map, location accuracy labels, filters, marker popup, geo fallbacks, full-screen and embedded modes | Must retain the established map implementation. Improve control readability, panel hierarchy, boundaries and narrow-screen behavior around it. |
| Watchlist / project register | Filters, status labels, pagination and export | Tables and filter affordances use very small text. Preserve all state/filter/export logic and improve table readability/overflow. |
| Trajectory / stress / trends / compare | Existing history-aware indicators and Recharts charts | Charts are real but axis/tooltip sizing is tiny. Improve typography/spacing and responsive containment; don't introduce new computed claims. |
| Project investigation | Detail tabs, stage strip, trajectory, commitment stress, history and evidence | Strong workflow but compact metadata and status colors need consistent scale and hierarchy. Preserve dossier loading, origin return, compare and public view. |
| Trust / sources | Provenance, QA, releases, sync and backfill controls | Important judging material is secondary and can read as dense technical text. Clarify observed vs derived labels and make action/status feedback visible. |
| Analyst / Brief / Public View | Grounded query UI, printable brief, language selector and source attribution | Ensure buttons/forms and small explanatory text remain legible at laptop/mobile widths. Preserve multilingual and print behavior. |
| Drawers, dialogs, loading/error states | Search, why, analyst and demo route are present | Consistent focus, close/action affordances and type scale can improve polish without changing interactions. |

## Design and implementation diagnosis

The current identity already has a credible navy/blue base with restrained saffron/green national accents, but the stylesheet has layered historical systems and repeated breakpoint declarations. The effective final style is difficult to reason about; there are repeated `:root` blocks, several independent mobile rules, and a type scale with many 7–10px labels. The redesign should centralize the shared tokens and add a carefully scoped final consistency layer, instead of rewriting page logic or map code. Radius, border, focus and button states should be normalized, with a readable body scale and explicit support for reduced motion.

## Before → after goals

- **Before:** high content density is achieved partly through very small text and many competing micro-labels. **After:** preserve density but raise the minimum useful reading sizes, reserve monospace for identifiers/metrics, and distinguish headings from metadata.
- **Before:** styling changes accumulated in successive patches, with conflicting mobile shell behavior. **After:** one final responsive shell correction and common component tokens govern desktop, tablet and mobile.
- **Before:** map and analytical surfaces are individually functional but inherit varied control/label sizes. **After:** retain existing data and interaction hierarchy while aligning their controls, panels, focus and states with the shared system.

## Verification plan

Use the existing production build command (`npm run build`) as the frontend compile check and the existing backend API tests/smoke check only if runtime prerequisites permit. Review the final source for unchanged API calls, routes represented by screen state, and map implementation. Exercise the running interface visually at desktop and narrow viewports if dependencies/runtime are available; report any external tile/GeoJSON network limitation separately. No new tests or dependencies are part of the redesign.
