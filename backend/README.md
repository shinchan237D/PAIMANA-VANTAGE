# PAIMANA Sentinel — April 2026 build

This build is intentionally **frozen as of April 2026**. The active snapshot is the April 2026 PAIMANA Flash Report; newer reports are not silently promoted into the assessment view.

## Backend

```powershell
cd backend
py -m pip install -r requirements.txt
py -m uvicorn app.api:app --host 127.0.0.1 --port 8000
```

Health: `http://127.0.0.1:8000/api/v3/health`

The bundled SQLite database contains the canonical monthly panel from July 2025 through April 2026, with April as the active snapshot. April–June 2025 legacy-layout reports are catalogued but intentionally not mixed into the canonical panel because their source table structure is materially different.

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

Then open `http://127.0.0.1:5173`.

Set `VITE_API_URL` if the backend runs elsewhere.

## Architecture

- Source registry + versioned report metadata
- Canonical project identity and monthly snapshots
- Deterministic integrity checks
- Required recovery-rate calculation
- Transparent attention state engine
- Historical comparable cohort service
- Evidence object separating observed / derived / integrity facts
- Map aggregates with explicit state-centroid location semantics
- Intervention workflow and audit log
- Structured Analyst endpoint (no arbitrary SQL / no hallucinated facts)
- CSV export
- Frozen-as-of contract so future reports cannot leak into the April assessment
