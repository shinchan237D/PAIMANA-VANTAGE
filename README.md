# PAIMANA Sentinel — April 2026 rebuilt build

A hackathon-ready backend-first rebuild of the PAIMANA Sentinel prototype with a command-centre UI, portfolio map and evidence/trust surfaces. The active/current assessment is **April 2026** and the frontend is a client of the backend rather than a second business-logic layer.

## What is bundled

- April 2026 PAIMANA Flash Report as the active snapshot
- Canonical monthly project history from July 2025 through April 2026
- SQLite source registry + project identities + project × month snapshots
- Deterministic integrity engine
- Required recovery-rate and trajectory calculations
- Transparent attention states
- Historical comparable cohort service
- Evidence/provenance responses
- State-context portfolio map
- Intervention workflow + audit trail
- Structured Analyst query endpoint
- CSV export
- Responsive React/Vite frontend using the command-centre/sidebar/map visual system
- Full April project register loading across all stored project rows (not silently truncated to 200)
- Historical views driven by the bundled July 2025 → April 2026 database snapshots

## Run

Use the root `START_SENTINEL.bat` on Windows, or run backend and frontend separately using their READMEs.

For Windows, double-click the root `START_SENTINEL.bat`. It prepares the backend virtual environment, installs missing dependencies, starts both services, runs a smoke check, and opens the dashboard. The first launch needs internet access for dependency installation; later launches reuse the local runtime.

## Step 03 focus

The latest step makes marker selection useful, adds a project investigation signal rail, makes the project stage strip clickable, and preserves the originating surface when returning from project detail. See `docs\STEP_03_INVESTIGATION_FLOW.md`.

### Step 04 — Judge theatre / presentation route
Use **Demo path** in the top bar or press **D** to open the four-screen judging route: Overview → Map → Project → National Brief. The route reuses live loaded data and opens the selected project (or the first current watchlist project) without introducing a separate demo dataset.

### Step 06 — Executive readout / first-minute judge surface
The Overview now opens with an **Executive Readout** that separates four current-snapshot layers: attention, reported movement, commitment revisions, and assessment coverage. It uses only the loaded April 2026 data and stored history, and it links the attention layer directly to the watchlist. The readout explicitly distinguishes observed facts from derived assessment output.

Latest release: **Step 10 — Map Readability + Full Canvas Fix** (`10.0.0-step10`).

### Step 08 — live reliability layer
The top bar now exposes backend health and the most recent data-load time without blocking the interface. Project investigation displays an explicit dossier-loading state so live navigation never looks frozen. The release package is cleaned of Python cache/test artefacts and includes a repeatable judge startup/stop flow.

### Step 09 — full runtime / one-click startup
The project now has a visible root-level `START_SENTINEL.bat`. It prepares an isolated backend virtual environment, installs backend dependencies once, installs frontend dependencies once, starts the backend and Vite frontend on fixed localhost ports, waits for both health checks, runs an API smoke test against the bundled April 2026 database, and opens the dashboard. `STOP_SENTINEL.bat` is also provided at the root. If a service is already healthy, startup reuses it instead of creating a duplicate process.
### Step 10 — map readability / canvas fix
The national map no longer renders oversized state/district rectangles that stack on top of one another. At national and regional zoom levels, records are grouped by projected screen position into compact circular clusters; the tooltip exposes the underlying location context, and zooming separates the records. The full map also explicitly forces the Leaflet container to occupy the full available map surface so it cannot leave a white tail below the canvas.



## Step 12 map rewind
The Step 09 map presentation has been restored while keeping Step 11 dark Overview surfaces. Leaflet container sizing is hardened to eliminate blank space/white tails.
