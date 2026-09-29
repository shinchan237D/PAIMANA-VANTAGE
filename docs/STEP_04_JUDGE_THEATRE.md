# Step 04 — Judge theatre / presentation route

This pass adds a restrained presentation layer for live hackathon demonstrations without creating a fake/demo data mode.

## What changed

- Added a **Demo path** action to the top bar.
- Added the **D** keyboard shortcut to open the presentation route; **Esc** closes it.
- Added a four-step route: **Observe → Locate → Investigate → Brief**.
- The Investigate step opens the currently selected project, then falls back to the first current watchlist project.
- Project investigation stages now visually distinguish the currently selected stage from merely available stages.
- Added print-safe behavior so the presentation drawer does not interfere with briefing/printing flows.

## Recommended judge walkthrough

1. **Observe** — establish latest reporting period, portfolio scale, assessment coverage and national pulse.
2. **Locate** — show the map, zoom/cluster behavior and location transparency.
3. **Investigate** — open a project, then move through Evidence / Trajectory / Commitment Stress.
4. **Brief** — finish with the National Monitoring Brief and its source-aware framing.

## Semantics

The presentation route is only navigation. It does not modify assessment logic, introduce synthetic project records, or replace the April 2026 active snapshot.
