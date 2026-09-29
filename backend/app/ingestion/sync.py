from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urljoin, urlparse, urlunparse

import httpx
from bs4 import BeautifulSoup

from ..config import DB_PATH, OFFICIAL_REPORTS_URL, OFFICIAL_DASHBOARD_URL
from ..db import ensure_schema
from .report_parser import parse_flash_report

REPORT_PAGE_URL = 'https://paimana-proj.mospi.gov.in/ReportPage'
IPMD_WHATS_NEW_URL = 'https://ipm.mospi.gov.in/WhatsNewViewMore/ViewMore'

MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
]
MONTHS = {m.lower(): i for i, m in enumerate(MONTH_NAMES, 1)}
MONTHS.update({m[:3].lower(): i for i, m in enumerate(MONTH_NAMES, 1)})
MONTH_RE = re.compile(
    r'\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*[-_/ ]?\s*(20\d{2})\b',
    re.I,
)
MONTH_FLEX_RE = re.compile(
    r'(?<![A-Za-z])(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?![A-Za-z])[^\d]{0,48}(20\d{2})\b',
    re.I,
)
ISO_PERIOD_RE = re.compile(r'\b(20\d{2})[-_/](0[1-9]|1[0-2])\b')
YEAR_RE = re.compile(r'\b(20(?:0\d|1\d|2\d))\b')
FLASH_RE = re.compile(r'\bmonthly\s+flash|\bflash\s+report|\bflash\b|project\s+monitoring', re.I)
QTR_RE = re.compile(r'quarter|qtr|q1|q2|q3|q4', re.I)
REVIEW_RE = re.compile(r'monthly\s+review|performance\s+monitor|review\s+report', re.I)
OFFICIAL_HOSTS = {'www.mospi.gov.in','mospi.gov.in','ipm.mospi.gov.in','paimana-proj.mospi.gov.in','uatipm.mospi.gov.in'}
EXTENSIONS = {'.pdf', '.ppt', '.pptx', '.xls', '.xlsx', '.csv', '.zip'}
MOSPI_REPORTS_BASE = 'https://www.mospi.gov.in/download-reports?combine=&m=&main_cat=All&publication_report_cat=All&sub_category=All&cat=All'
KNOWN_OFFICIAL_SEEDS = [
    'https://ipm.mospi.gov.in/Content/PDF/FlashReport_December_2025.pdf',
    'https://ipm.mospi.gov.in/Content/PDF/FlashReport_August_2025.pdf',
    'https://ipm.mospi.gov.in/Content/pdf/FlashReport_October_2025.pdf',
    'https://ipm.mospi.gov.in/Content/PDF/FlashReport_February_2026.pdf',
    'https://ipm.mospi.gov.in/ReportPage/ViewPdf?id=1315&path=Content%5CArchiveReport%5Cflash%5C2025-26%2FFlashReport_January_2026.pdf',
    'https://ipm.mospi.gov.in/Content/ArchiveReport/flash/2019-20/FR_may_Report_2019.pdf',
    'https://ipm.mospi.gov.in/Content/ArchiveReport/flash/2019-20/FR_jun_Report_2019.pdf',
    'https://ipm.mospi.gov.in/Content/PDF/FRDecember2024.pdf',
]


def _headers() -> dict[str, str]:
    return {
        'User-Agent': 'PAIMANA-Sentinel/3.1 (official-source-sync; historical-backfill)',
        'Accept': 'text/html,application/xhtml+xml,application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
    }


def _normalise_title(value: str) -> str:
    return ' '.join(value.replace('\xa0', ' ').split())


def infer_period(text: str, fallback_url: str = '') -> tuple[str | None, str | None]:
    probe = f'{text}\n{fallback_url}'
    m = MONTH_RE.search(probe) or MONTH_FLEX_RE.search(probe)
    if m:
        token = m.group(1).lower()
        return f'{m.group(2)}-{MONTHS[token]:02d}', m.group(0)
    m = ISO_PERIOD_RE.search(probe)
    if m:
        return f'{m.group(1)}-{m.group(2)}', m.group(0)
    y = YEAR_RE.search(probe)
    return (y.group(1), y.group(0)) if y else (None, None)

