# Step 03 — Investigation Flow

## What changed

Step 03 turns the map and project detail surfaces into one continuous investigation flow.

### Map → project
- Clicking a project marker now selects it and opens the map project preview instead of immediately navigating away.
- The preview carries the project code, state, sector, physical progress, attention score and revised cost.
- `Open project` from that preview is the deliberate transition into Project Intelligence.
- The selected-project preview is available in both the full map and the embedded overview map.

### Project Intelligence
- Added an investigation signal rail directly below the headline KPIs.
- The rail surfaces current attention, latest movement, commitment revisions, derived recovery rate and history length.
- The signal rail is descriptive: it does not turn the monitoring score into a probability claim.

### Stage strip
- Assess / Diagnose / Stress / Recover stages are now interactive.
- Each stage jumps directly to the relevant project tab, creating a visible left-to-right investigation path for a live demo.

### Navigation continuity
- The project page remembers the surface from which it was opened.
- `Back to previous view` now returns to Map, Watchlist, All Projects, Trajectory, Stress, Comparison or Overview instead of always forcing the user back to Watchlist.

## Judge demo path

1. Open **National Overview** and establish the April reporting snapshot.
2. Enter **Portfolio Map** and click a project marker.
3. Use the preview card to enter **Project Intelligence**.
4. Read the signal rail, then click **Diagnose**, **Stress** or **Recover** in the stage strip.
5. Open **Evidence** and use **Why?** for the evidence-separated explanation.
6. Return to the originating surface without losing context.

## Verification

- Backend regression suite: 7/7 passed.
- Frontend TypeScript/JSX syntax transpilation: passed.
- Full Vite build could not be executed in the packaging sandbox because npm dependency installation timed out; the package intentionally does not include `node_modules`.
