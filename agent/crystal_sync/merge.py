"""Reusable non-destructive merge + validation helpers for every Crystal auto-sync (school, health, finance, ...).

Rules (see docs/data-validation-strategy.md):
  * A blank incoming value (None, "", "N/A", "-", [], {}) never overwrites a known value: the old value is kept.
  * A real new non-blank value replaces the old one (last_changed_at is bumped).
  * Rows missing from a good pull are never deleted: missing_since is set, missing_count counts consecutive
    good pulls without them, archived_at is set after `archive_after` such pulls (or on a term change if asked).
  * A row that reappears is un-missed and un-archived.
"""
import datetime as dt, re
from collections import Counter

BLANK_STR = {"", "n/a", "na", "-", "—", "null", "none"}
EMAIL = re.compile(r"^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")

def is_blank(v):
    if v is None: return True
    if isinstance(v, str): return v.strip().lower() in BLANK_STR
    if isinstance(v, (list, dict, tuple, set)): return len(v) == 0
    return False

def merge_fields(old, new, fields, allow_blank=()):
    """Field-level merge. Returns (merged, Counter(accepted, kept_old, unchanged), changed?).
    allow_blank: fields where a blank is a legitimate value to RECORD (e.g. a term-status mark) but only when old is blank too
    or the caller says so explicitly by passing it in; by default blanks never win."""
    old = old or {}; out = dict(old); c = Counter(); changed = False
    for f in fields:
        nv, ov = new.get(f), old.get(f)
        if is_blank(nv) and f not in allow_blank:
            if is_blank(ov): out[f] = ov if f in old else nv; c["unchanged"] += 1
            else: out[f] = ov; c["kept_old"] += 1
        elif nv == ov or (isinstance(nv, (int, float)) and isinstance(ov, (int, float)) and float(nv) == float(ov)):
            out[f] = ov; c["unchanged"] += 1
        else:
            out[f] = nv; c["accepted"] += 1; changed = True
    return out, c, changed

def merge_rows(old_rows, new_rows, key, fields, now, archive_after=3, archive_all=False, extra=None):
    """Row-set merge. old_rows/new_rows: lists of dicts. key: tuple of key field names.
    Returns (rows_to_upsert, Counter). Every returned row carries last_seen_at/last_changed_at/missing_* /archived_at."""
    k = lambda r: tuple(str(r.get(x)) for x in key)
    old = {k(r): r for r in old_rows}; seen = set(); out = []; st = Counter()
    for n in new_rows:
        kk = k(n); seen.add(kk); o = old.get(kk)
        m, c, changed = merge_fields(o, n, fields); st.update(c)
        m.update({x: n[x] for x in key}); m.update(extra or {})
        m["last_seen_at"] = now
        m["last_changed_at"] = now if (changed or not o) else (o.get("last_changed_at") or now)
        m["missing_since"] = None; m["missing_count"] = 0; m["archived_at"] = None
        st["new_rows" if not o else "seen_rows"] += 1
        out.append(m)
    for kk, o in old.items():
        if kk in seen or o.get("archived_at"): continue
        m = dict(o); m["missing_count"] = int(o.get("missing_count") or 0) + 1
        m["missing_since"] = o.get("missing_since") or now
        if archive_all or m["missing_count"] >= archive_after: m["archived_at"] = now; st["archived_rows"] += 1
        else: st["missing_rows"] += 1
        out.append(m)
    return out, st

# ---------- type checks: a failing value is dropped (None) and logged; never written ----------
def v_pct(v, lo=0.0, hi=100.0):
    if v is None or v == "": return None, False
    try: f = float(v)
    except (TypeError, ValueError): return None, True
    return (f, False) if lo <= f <= hi else (None, True)

def v_date(v):
    if is_blank(v): return None, False
    s = str(v)[:10]
    try: dt.date.fromisoformat(s); return s, False
    except ValueError: return None, True

def v_ts(v):
    if is_blank(v): return None, False
    try: dt.datetime.fromisoformat(str(v).replace("Z", "+00:00")); return v, False
    except ValueError: return None, True

def v_email(v):
    if is_blank(v): return None, False
    return (v.strip(), False) if EMAIL.match(v.strip()) else (None, True)

def clean(row, checks, required, log, label):
    """Apply {field: validator} to row; drop failing values; return None if a required field is blank."""
    bad = 0
    for f, fn in checks.items():
        if f in row:
            val, failed = fn(row[f])
            if failed: log.append(f"{label}: dropped invalid {f}={str(row[f])[:40]!r}"); bad += 1
            row[f] = val
    for f in required:
        if is_blank(row.get(f)): log.append(f"{label}: row dropped, missing required {f}"); return None, bad + 1
    return row, bad
