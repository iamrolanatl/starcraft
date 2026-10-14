#!/usr/bin/env python3
"""Report cards from a laptop raw zip -> private bucket raw/report-cards/<period>.pdf + public.report_cards rows.
fetch.ps1 writes ReportCardInitialData.xml (periods + DocumentGU), ReportCard_<GU>.pdf, StudentDocuments.xml, StudentDoc_<GU>.pdf.
Idempotent (dedupe by sha256); never deletes or overwrites a stored PDF (a reissued card gets its own path).
Usage: report_cards.py <zip>   (also called from poller.process). Prints 'REPORTCARDS {json}'."""
import hashlib, io, json, re, sys, zipfile, datetime as dt
import xml.etree.ElementTree as ET
import requests

def _attrs(xml):
    try: root = ET.fromstring(xml)
    except ET.ParseError: return []
    return [dict(e.attrib) for e in root.iter() if "DocumentGU" in e.attrib]

def _date(s):
    if not s: return None
    for f in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%Y %I:%M:%S %p", "%Y-%m-%dT%H:%M:%S"):
        try: return dt.datetime.strptime(s.strip(), f).date().isoformat()
        except ValueError: pass
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    return f"{m[3]}-{int(m[1]):02d}-{int(m[2]):02d}" if m else None

def _school_year(d):
    if not d: return None
    y, mo = int(d[:4]), int(d[5:7]); s = y if mo >= 7 else y - 1
    return f"{s}-{str(s + 1)[2:]}"

def _slug(s): return re.sub(r"[^A-Za-z0-9]+", "-", s or "").strip("-")[:60] or "report-card"

def extract(zbytes):
    """-> list of dicts {pdf, source, period, period_gu, document_gu, issue_date, school_year, file_name, meta}"""
    z = zipfile.ZipFile(io.BytesIO(zbytes)); names = {n.split("/")[-1]: n for n in z.namelist()}
    out = []
    def rd(n): return z.read(names[n]).decode("utf-8", "replace") if n in names else ""
    for a in _attrs(rd("ReportCardInitialData.xml")):
        gu = a["DocumentGU"]; pdf = f"ReportCard_{gu}.pdf"
        if pdf not in names: continue
        name = a.get("ReportingPeriodName") or a.get("PeriodName") or a.get("Name"); d = _date(a.get("EndDate") or a.get("Date"))
        out.append({"pdf": z.read(names[pdf]), "source": "report_card", "period": name, "period_gu": a.get("ReportingPeriodGU"),
                    "document_gu": gu, "issue_date": d, "school_year": _school_year(d), "file_name": pdf, "meta": a})
    for a in _attrs(rd("StudentDocuments.xml")):
        gu = a["DocumentGU"]; pdf = f"StudentDoc_{gu}.pdf"
        if pdf not in names: continue
        d = _date(a.get("DocumentDate") or a.get("DocDate"))
        out.append({"pdf": z.read(names[pdf]), "source": "document", "period": a.get("DocumentComment") or a.get("DocumentType") or a.get("DocumentFileName"),
                    "period_gu": None, "document_gu": gu, "issue_date": d, "school_year": _school_year(d), "file_name": a.get("DocumentFileName") or pdf, "meta": a})
    return out

def store(zbytes, url, key, uid):
    H = {"apikey": key, "Authorization": f"Bearer {key}"}
    found = extract(zbytes); added = []
    for c in found:
        if not c["pdf"].startswith(b"%PDF"): continue
        sha = hashlib.sha256(c["pdf"]).hexdigest()
        ex = requests.get(f"{url}/rest/v1/report_cards", params={"select": "id", "user_id": f"eq.{uid}", "sha256": f"eq.{sha}"}, headers=H, timeout=30)
        ex.raise_for_status()
        if ex.json(): continue
        base = f"{c['school_year'] or 'unknown-year'}_{_slug(c['period'])}"
        path = f"report-cards/{base}.pdf"
        up = requests.post(f"{url}/storage/v1/object/raw/{path}", data=c["pdf"], headers={**H, "Content-Type": "application/pdf", "x-upsert": "false"}, timeout=60)
        if up.status_code in (400, 409) and ("exist" in up.text.lower() or "duplicate" in up.text.lower()):
            path = f"report-cards/{base}-{sha[:8]}.pdf"
            up = requests.post(f"{url}/storage/v1/object/raw/{path}", data=c["pdf"], headers={**H, "Content-Type": "application/pdf", "x-upsert": "false"}, timeout=60)
        if up.status_code >= 300: raise RuntimeError(f"upload {path} -> {up.status_code}")
        row = {"user_id": uid, "source": c["source"], "school_year": c["school_year"], "period": c["period"], "period_gu": c["period_gu"],
               "document_gu": c["document_gu"], "issue_date": c["issue_date"], "file_name": c["file_name"], "storage_path": path,
               "sha256": sha, "bytes": len(c["pdf"]), "meta": c["meta"]}
        r = requests.post(f"{url}/rest/v1/report_cards", params={"on_conflict": "user_id,sha256"}, json=row,
                          headers={**H, "Prefer": "resolution=ignore-duplicates,return=minimal"}, timeout=30)
        if r.status_code >= 300: raise RuntimeError(f"report_cards insert -> {r.status_code}: {r.text[:200]}")
        added.append({"period": c["period"], "school_year": c["school_year"], "issue_date": c["issue_date"], "path": path})
    return {"found": len(found), "added": added}

if __name__ == "__main__":
    import os
    sys.path.insert(0, os.path.dirname(__file__)); import poller
    print("REPORTCARDS " + json.dumps(store(open(sys.argv[1], "rb").read(), poller.URL, poller.KEY, poller.owner())))
