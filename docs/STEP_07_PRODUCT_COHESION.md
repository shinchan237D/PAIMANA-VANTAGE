# Step 07 — Product Cohesion + Repeatable Judge Route

## Goal
Make the app read as one investigation product instead of a set of independent pages.

## Changes
- Added a compact internal **view context rail** under the global header.
- Context rail shows the current module, investigation stage, active report period, and a one-line purpose cue.
- Project Intelligence adds the project code to the context rail for continuity.
- Demo path now highlights the **current screen** with a `NOW` state.
- Demo path includes a live status line and a **Reset judging route to Overview** control.
- Reset clears project-specific investigation state before returning to Overview.
- Mobile presentation keeps the context rail compact and hides low-value helper text.
- Removed a duplicate Leaflet geometry style object key from the map layer configuration.
- Version bumped to `7.0.0-step07`.

## Recommended judge flow
`D` → Observe → Locate → Investigate → Brief

For the strongest investigation sequence, open a map marker, inspect the project, use **Why?**, then move through Trajectory / Commitment Stress before returning to the National Monitoring Brief.

## Validation
- Backend Python compile: PASS
- Backend regression suite: **7/7 PASS**
- Frontend production build: not executed in the sandbox because dependency installation is unavailable; source changes were inspected and the existing package contract was preserved.