def infer_report_type(text: str, url: str) -> str:
    probe = f'{text} {url}'
    # Specific report types first so a review page mentioning project monitoring
    # is not misclassified as a flash report.
    if REVIEW_RE.search(probe):
        return 'review'
    if QTR_RE.search(probe):
        return 'quarterly'
    if FLASH_RE.search(probe):
        return 'flash'
    return 'other'


def _same_host(url: str, allowed: set[str]) -> bool:
    try:
        return urlparse(url).netloc in allowed
    except Exception:
        return False


def _fetch(url: str, timeout: float = 45.0) -> httpx.Response:
    r = httpx.get(url, headers=_headers(), follow_redirects=True, timeout=timeout)
    r.raise_for_status()
    return r


def _report_candidate(href: str, title: str, context: str) -> bool:
    probe = f'{title} {context} {href}'
    parsed = urlparse(href)
    path_query = (parsed.path + '?' + parsed.query).lower()
    extension = Path(parsed.path).suffix.lower()
    query_path = ' '.join(sum((v for v in parse_qs(parsed.query).values()), []))
    has_document = extension in EXTENSIONS or any(k in path_query for k in ('viewpdf', 'download', 'getpdf', 'getfile', 'downloadfile', '.pdf')) or any(Path(v).suffix.lower() in EXTENSIONS for v in parse_qs(parsed.query).get('path', []))
    if not has_document:
        return False
    return bool(FLASH_RE.search(probe) or QTR_RE.search(probe) or REVIEW_RE.search(probe) or FLASH_RE.search(query_path) or QTR_RE.search(query_path) or REVIEW_RE.search(query_path))


def _extract_links(page_url: str, html: str) -> list[dict]:
    soup = BeautifulSoup(html, 'html.parser')
    found: list[dict] = []
    for a in soup.find_all('a', href=True):
        href = urljoin(page_url, str(a['href']).strip())
        title = _normalise_title(' '.join(a.stripped_strings))
        parent_text = _normalise_title(' '.join(a.parent.stripped_strings)) if a.parent else ''
        grandparent_text = _normalise_title(' '.join(a.parent.parent.stripped_strings)) if a.parent and a.parent.parent else ''
        context = f'{title} {parent_text} {grandparent_text}'
        if not _report_candidate(href, title, context):
            continue
        period, period_label = infer_period(context, href)
        found.append({
            'url': href,
            'title': title or Path(urlparse(href).path).name,
            'context': context,
            'period': period,
            'period_label': period_label,
            'report_type': infer_report_type(context, href),
            'source_type': 'official_report_link',
            'official_domain': urlparse(href).netloc,
        })
    return found


def _with_page(url: str, page: int) -> str:
    parsed = urlparse(url)
    q = parse_qs(parsed.query, keep_blank_values=True)
    q['page'] = [str(page)]
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, urlencode(q, doseq=True), parsed.fragment))


def _pagination_max(html: str) -> int:
    values: list[int] = []
    for match in re.finditer(r'[?&]page=(\d+)', html, re.I):
        try:
            values.append(int(match.group(1)))
        except ValueError:
            pass
    # Some ASP.NET/DataTables surfaces expose paging controls without query params;
    # cap discovery to a conservative but generous ceiling below.
    return max(values or [1])


