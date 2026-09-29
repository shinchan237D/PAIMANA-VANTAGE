# Step 09 — Full Runtime + One-Click Startup

## What changed
The previous release exposed startup helpers under `scripts/`, but the project did not present a clear root-level entry point. Step 09 fixes the release packaging and runtime flow.

## Start the whole system
From the unzipped project folder, double-click:

`START_SENTINEL.bat`

The launcher:

1. Checks Python, Node.js and npm.
2. Verifies the bundled SQLite database exists.
3. Creates `backend\\.venv` if needed.
4. Installs the pinned backend requirements only when FastAPI/Uvicorn are missing.
5. Installs frontend npm dependencies only when Vite is missing.
6. Starts the backend on `127.0.0.1:8000`.
7. Waits for `/api/v3/health` to report the April 2026 snapshot.
8. Starts the frontend on `127.0.0.1:5173`.
9. Waits for the frontend HTTP endpoint.
10. Runs `scripts\\SMOKE_TEST.py` against the real bundled database.
11. Opens the dashboard automatically.

If either service is already healthy, the launcher reuses it instead of creating a duplicate.

## Stop
Double-click the root `STOP_SENTINEL.bat` after the demo.

## Runtime compatibility
The backend requirements now pin Uvicorn 0.54.0 without the optional `standard` extra. The pinned release is listed by PyPI with Python 3.14 support. FastAPI 0.118.3 and Pydantic 2.12.5 also list Python 3.14 support. The launcher prefers Python 3.13/3.12/3.11 when present and otherwise falls back to the available `py` launcher.

## First-run requirement
The first launch needs internet access so `pip` and `npm` can fetch dependencies. After those dependencies are installed locally, subsequent launches do not reinstall them. The PAIMANA database and active April 2026 data are bundled locally.

## Smoke coverage
`SMOKE_TEST.py` checks health, metadata, source, portfolio, trends, month-to-month changes, paged project retrieval, map payload, integrity, engine audit, one real project dossier, timeline, evidence, comparables and CSV export. It also verifies the active report remains April 2026 and that the current snapshot contains 2,000+ projects.
