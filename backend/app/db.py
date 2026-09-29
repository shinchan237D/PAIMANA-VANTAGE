import sqlite3
from contextlib import contextmanager
from datetime import datetime
from .config import DB_PATH, ACTIVE_REPORT_PERIOD


def ensure_schema() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(DB_PATH))
    try:
        con.executescript('''
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY,
            project_code VARCHAR(64) NOT NULL UNIQUE,
            legacy_ocms_code VARCHAR(128), pmgid VARCHAR(128), identity_key VARCHAR(256),
            name TEXT NOT NULL, name_normalized VARCHAR(512), agency TEXT, ministry TEXT,
            sector TEXT, state TEXT, latitude FLOAT, longitude FLOAT,
            coordinates_source VARCHAR(128), location_status VARCHAR(32) NOT NULL DEFAULT 'unavailable',
            created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_aliases (
            id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, alias VARCHAR(256) NOT NULL,
            alias_type VARCHAR(64) NOT NULL, UNIQUE(alias, alias_type), FOREIGN KEY(project_id) REFERENCES projects(id)
        );
        CREATE TABLE IF NOT EXISTS source_releases (
            id INTEGER PRIMARY KEY, report_period VARCHAR(32) NOT NULL, title TEXT NOT NULL,
            report_url VARCHAR(2048) NOT NULL UNIQUE, published_at DATE, discovered_at DATETIME NOT NULL,
            status VARCHAR(64) NOT NULL, error_message TEXT, report_type VARCHAR(32), source_type VARCHAR(64),
            period_label VARCHAR(128), official_domain VARCHAR(255), source_hash VARCHAR(64)
        );
        CREATE TABLE IF NOT EXISTS source_documents (
            id INTEGER PRIMARY KEY, source_release_id INTEGER, source_url VARCHAR(2048) NOT NULL,
            local_path VARCHAR(2048), file_name VARCHAR(512), file_ext VARCHAR(32), file_sha256 VARCHAR(64),
            file_size_bytes INTEGER, content_type VARCHAR(255), parser_name VARCHAR(128), parser_version VARCHAR(64),
            parse_status VARCHAR(32) NOT NULL, parse_error TEXT, discovered_at DATETIME NOT NULL, downloaded_at DATETIME,
            FOREIGN KEY(source_release_id) REFERENCES source_releases(id)
        );
        CREATE TABLE IF NOT EXISTS source_snapshots (
            id INTEGER PRIMARY KEY, source_name VARCHAR(120) NOT NULL, report_period VARCHAR(7) NOT NULL,
            source_url VARCHAR(2048), local_path VARCHAR(2048), published_at DATE, reporting_cutoff DATE,
            file_sha256 VARCHAR(64) NOT NULL, parser_version VARCHAR(32) NOT NULL, row_count INTEGER NOT NULL,
            status VARCHAR(32) NOT NULL, metadata_json TEXT, ingested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS project_snapshots (
            id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, source_id INTEGER NOT NULL,
            report_period VARCHAR(7) NOT NULL, reporting_cutoff DATE, source_row_number INTEGER,
            approval_date DATE, original_start_date DATE, original_end_date DATE, revised_end_date DATE,
            original_cost_crore FLOAT, revised_cost_crore FLOAT, expenditure_crore FLOAT,
            physical_progress_pct FLOAT, raw_text TEXT, imported_at DATETIME NOT NULL,
            UNIQUE(project_id, report_period), FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(source_id) REFERENCES source_snapshots(id)
        );
        CREATE TABLE IF NOT EXISTS identity_resolution (
            id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, source_document_id INTEGER,
            source_project_identifier VARCHAR(256), identity_match_method VARCHAR(64) NOT NULL,
            identity_match_confidence REAL NOT NULL, source_row_number INTEGER, created_at DATETIME NOT NULL,
            UNIQUE(source_document_id, source_project_identifier)
        );
        CREATE TABLE IF NOT EXISTS integrity_flags (
            id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, snapshot_id INTEGER NOT NULL,
            rule_code VARCHAR(64) NOT NULL, severity VARCHAR(16) NOT NULL, message TEXT NOT NULL,
            created_at DATETIME NOT NULL, is_open BOOLEAN NOT NULL DEFAULT 1,
            UNIQUE(snapshot_id, rule_code)
        );
        CREATE TABLE IF NOT EXISTS interventions (
            id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL UNIQUE, status VARCHAR(32) NOT NULL,
            note TEXT, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
        );
        CREATE TABLE IF NOT EXISTS intervention_events (
            id INTEGER PRIMARY KEY, intervention_id INTEGER NOT NULL, from_status VARCHAR(32),
            to_status VARCHAR(32) NOT NULL, note TEXT, created_at DATETIME NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, object_type TEXT,
            object_id TEXT, payload_json TEXT, created_at DATETIME NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_runs (
            id INTEGER PRIMARY KEY, started_at DATETIME NOT NULL, finished_at DATETIME, status VARCHAR(32) NOT NULL,
            discovered INTEGER NOT NULL DEFAULT 0, ingested INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
            error_count INTEGER NOT NULL DEFAULT 0, message TEXT
        );
        CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, snapshot_id INTEGER NOT NULL,
            model_name VARCHAR(128) NOT NULL, model_version VARCHAR(128) NOT NULL, horizon_months INTEGER NOT NULL,
            breach_probability FLOAT, calibration_status VARCHAR(32) NOT NULL, required_monthly_progress_pct FLOAT,
            uncertainty_note TEXT, created_at DATETIME NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_snap_project_period ON project_snapshots(project_id, report_period);
        CREATE INDEX IF NOT EXISTS idx_snap_period_project ON project_snapshots(report_period, project_id);
        CREATE INDEX IF NOT EXISTS idx_project_state ON projects(state);
        CREATE INDEX IF NOT EXISTS idx_project_ministry ON projects(ministry);
        CREATE INDEX IF NOT EXISTS idx_project_sector ON projects(sector);
        CREATE INDEX IF NOT EXISTS idx_release_period ON source_releases(report_period);
        CREATE INDEX IF NOT EXISTS idx_integrity_open ON integrity_flags(is_open, severity);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
        ''')
        con.commit()
    finally:
        con.close()


@contextmanager
def db():
    ensure_schema()
    con = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    try:
        yield con
    finally:
        con.close()


def latest_period(con):
    row = con.execute('select 1 from project_snapshots where report_period=? limit 1', (ACTIVE_REPORT_PERIOD,)).fetchone()
    if row:
        return ACTIVE_REPORT_PERIOD
    row = con.execute('select max(report_period) p from project_snapshots where report_period<=?', (ACTIVE_REPORT_PERIOD,)).fetchone()
    return row['p'] if row and row['p'] else None


def latest_snapshot(con, project_id):
    period = latest_period(con)
    return con.execute('select * from project_snapshots where project_id=? and report_period=? limit 1', (project_id, period)).fetchone()


def project_by_code(con, code):
    return con.execute('select * from projects where project_code=? limit 1', (code,)).fetchone()
