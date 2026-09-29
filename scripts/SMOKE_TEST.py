from __future__ import annotations
import json
import sys
import urllib.parse
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/api/v3").rstrip("/")

def get(path: str):
    with urllib.request.urlopen(BASE + path, timeout=12) as r:
        if r.status < 200 or r.status >= 300:
            raise RuntimeError(f"HTTP {r.status} for {path}")
        return r.read()

checks = [
    "/health",
    "/meta",
    "/source",
    "/portfolio",
    "/portfolio/trends",
    "/portfolio/changes?include_projects=false",
    "/projects?page=1&page_size=3",
    "/map",
    "/integrity",
    "/engine/audit",
]

print("PAIMANA Sentinel API smoke test")
print("Base:", BASE)
for path in checks:
    raw = get(path)
    print(f"[OK] {path} ({len(raw)} bytes)")

project = json.loads(get("/projects?page=1&page_size=1"))["items"][0]["project_code"]
for path in [
    f"/projects/{urllib.parse.quote(project, safe='')}",
    f"/projects/{urllib.parse.quote(project, safe='')}/timeline",
    f"/projects/{urllib.parse.quote(project, safe='')}/evidence",
    f"/projects/{urllib.parse.quote(project, safe='')}/comparables",
    "/export.csv",
]:
    raw = get(path)
    print(f"[OK] {path} ({len(raw)} bytes)")

health = json.loads(get("/health"))
if health.get("status") != "ok":
    raise RuntimeError(f"Unexpected health payload: {health}")
if health.get("active_report") != "2026-04":
    raise RuntimeError(f"Unexpected active report: {health}")
if int(health.get("current_snapshots", 0)) < 2000:
    raise RuntimeError(f"Unexpected project count: {health}")
print("[OK] April 2026 frozen snapshot and 2,000+ project coverage verified")
print("PASS")