def _crawl_listing(page_url: str, page_kind: str, max_pages: int = 60) -> list[dict]:
    discovered: list[dict] = []
    try:
        r = _fetch(page_url)
    except Exception:
        return discovered
    discovered.extend(_extract_links(page_url, r.text))
    max_page = min(max(_pagination_max(r.text), 1), max_pages)
    # If the landing page didn't expose pagination, still check the first page explicitly.
    page_urls = [_with_page(page_url, n) for n in range(1, max_page + 1)]
    for candidate in page_urls:
        if candidate == page_url:
            continue
        try:
            rr = _fetch(candidate, timeout=40)
        except Exception:
            continue
        discovered.extend(_extract_links(candidate, rr.text))
        # Re-read pagination when later pages reveal a larger last page number.
        discovered_max = min(max(_pagination_max(rr.text), max_page), max_pages)
        max_page = max(max_page, discovered_max)
    # Second pass only if a later page revealed additional pagination beyond the first pass.
    if max_page > len(page_urls):
        for n in range(len(page_urls) + 1, max_page + 1):
            candidate = _with_page(page_url, n)
            try:
                rr = _fetch(candidate, timeout=40)
            except Exception:
                continue
            discovered.extend(_extract_links(candidate, rr.text))
    return discovered


def discover_official_links() -> list[dict]:
    """Discover official MoSPI/IPMD/PAIMANA project-monitoring releases across the archive."""
    discovered: dict[str, dict] = {}
    surfaces = [
        (MOSPI_REPORTS_BASE, 'mospi_download_reports'),
        (OFFICIAL_REPORTS_URL, 'configured_mospi_reports') if OFFICIAL_REPORTS_URL != MOSPI_REPORTS_BASE else None,
        (IPMD_WHATS_NEW_URL, 'ipm_whats_new'),
        (REPORT_PAGE_URL, 'paimana_report_page'),
        ('https://paimana-proj.mospi.gov.in/ReportPage/ReportPage', 'paimana_report_archive'),
        ('https://uatipm.mospi.gov.in/ReportPage/ReportPage', 'paimana_legacy_archive'),
        ('https://uatipm.mospi.gov.in/ReportPage', 'paimana_legacy_report_page'),
    ]
    for surface in surfaces:
        if not surface:
            continue
        url, kind = surface
        for item in _crawl_listing(url, kind, max_pages=60):
            if urlparse(item['url']).netloc in OFFICIAL_HOSTS:
                item['source_type'] = kind
                discovered[item['url']] = item

    # Add known official direct seeds as a safety net for archived paths that are only
    # revealed through client-side navigation or legacy routing. These are still downloaded
    # from official MoSPI/IPMD hosts and are deduplicated with the archive crawl.
    for url in KNOWN_OFFICIAL_SEEDS:
        if urlparse(url).netloc not in OFFICIAL_HOSTS:
            continue
        period, label = infer_period('', url)
        discovered[url] = {
            'url': url,
            'title': Path(urlparse(url).path).name or url,
            'context': url,
            'period': period,
            'period_label': label,
            'report_type': infer_report_type(url, url),
            'source_type': 'official_direct_seed',
            'official_domain': urlparse(url).netloc,
        }

    items = [x for x in discovered.values() if x.get('period') or x.get('report_type') in {'flash', 'quarterly'}]
    items.sort(key=lambda x: (x.get('period') or '0000-00', 1 if x.get('report_type') == 'flash' else 0, x['url']), reverse=True)
    return items

def _release_upsert(con: sqlite3.Connection, item: dict, status: str = 'discovered', error_message: str | None = None) -> int:
    period = item.get('period') or 'undated'
    now = datetime.utcnow().isoformat()
    row = con.execute('select id from source_releases where report_url=?', (item['url'],)).fetchone()
    if row:
        con.execute(
            """update source_releases
               set report_period=?,title=?,status=?,error_message=?,report_type=?,source_type=?,period_label=?,official_domain=?
               where id=?""",
            (period, item['title'], status, error_message, item.get('report_type'), item.get('source_type'), item.get('period_label'), item.get('official_domain'), row[0]),
        )
        return int(row[0])
    cur = con.execute(
        """insert into source_releases
           (report_period,title,report_url,published_at,discovered_at,status,error_message,report_type,source_type,period_label,official_domain)
           values(?,?,?,?,?,?,?,?,?,?,?)""",
        (period, item['title'], item['url'], None, now, status, error_message, item.get('report_type'), item.get('source_type'), item.get('period_label'), item.get('official_domain')),
    )
    return int(cur.lastrowid)


