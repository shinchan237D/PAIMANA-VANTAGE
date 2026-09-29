from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv('SENTINEL_DB', ROOT / 'data' / 'paimana_sentinel.db'))
RAW_PATH = Path(os.getenv('SENTINEL_RAW', ROOT / 'data' / 'raw'))
OFFICIAL_REPORTS_URL = os.getenv('PAIMANA_REPORTS_URL', 'https://www.mospi.gov.in/download-reports')
OFFICIAL_DASHBOARD_URL = os.getenv('PAIMANA_DASHBOARD_URL', 'https://paimana-proj.mospi.gov.in/')
# Demo/assessment mode is deliberately frozen at April 2026. Future reports may be
# discovered by the watcher, but they are never allowed to become the active snapshot.
ACTIVE_REPORT_PERIOD = os.getenv('SENTINEL_AS_OF', '2026-04')
SYNC_INTERVAL_MINUTES = int(os.getenv('SYNC_INTERVAL_MINUTES', '360'))
AUTO_SYNC = os.getenv('AUTO_SYNC', '1') == '1'
SYNC_ON_STARTUP = os.getenv('SYNC_ON_STARTUP', '1') == '1'
AUTO_BACKFILL_HISTORY = os.getenv('AUTO_BACKFILL_HISTORY', '0') == '1'
