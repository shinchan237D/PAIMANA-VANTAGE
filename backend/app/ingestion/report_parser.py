from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import pdfplumber

PARSER_VERSION = "2.2.0"
MONTH_NAMES = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"
]
MONTHS = {m: i for i, m in enumerate(MONTH_NAMES, 1)}
MONTHS.update({m[:3]: i for i, m in enumerate(MONTH_NAMES, 1)})
DATE_RE = re.compile(r"(?<![A-Za-z0-9])((?:0?[1-9])|(?:1[0-2]))[-/](20\d{2})(?!\d)")
TEXT_DATE_RE = re.compile(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[- /]((?:20)?\d{2})\b", re.I)
CODE_RE = re.compile(r"(?<![A-Za-z0-9])([A-Z]{0,3}\d{5,10})(?![A-Za-z0-9])", re.I)
ROW_RE = re.compile(r"^\s*(\d{1,5})\s*(?:[|.)-]|\s)\s*(.*?)\s*$")
STATES = [
    "Andaman and Nicobar Islands", "Arunachal Pradesh", "Andhra Pradesh", "Dadra and Nagar Haveli and Daman and Diu",
    "Jammu and Kashmir", "Himachal Pradesh", "Madhya Pradesh", "Tamil Nadu", "Uttar Pradesh", "Uttarakhand",
    "West Bengal", "Chhattisgarh", "Jharkhand", "Maharashtra", "Rajasthan", "Telangana", "Karnataka", "Kerala",
    "Gujarat", "Haryana", "Punjab", "Bihar", "Odisha", "Assam", "Goa", "Sikkim", "Tripura", "Meghalaya",
    "Manipur", "Mizoram", "Nagaland", "Puducherry", "Lakshadweep", "Ladakh", "Delhi", "Chandigarh",
    "Daman and Diu", "Dadra and Nagar Haveli", "PAN India", "Offshore",
]


@dataclass(frozen=True)
class ParsedProject:
    project_code: str
    legacy_ocms_code: str | None
    pmgid: str | None
    name: str
    agency: str | None
    ministry: str | None
    sector: str | None
    state: str | None
    approval_date: date | None
    original_start_date: date | None
    original_end_date: date | None
    revised_end_date: date | None
    original_cost_crore: float | None
    revised_cost_crore: float | None
    expenditure_crore: float | None
    physical_progress_pct: float | None
    raw_text: str


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".pptx"}:
        from pptx import Presentation
        prs = Presentation(str(path))
        pages = []
        for slide in prs.slides:
            lines = []
            for shape in slide.shapes:
                if getattr(shape, "has_table", False):
                    for row in shape.table.rows:
                        lines.append(" ".join((cell.text or "").replace("\n", " ").strip() for cell in row.cells))
                elif hasattr(shape, "text") and shape.text:
                    lines.extend(x for x in shape.text.splitlines() if x.strip())
            pages.append("\n".join(lines))
        return "\f".join(pages)
    if suffix == ".ppt":
        soffice = shutil.which("libreoffice") or shutil.which("soffice")
        if not soffice:
            raise RuntimeError("Legacy .ppt parsing requires LibreOffice/soffice")
        with tempfile.TemporaryDirectory() as td:
            outdir = Path(td)
            subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir", str(outdir), str(path)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            pdf_path = outdir / f"{path.stem}.pdf"
            if not pdf_path.exists():
                raise RuntimeError("Legacy .ppt conversion did not produce a PDF")
            return extract_text(pdf_path)
    if suffix in {".xlsx", ".xls", ".csv"}:
        # Preserve the raw tabular text so the report parser can attempt its
        # normal identifier/metric recognizers. A specialized table parser can
        # be added later for formats whose schema differs materially.
        if suffix == ".xlsx":
            from openpyxl import load_workbook
            wb = load_workbook(path, read_only=True, data_only=True)
            try:
                sheets = []
                for ws in wb.worksheets:
                    rows=[]
                    for values in ws.iter_rows(values_only=True):
                        rows.append(" ".join("" if v is None else str(v) for v in values))
                    sheets.append("\n".join(rows))
                return "\f".join(sheets)
            finally:
                wb.close()
        if suffix == ".csv":
            return path.read_text(errors="ignore")
        raise RuntimeError(".xls legacy workbook is not parsed by the current build")

    poppler = shutil.which("pdftotext")
    if poppler:
        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as tmp:
            target = Path(tmp.name)
        try:
            subprocess.run([poppler, "-layout", str(path), str(target)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return target.read_text(errors="ignore")
        finally:
            target.unlink(missing_ok=True)
    chunks = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            chunks.append(page.extract_text(layout=True, x_tolerance=1, y_tolerance=3) or "")
    return "\n".join(chunks)


def infer_report_period(text: str, filename: str | None = None) -> str:
    probe = "\n".join([text[:12000], filename or ""])
    m = re.search(r"(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[-_ /]?(20\d{2})", probe, re.I)
    if not m:
        raise ValueError("Cannot infer report period")
    token = m.group(1).upper()
    return f"{m.group(2)}-{MONTHS[token]:02d}"


def infer_reporting_cutoff(text: str) -> date | None:
    match = re.search(r"latest by\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(20\d{2})", text, re.I)
    if not match or match.group(2).upper() not in MONTHS:
        return None
    return date(int(match.group(3)), MONTHS[match.group(2).upper()], int(match.group(1)))


def _normalise(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip()


def _state_from_line(line: str) -> str | None:
    normalized = _normalise(line)
    lower = normalized.lower()
    for state in sorted(STATES, key=len, reverse=True):
        if state.lower() in lower:
            return state
    return None


def _numbers(line: str) -> list[float]:
    out = []
    for token in re.findall(r"(?<![A-Za-z])-?\d[\d,]*(?:\.\d+)?", line):
        try:
            out.append(float(token.replace(",", "")))
        except ValueError:
            pass
    return out


def _date_values(line: str) -> list[date]:
    values = [date(int(y), int(m), 1) for m, y in DATE_RE.findall(line)]
    for m, y in TEXT_DATE_RE.findall(line):
        yy = int(y)
        year = yy if yy >= 100 else 2000 + yy
        values.append(date(year, MONTHS[m.upper()], 1))
    return sorted(set(values))


def _paren_numeric(line: str) -> list[float]:
    values = []
    for token in re.findall(r"\(([^()]*)\)", line):
        token = token.strip()
        if re.fullmatch(r"-?\d[\d,]*(?:\.\d+)?", token) and len(token.replace(",", "").split(".")[0]) < 8:
            values.append(float(token.replace(",", "")))
    return values


def _is_boundary(line: str) -> bool:
    s = _normalise(line)
    return (not s) or s in {"(-) (-)", "(-) (-) (-)", "(-)"} or bool(CODE_RE.search(s))


def _project_name(pre: list[str]) -> str:
    """Extract the current project title from lines before its row."""
    if not pre:
        return "Unnamed project"
    # First anchor on the current project's original metadata line.
    anchor = None
    for i in range(len(pre) - 1, -1, -1):
        if len(_date_values(pre[i])) >= 1 and _numbers(pre[i]):
            anchor = i
            break
    # Some records have no dates at all (e.g. NA / 01/1900 or blank date fields). In those
    # cases the agency line is the best structural anchor.
    if anchor is None:
        for i in range(len(pre) - 1, -1, -1):
            s = _normalise(pre[i])
            if re.search(r"\([^()]*[A-Za-z][^()]*\)", s) and not re.fullmatch(r".*\(\d{3,6}\).*", s):
                anchor = i
                break
    if anchor is None:
        return "Unnamed project"

    candidates = []
    for line in reversed(pre[:anchor]):
        s = _normalise(line)
        if _is_boundary(s) or len(_date_values(s)) >= 1:
            break
        if re.fullmatch(r"\([^)]*\)\s*\([^)]*\)", s):
            break
        if s.startswith("Ministry of ") or s.startswith("Ministry for "):
            break
        if re.fullmatch(r"[\d\s().-]+", s):
            continue
        candidates.append(s)
        if len(candidates) >= 10:
            break
    name = _normalise(" ".join(reversed(candidates)))
    return name or "Unnamed project"


def _agency(original_line: str) -> str | None:
    first_date = DATE_RE.search(original_line)
    probe = original_line[:first_date.start()] if first_date else original_line
    candidates = [x.strip() for x in re.findall(r"\(([^()]*)\)", probe)]
    for value in candidates:
        if value in {"-", "--"} or re.fullmatch(r"\d+", value):
            continue
        if any(ch.isalpha() for ch in value):
            return _normalise(value)
    return None


def _identifiers(after: list[str]) -> tuple[str | None, str | None]:
    seen_revision = False
    for line in after[:6]:
        if _date_values(line):
            seen_revision = True
            continue
        if not seen_revision:
            continue
        vals = [v.strip() for v in re.findall(r"\(([^()]*)\)", line)]
        meaningful = [v for v in vals if v not in {"-", "--"} and not re.fullmatch(r"\d{5,6}", v)]
        if not vals:
            continue
        if vals and all(v in {"-", "--"} for v in vals):
            return None, None
        legacy = next((v for v in meaningful if re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]+", v)), None)
        pmgid = next((v for v in meaningful if re.fullmatch(r"\d{3,}", v)), None)
        return legacy, pmgid
    return None, None


def _parse_row_line(line: str) -> tuple[str | None, float | None, float | None]:
    state = _state_from_line(line)
    nums = _numbers(line)
    if state and len(nums) >= 2:
        return state, nums[-2], nums[-1]
    return state, (nums[-2] if len(nums) >= 2 else None), (nums[-1] if nums else None)


def _original_meta(pre: list[str]) -> tuple[date | None, date | None, float | None, str | None]:
    target = None
    for line in reversed(pre):
        ds = _date_values(line)
        nums = _numbers(line)
        if len(ds) >= 2 and nums:
            target = line
            break
    if not target:
        return None, None, None, None
    ds = _date_values(target)
    nums = _numbers(target)
    if len(ds) >= 2:
        return ds[0], ds[1], nums[-1] if nums else None, _agency(target)
    return None, ds[0], nums[-1] if nums else None, _agency(target)


def _revised_meta(code_line: str, after: list[str]) -> tuple[date | None, date | None, float | None]:
    """Read current start/revised DoC/revised cost.

    Depending on the PDF wrapping, the project-code line may also contain the revised metadata;
    otherwise the next line carries it.
    """
    candidates = [code_line] + after[:5]
    for line in candidates:
        ds = _date_values(line)
        if not ds:
            continue
        start_date = ds[0]
        revised_end = ds[1] if len(ds) >= 2 else None
        paren_costs = _paren_numeric(line)
        revised_cost = paren_costs[-1] if paren_costs else None
        return start_date, revised_end, revised_cost
    return None, None, None


def _find_row_starts(lines: list[str]) -> list[int]:
    starts = []
    for i, line in enumerate(lines):
        if not re.match(r"^\s*\d{1,5}\s*(?:[|.)-]|\s)", line):
            continue
        joined = "\n".join(lines[i:min(len(lines), i + 5)])
        if CODE_RE.search(joined):
            starts.append(i)
    return starts


def _code_for_row(lines: list[str], row_start: int, row_end: int) -> str | None:
    for i in range(row_start, min(row_end, row_start + 5)):
        match = CODE_RE.search(lines[i])
        if match:
            token = match.group(1).upper()
            # Ignore bare year-like numeric tokens; require either a letter prefix or at least 5 digits.
            if any(ch.isalpha() for ch in token) or len(re.sub(r"\D", "", token)) >= 5:
                return token
    return None

def _row_metrics(lines: list[str], row_start: int, has_progress_column: bool) -> tuple[str | None, float | None, float | None]:
    # State can be on the row line or on the line immediately after it.
    for i in range(row_start, min(len(lines), row_start + 3)):
        state = _state_from_line(lines[i])
        nums = _numbers(lines[i])
        if not nums:
            continue
        if has_progress_column and len(nums) >= 2:
            progress = nums[-1]
            expenditure = nums[-2]
            if -0.01 <= progress <= 100.0:
                return state, expenditure, progress
            return state, None, None
        # Historical layouts without an explicit physical-progress column are intentionally
        # conservative: do not guess expenditure/progress from unrelated year/date fields.
        return state, None, None
    return None, None, None


def _name_from_row_block(lines: list[str], row_start: int, row_end: int) -> str | None:
    """Extract an inline project name from archived table layouts where the name/code share a row."""
    for line in lines[row_start:min(row_end, row_start + 5)]:
        if not CODE_RE.search(line):
            continue
        candidate = re.sub(r"^\s*\d{1,5}\s*(?:[|.)-]\s*)?", "", _normalise(line))
        candidate = re.split(r"\[?" + re.escape(CODE_RE.search(line).group(1)) + r"\]?", candidate, flags=re.I)[0]
        candidate = re.sub(r"\s*\[[^\]]*\]\s*$", "", candidate)
        candidate = re.sub(r"\s*\([^)]*\)\s*$", "", candidate)
        candidate = re.sub(r"\s*[-:|]+\s*$", "", candidate).strip()
        # Drop a leading serial/pipe artefact and reject obvious metadata-only strings.
        candidate = re.sub(r"^\|\s*", "", candidate)
        if len(candidate) >= 4 and not re.fullmatch(r"[\d\s./-]+", candidate):
            return candidate
    return None


def _inline_meta(lines: list[str], row_start: int, row_end: int, has_progress_column: bool):
    """Conservatively parse common archived single-row/table-block formats.

    This path is used only as a fallback. It extracts obvious date/cost/progress tokens and
    never turns unrelated year/date numbers into physical progress.
    """
    block = " ".join(_normalise(x) for x in lines[row_start:min(row_end, row_start + 6)])
    dates = _date_values(block)
    # Decimal-valued tokens are a better cost/expenditure discriminator than generic integers,
    # because month/year and serial fields are integers in old reports.
    decimals = []
    for token in re.findall(r"(?<![A-Za-z0-9])-?\d[\d,]*\.\d+", block):
        try:
            decimals.append(float(token.replace(',', '')))
        except ValueError:
            pass
    original_cost = decimals[0] if decimals else None
    revised_cost = decimals[1] if len(decimals) >= 2 else original_cost
    expenditure = decimals[2] if has_progress_column and len(decimals) >= 3 else None
    progress = None
    if has_progress_column:
        # Prefer a value adjacent to a percent sign/physical-progress wording.
        m = re.search(r"(?:physical\s+progress[^\d]{0,15}|progress\s*\(%\)[^\d]{0,15})(\d{1,3}(?:\.\d+)?)", block, re.I)
        if m:
            v=float(m.group(1))
            if 0 <= v <= 100: progress=v
        if progress is None:
            ints=[float(x) for x in re.findall(r"(?<![A-Za-z0-9])\d{1,3}(?:\.\d+)?(?![A-Za-z0-9])", block) if 0 <= float(x) <= 100]
            # Use the final plausible percentage only when an explicit progress column exists.
            if ints:
                progress=ints[-1]
    approval = dates[0] if dates else None
    original_end = dates[1] if len(dates) >= 2 else None
    revised_end = dates[2] if len(dates) >= 3 else original_end
    return approval, original_end, revised_end, original_cost, revised_cost, expenditure, progress


def parse_flash_report(path: str | Path, report_period: str | None = None) -> tuple[dict, list[ParsedProject]]:
    path = Path(path)
    text = extract_text(path)
    report_period = report_period or infer_report_period(text, path.name)
    reporting_cutoff = infer_reporting_cutoff(text)
    results: list[ParsedProject] = []
    seen: set[str] = set()
    parsed_pages = 0
    current_ministry = None
    current_sector = None

    def parse_one(lines, row_start, row_end, code):
        nonlocal current_ministry, current_sector
        prev_start = max(0, row_start - 18)
        pre = lines[prev_start:row_start]
        post = lines[row_start + 1:row_end]
        approval, original_end, original_cost, agency = _original_meta(pre)
        revised_start, revised_end, revised_cost = _revised_meta(lines[row_start], post)
        legacy, pmgid = _identifiers(post)
        name = _project_name(pre)
        state, expenditure, progress = _row_metrics(lines, row_start, has_progress_column)
        inline_name = _name_from_row_block(lines, row_start, row_end)
        if inline_name and (not name or name == 'Unnamed project' or len(name) < 4):
            name = inline_name
        inline = _inline_meta(lines, row_start, row_end, has_progress_column)
        if approval is None: approval = inline[0]
        if original_end is None: original_end = inline[1]
        if revised_end is None: revised_end = inline[2]
        if original_cost is None: original_cost = inline[3]
        if revised_cost is None: revised_cost = inline[4]
        if expenditure is None: expenditure = inline[5]
        if progress is None: progress = inline[6]
        for line in pre:
            normalized = _normalise(line)
            if normalized.startswith("Ministry of ") or normalized.startswith("Ministry for "):
                current_ministry = normalized
            elif normalized and len(normalized) < 100 and not re.search(r"\d", normalized):
                lower = normalized.lower()
                if any(k in lower for k in [
                    "coal", "steel", "roads", "railway", "ports", "power", "aviation", "petroleum",
                    "telecommunication", "construction", "health", "water", "education",
                ]):
                    current_sector = normalized
        return ParsedProject(
            project_code=code,
            legacy_ocms_code=legacy,
            pmgid=pmgid,
            name=name,
            agency=agency,
            ministry=current_ministry,
            sector=current_sector,
            state=state,
            approval_date=approval,
            original_start_date=revised_start or approval,
            original_end_date=original_end,
            revised_end_date=revised_end,
            original_cost_crore=original_cost,
            revised_cost_crore=revised_cost if revised_cost is not None else original_cost,
            expenditure_crore=expenditure,
            physical_progress_pct=progress,
            raw_text="\n".join(pre + lines[row_start:min(row_end, row_start + 8)]),
        )

    for page in text.split("\f"):
        lower_page = page.lower()
        # Accept current and archived report layouts as long as they clearly identify an
        # ongoing-project table and contain project identifiers. Physical progress is optional
        # for older layouts; when absent it is left missing rather than guessed.
        if "all ongoing projects" not in lower_page and "project list: ongoing projects" not in lower_page:
            continue
        if not CODE_RE.search(page):
            continue
        parsed_pages += 1
        lines = page.splitlines()
        has_progress_column = "physical progress" in lower_page or "progress (%)" in lower_page
        starts = _find_row_starts(lines)
        # Main pass: rows that clearly start with the serial number and contain the project code nearby.
        for idx, row_start in enumerate(starts):
            row_end = starts[idx + 1] if idx + 1 < len(starts) else len(lines)
            code = _code_for_row(lines, row_start, row_end)
            if not code or code in seen:
                continue
            results.append(parse_one(lines, row_start, row_end, code))
            seen.add(code)

        # Fallback pass: some reports wrap the serial/state/metrics differently. Recover remaining
        # project identifiers only when a nearby serial-number row makes the block unambiguous.
        code_lines = [i for i, line in enumerate(lines) if CODE_RE.search(line)]
        for ci in code_lines:
            m = CODE_RE.search(lines[ci])
            if not m:
                continue
            code = m.group(1).upper()
            if code in seen:
                continue
            candidate_row = None
            for j in range(max(0, ci - 5), ci + 1):
                if re.match(r"^\s*\d{1,5}\s*(?:[|.)-]|\s)", lines[j]) and CODE_RE.search("\n".join(lines[j:min(len(lines), j+5)])):
                    candidate_row = j
                    break
            if candidate_row is None:
                continue
            # Determine the block end by the next serial row in the page.
            next_rows = [x for x in starts if x > candidate_row]
            row_end = min(next_rows) if next_rows else len(lines)
            results.append(parse_one(lines, candidate_row, row_end, code))
            seen.add(code)

    meta = {
        "source_name": "PAIMANA Monthly Flash Report",
        "report_period": report_period,
        "file_sha256": sha256_file(path),
        "parser_version": PARSER_VERSION,
        "path": str(path),
        "parsed_pages": parsed_pages,
        "reporting_cutoff": reporting_cutoff.isoformat() if reporting_cutoff else None,
    }
    # Modern PAIMANA reports can contain a legacy-code appendix in the same PDF.
    # When a numeric/current project row explicitly references an N-coded legacy
    # identifier, the later N-coded row is a duplicate representation of the same
    # project, not another project. Remove only those provable duplicates; older
    # OCMS-era reports that contain only N-coded identifiers remain untouched.
    numeric_legacy = {
        str(r.legacy_ocms_code).strip().upper()
        for r in results
        if r.legacy_ocms_code and re.fullmatch(r'N\d+', str(r.legacy_ocms_code).strip().upper())
        and not re.fullmatch(r'N\d+', str(r.project_code or '').strip().upper())
    }
    if numeric_legacy:
        results = [
            r for r in results
            if not (re.fullmatch(r'N\d+', str(r.project_code or '').strip().upper())
                    and str(r.project_code).strip().upper() in numeric_legacy)
        ]

    return meta, results