def inventory_official_sources() -> dict:
    ensure_schema()
    items = discover_official_links()
    con = sqlite3.connect(DB_PATH)
    try:
        for item in items:
            _release_upsert(con, item)
        con.commit()
        result = {
            'status': 'completed',
            'discovered': len(items),
            'new_or_updated': len(items),
            'official_surfaces': sorted({x['source_type'] for x in items}),
            'earliest_discovered_period': min((x['period'] for x in items if x.get('period')), default=None),
            'latest_discovered_period': max((x['period'] for x in items if x.get('period')), default=None),
        }
        manifest_path = Path(DB_PATH).resolve().parent / 'official_source_inventory.json'
        manifest_path.write_text(json.dumps({
            **result,
            'generated_at': datetime.utcnow().isoformat() + 'Z',
            'items': items,
        }, indent=2, ensure_ascii=False), encoding='utf-8')
        return result
    finally:
        con.close()


def download(url: str, path: Path) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    with httpx.stream('GET', url, headers=_headers(), follow_redirects=True, timeout=120) as r:
        r.raise_for_status()
        with path.open('wb') as f:
            total = 0
            for chunk in r.iter_bytes(1024 * 1024):
                f.write(chunk)
                total += len(chunk)
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    return {'sha256': sha, 'size': path.stat().st_size, 'content_type': r.headers.get('content-type')}


def _normalise_name(name: str | None) -> str:
    if not name:
        return ''
    value = name.upper()
    value = value.replace('&', ' AND ')
    value = re.sub(r'[-_/.,:;()\[\]{}]+', ' ', value)
    value = re.sub(r'\s+', ' ', value).strip()
    return value


def _resolve_project(con: sqlite3.Connection, row, source_document_id: int | None, source_row_number: int) -> tuple[int, str, float]:
    """Resolve a historical row to a stable project identity.

    Deterministic order: code -> legacy -> PMGID -> name+state+ministry.
    Conservative name matching avoids merging merely similar project names.
    """
    checks = [
        ('project_code', row.project_code),
        ('legacy_ocms_code', row.legacy_ocms_code),
        ('pmgid', row.pmgid),
    ]
    for field, value in checks:
        if not value or value in {'-', '--'}:
            continue
        existing = con.execute(f'select id from projects where {field}=? limit 1', (value,)).fetchone()
        if existing:
            return int(existing[0]), field, 1.0

    normalized = _normalise_name(row.name)
    candidates = con.execute(
        "select id,name, name_normalized,state,ministry from projects where state is ? or state=? limit 2000",
        (row.state, row.state),
    ).fetchall()
    for candidate in candidates:
        cn = candidate['name_normalized'] or _normalise_name(candidate['name'])
        if normalized and cn == normalized:
            ministry_match = bool(row.ministry and candidate['ministry'] and row.ministry == candidate['ministry'])
            confidence = 0.96 if ministry_match else 0.91
            return int(candidate['id']), 'normalized_name_state_ministry' if ministry_match else 'normalized_name_state', confidence

    # New project identity.
    lat = lon = None
    now = datetime.utcnow().isoformat()
    con.execute(
        """insert into projects(project_code,legacy_ocms_code,pmgid,identity_key,name,name_normalized,agency,ministry,sector,state,latitude,longitude,coordinates_source,location_status,created_at,updated_at)
           values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (row.project_code, row.legacy_ocms_code, row.pmgid, row.project_code, row.name, normalized, row.agency, row.ministry, row.sector, row.state, lat, lon, None, 'unavailable', now, now),
    )
    pid = int(con.execute('select last_insert_rowid()').fetchone()[0])
    # Alias every known source identifier.
    for alias, alias_type in [(row.project_code, 'project_code'), (row.legacy_ocms_code, 'legacy_ocms_code'), (row.pmgid, 'pmgid')]:
        if alias and alias not in {'-', '--'}:
            con.execute('insert or ignore into project_aliases(project_id,alias,alias_type) values(?,?,?)', (pid, alias, alias_type))
    return pid, 'new_project_identity', 1.0


def _record_document(con: sqlite3.Connection, release_id: int, item: dict, local_path: Path, download_meta: dict, parser_name: str | None, parser_version: str | None, parse_status: str, parse_error: str | None = None) -> int:
    sha = download_meta.get('sha256')
    existing = con.execute('select id from source_documents where file_sha256=? limit 1', (sha,)).fetchone() if sha else None
    if existing:
        return int(existing[0])
    now = datetime.utcnow().isoformat()
    con.execute(
        """insert into source_documents
           (source_release_id,source_url,local_path,file_name,file_ext,file_sha256,file_size_bytes,content_type,parser_name,parser_version,parse_status,parse_error,discovered_at,downloaded_at)
           values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (release_id, item['url'], str(local_path), local_path.name, local_path.suffix.lower(), sha, download_meta.get('size'), download_meta.get('content_type'), parser_name, parser_version, parse_status, parse_error, now, now),
    )
    return int(con.execute('select last_insert_rowid()').fetchone()[0])


