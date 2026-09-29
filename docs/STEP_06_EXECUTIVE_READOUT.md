# Step 06 — Executive Readout / First-Minute Judge Surface

## Purpose
Make the first Overview screen explain Sentinel’s analytical flow within one glance, without inventing a demo dataset or collapsing observed facts into model claims.

## Added
- Executive Readout panel directly below historical coverage.
- Attention layer: elevated-or-higher signal count and portfolio share.
- Movement layer: projects with reported progress movement plus the no-change count.
- Commitment layer: completion-date revisions in the latest comparison.
- Evidence layer: assessment coverage and stored reporting-period depth.
- Attention card is clickable and routes to the Watchlist.
- Footer note clarifies that attention is a reference-class analytical signal and that movement/commitment are observed comparison outputs.
- Responsive two-column / single-column fallbacks for narrower screens.

## Data semantics
The panel reads `portfolio`, `changes`, `integrity`, `source`, and `audit` payloads already loaded by the application. It does not introduce new calculations to the backend and does not convert the attention score into a probability.

## Validation
- Backend regression suite: 7/7 passed.
- Frontend TypeScript check was attempted; the sandbox copy does not contain installed React/Leaflet/Recharts packages, so module-resolution errors remain environment-only.
