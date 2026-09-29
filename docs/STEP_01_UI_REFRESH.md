# PAIMANA Sentinel — Step 01 UI Refresh

## What changed

This stage keeps the April 2026 backend/data model as the source of truth and refreshes the frontend using the stronger command-centre visual language from the full-history build.

### UI
- Reworked top bar and collapsible navy/orange command-centre sidebar.
- Redesigned national overview with dense KPI readouts, national pulse, map hero and watchlist.
- Reused the richer portfolio map interaction, including map controls, state context, attention filters and project popovers.
- Added/retained project intelligence pages for trajectory, commitment stress, trends, comparison, trust, source releases, analyst and brief generation.
- Refined project detail into a tabbed intelligence workspace with evidence, trajectory, stress and historical-recovery surfaces.
- Responsive behavior retained for smaller screens.

### Backend/frontend contract
- Frontend now targets the April rebuild's `/api/v3` backend.
- The project register pulls every April project page, avoiding the previous 200-row silent truncation. The bundled April database contains 2,132 active project rows.
- v3 source metadata is adapted into the richer UI contract without inventing a probability model or unsupported source status.
- Trajectory analysis in the frontend is derived from the stored monthly timeline when the v3 API does not expose a separate trajectory route.
- Citizen/public view is generated from verified project facts from the v3 project endpoint.
- State-level map aggregation now includes cost/expenditure totals and completed/ongoing counts.
- Portfolio change tracking now includes the count of projects with revised costs.

## Snapshot contract

- Active assessment: `2026-04` (April 2026).
- Historical stored project snapshots: July 2025 through April 2026.
- Newer reporting periods are not silently promoted into the assessment view.
- Project-level map points are explicitly treated as administrative/state-centroid context where the source does not provide exact coordinates.

## Validation

Backend regression suite: **7 passed**.

Validated contracts include:
- April active-period freeze.
- 2,132-project latest portfolio.
- Map coverage and location-context disclosure.
- Project history and evidence payloads.
- Persistent intervention workflow.
- Frozen source-sync behavior.
- CSV export.

The packaging environment could not complete `npm install`, so a full Vite production build could not be executed inside this sandbox. The supplied Windows launcher will install the frontend dependencies on first run.

## Next stage

Step 02 should focus on demo polish: map/popover micro-interactions, stronger empty/loading/error states, presentation-safe typography/spacing, and a short judge-flow path from Overview → Map → Watchlist → Project → Evidence → Brief.