def _ingest_pdf(con: sqlite3.Connection, item: dict, release_id: int, local_path: Path, download_meta: dict) -> tuple[bool, int, int, str]:
    try:
        meta, rows = parse_flash_report(local_path, report_period=(item.get('period') if re.fullmatch(r'20\d{2}-\d{2}', str(item.get('period') or '')) else None))
    except Exception as exc:
        did = _record_document(con, release_id, item, local_path, download_meta, 'parse_flash_report', '3.0.0', 'failed', str(exc))
        con.execute('update source_releases set status=?, error_message=? where id=?', ('downloaded_unparsed', str(exc), release_id))
        return False, 0, 0, 'failed'
    did = _record_document(con, release_id, item, local_path, download_meta, 'parse_flash_report', '2.2.0', 'parsed' if rows else 'empty')
    con.execute('update source_releases set source_hash=? where id=?', (download_meta.get('sha256'), release_id))
    source_row = con.execute('select id from source_snapshots where file_sha256=? limit 1', (download_meta['sha256'],)).fetchone()
    if source_row:
        return False, int(source_row[0]), len(rows), 'already_ingested'

    period = meta['report_period']
    cutoff = meta.get('reporting_cutoff')
    con.execute(
        """insert into source_snapshots(source_name,report_period,source_url,local_path,published_at,reporting_cutoff,file_sha256,parser_version,row_count,status,metadata_json)
           values(?,?,?,?,?,?,?,?,?,?,?)""",
        (item['title'][:120] or 'PAIMANA report', period, item['url'], str(local_path), None, cutoff, download_meta['sha256'], meta.get('parser_version', '3.0.0'), len(rows), 'ingested', json.dumps({'source_type': item.get('source_type'), 'report_type': item.get('report_type'), 'source_document_id': did})),
    )
    source_id = int(con.execute('select last_insert_rowid()').fetchone()[0])
    for idx, row in enumerate(rows, 1):
        pid, method, confidence = _resolve_project(con, row, did, idx)
        # Update project metadata with newly observed non-null identity fields.
        con.execute(
            """update projects set legacy_ocms_code=coalesce(legacy_ocms_code, ?), pmgid=coalesce(pmgid, ?),
               agency=coalesce(agency, ?), ministry=coalesce(ministry, ?), sector=coalesce(sector, ?),
               state=coalesce(state, ?), updated_at=? where id=?""",
            (row.legacy_ocms_code, row.pmgid, row.agency, row.ministry, row.sector, row.state, datetime.utcnow().isoformat(), pid),
        )
        con.execute(
            """insert or replace into project_snapshots
               (project_id,source_id,report_period,reporting_cutoff,source_row_number,approval_date,original_start_date,original_end_date,revised_end_date,original_cost_crore,revised_cost_crore,expenditure_crore,physical_progress_pct,raw_text,imported_at)
               values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (pid, source_id, period, cutoff, idx, row.approval_date, row.original_start_date, row.original_end_date, row.revised_end_date, row.original_cost_crore, row.revised_cost_crore, row.expenditure_crore, row.physical_progress_pct, row.raw_text, datetime.utcnow().isoformat()),
        )
        con.execute(
            """insert or replace into identity_resolution
               (project_id,source_document_id,source_project_identifier,identity_match_method,identity_match_confidence,source_row_number,created_at)
               values(?,?,?,?,?,?,?)""",
            (pid, did, row.project_code, method, confidence, idx, datetime.utcnow().isoformat()),
        )
    con.execute('update source_releases set status=?,error_message=? where id=?', ('ingested', None, release_id))
    return True, source_id, len(rows), 'ingested'


def _safe_filename(item: dict) -> str:
    stem = re.sub(r'[^A-Za-z0-9._-]+', '_', item.get('title') or Path(urlparse(item['url']).path).name or 'source')
    ext = Path(urlparse(item['url']).path).suffix.lower() or '.bin'
    if not stem.lower().endswith(ext):
        stem += ext
    return stem[:180]


def backfill_all(max_documents: int | None = None) -> dict:
    ensure_schema()
    started = datetime.utcnow().isoformat()
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    run_id = con.execute(
        'insert into sync_runs(started_at,status,discovered,ingested,skipped,error_count,message) values(?,?,?,?,?,?,?)',
        (started, 'running', 0, 0, 0, 0, 'Historical official-source backfill started.'),
    ).lastrowid
    con.commit()

    try:
        items = discover_official_links()
        if max_documents is not None:
            items = items[:max_documents]
        con.execute('update sync_runs set discovered=? where id=?', (len(items), run_id))
        con.commit()
        # Persist the exact discovered official release inventory before any download so
        # the run is auditable even if the network or a parser fails part-way through.
        manifest_path = Path(DB_PATH).resolve().parent / 'official_source_inventory.json'
        manifest_path.write_text(json.dumps({
            'generated_at': datetime.utcnow().isoformat() + 'Z',
            'discovered': len(items),
            'items': items,
        }, indent=2, ensure_ascii=False), encoding='utf-8')
        ingest_count = skip_count = error_count = 0
        errors: list[str] = []
        for item in items:
            release_id = _release_upsert(con, item, 'discovered')
            con.commit()
            try:
                # Source inventory includes reviews and other official releases, but only
                # project-monitoring Flash/QTR documents are downloaded into the project
                # snapshot pipeline. This keeps the backfill focused and avoids pulling
                # unrelated performance-review PDFs.
                if item.get('report_type') not in {'flash','quarterly'}:
                    skip_count += 1
                    con.execute('update source_releases set status=?,error_message=? where id=?', ('catalogued', 'Official release inventoried; no project-row parser required for this report type.', release_id))
                    con.commit()
                    continue
                local_dir = Path(DB_PATH).resolve().parent / 'raw' / 'historical' / (re.sub(r'[^0-9A-Za-z_-]+', '_', str(item.get('period') or 'undated')))
                local_path = local_dir / _safe_filename(item)
                existing_doc = con.execute('select file_sha256,parse_status from source_documents where source_url=? order by id desc limit 1', (item['url'],)).fetchone()
                if local_path.exists() and existing_doc and existing_doc['file_sha256']:
                    meta = {'sha256': existing_doc['file_sha256'], 'size': local_path.stat().st_size, 'content_type': None}
                else:
                    meta = download(item['url'], local_path)
                ext = local_path.suffix.lower()
                if ext in {'.pdf', '.ppt', '.pptx', '.xlsx', '.csv'}:
                    changed, _, _, status = _ingest_pdf(con, item, release_id, local_path, meta)
                    if changed:
                        ingest_count += 1
                    else:
                        skip_count += 1
                    if status == 'failed':
                        error_count += 1
                        errors.append(f"{item['url']}: parser failure")
                else:
                    reason='No parser registered for this official project-monitoring document type.'
                    _record_document(con, release_id, item, local_path, meta, None, None, 'downloaded_unparsed', reason)
                    con.execute('update source_releases set status=?, error_message=?, source_hash=? where id=?', ('downloaded_unparsed', reason, meta.get('sha256'), release_id))
                    skip_count += 1
            except Exception as exc:
                error_count += 1
                errors.append(f"{item['url']}: {exc}")
                con.execute('update source_releases set status=?, error_message=? where id=?', ('error', str(exc), release_id))
            con.commit()

        status = 'completed_with_errors' if errors else 'completed'
        finished = datetime.utcnow().isoformat()
        msg = f'Historical backfill: {ingest_count} parsed/ingested, {skip_count} unchanged or unparsed, {error_count} errors.'
        con.execute('update sync_runs set finished_at=?,status=?,ingested=?,skipped=?,error_count=?,message=? where id=?', (finished, status, ingest_count, skip_count, error_count, msg, run_id))
        con.commit()
        status_path = Path(DB_PATH).resolve().parent / 'history_backfill_status.json'
        status_path.write_text(json.dumps({
            'status': status, 'run_id': int(run_id), 'discovered': len(items),
            'ingested': ingest_count, 'skipped': skip_count, 'errors': errors,
            'started_at': started, 'finished_at': finished,
        }, indent=2), encoding='utf-8')
        return {'status': status, 'run_id': int(run_id), 'discovered': len(items), 'ingested': ingest_count, 'skipped': skip_count, 'errors': errors, 'started_at': started, 'finished_at': finished}
    except Exception as exc:
        con.execute('update sync_runs set finished_at=?,status=?,error_count=?,message=? where id=?', (datetime.utcnow().isoformat(), 'error', 1, str(exc), run_id))
        con.commit()
        return {'status': 'error', 'run_id': int(run_id), 'discovered': 0, 'ingested': 0, 'skipped': 0, 'errors': [str(exc)]}
    finally:
        con.close()


def sync_latest(max_reports: int = 6) -> dict:
    """Refresh the newest official report(s) without deleting history.

    ``max_reports`` limits the *check surface* for routine refresh only. Use
    ``backfill_all`` for a complete historical discovery/backfill.
    """
    ensure_schema()
    items = [x for x in discover_official_links() if x.get('report_type') == 'flash'][:max_reports]
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        ingested = skipped = 0
        errors: list[str] = []
        for item in items:
            release_id = _release_upsert(con, item, 'discovered')
            try:
                local_dir = Path(DB_PATH).resolve().parent / 'raw' / 'official_refresh'
                local_path = local_dir / _safe_filename(item)
                meta = download(item['url'], local_path)
                if local_path.suffix.lower() in {'.pdf', '.ppt', '.pptx', '.xlsx', '.csv'}:
                    changed, _, _, status = _ingest_pdf(con, item, release_id, local_path, meta)
                    if changed: ingested += 1
                    else: skipped += 1
                    if status == 'failed':
                        errors.append(f"{item['url']}: parser failure")
                else:
                    skipped += 1
            except Exception as exc:
                errors.append(f"{item['url']}: {exc}")
            con.commit()
        status = 'completed_with_errors' if errors else 'completed'
        return {'status': status, 'discovered': len(items), 'ingested': ingested, 'skipped': skipped, 'errors': errors, 'latest': max((x.get('period') or '' for x in items), default=None)}
    except Exception as exc:
        return {'status': 'source_unreachable', 'discovered': 0, 'ingested': 0, 'skipped': 0, 'errors': [str(exc)], 'latest': None}
    finally:
        con.close()


def source_inventory() -> list[dict]:
    ensure_schema()
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in con.execute('''select id,report_period,title,report_url,published_at,discovered_at,status,error_message,report_type,source_type,period_label,official_domain from source_releases order by report_period desc, id desc''').fetchall()]
    finally:
        con.close()
