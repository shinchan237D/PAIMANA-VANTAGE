# Step 08 — Live Health + Dossier Loading Reliability

## Goal
Reduce live-demo ambiguity and make loading/connection state visible without turning the product into a technical admin screen.

## Changes
- Topbar system-health pill: checking / online / backend offline.
- Latest successful data-load time is shown when available.
- Health check runs independently every 60 seconds; it does not block portfolio loading.
- Project navigation now surfaces an explicit dossier-loading state while project, timeline, trajectory, comparables and evidence requests are resolving.
- Added `scripts/READY_CHECK.bat` for pre-demo machine validation.
- Startup script now checks Python/Node/npm prerequisites, warns about occupied ports, validates backend health before opening the browser, and fails clearly when frontend dependency installation fails.
- Release packaging excludes Python bytecode and pytest cache artefacts.

## Demo impact
A judge can see that the command centre is connected to the local Sentinel backend, while a project-opening request visibly transitions into a dossier-ready state instead of appearing to hang.

## Validation
- Backend pytest suite remains the release gate.
- Frontend TSX syntax is reviewed statically; a full Vite production build depends on installing the declared npm dependencies on the target machine.
