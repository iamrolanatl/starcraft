"""Offline tests for ext_sync merge/validation (fake Supabase). Run: python3 sync/tests/test_ext_sync.py"""
import datetime as dt, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1])); import ext_sync as X
DB = {"items": [], "runs": [], "quar": []}
def fake(method, path, body=None, params=None, prefer=""):
    if path == "ext_items" and method == "GET": return [dict(r) for r in DB["items"] if all(str(r.get(k[:0] or k)) == v[3:] for k, v in params.items() if k in ("source", "kind"))]
    if path == "ext_items" and method == "POST":
        for b in body:
            o = next((r for r in DB["items"] if (r["source"], r["kind"], r["ext_id"]) == (b["source"], b["kind"], b["ext_id"])), None)
            if o: o.update(b)
            else: DB["items"].append({"id": str(len(DB["items"])), **b})
        return None
    if path == "ext_items" and method == "PATCH": next(r for r in DB["items"] if r["id"] == params["id"][3:]).update(body); return None
    if path == "ext_sync_runs": DB["runs"].append(body); return None
    if path == "ext_quarantine": DB["quar"].append(body); return None
    raise AssertionError(path)
X.rest = fake; X._uid = "u1"
W = (dt.datetime(2026, 10, 1, tzinfo=X.ET), dt.datetime(2026, 12, 1, tzinfo=X.ET))
ev = lambda i, **k: {"event_id": f"e{i}", "summary": f"Event {i}", "start_time": f"2026-10-{10+i:02d}T09:00:00-04:00", "end_time": f"2026-10-{10+i:02d}T10:00:00-04:00", "location": "Gym", **k}
pull = lambda evs: X.merge("google", "event", [X.norm_google_event(e) for e in evs], W, evs)
assert pull([ev(i) for i in range(6)]) == "ok" and len(DB["items"]) == 6
# blank field never overwrites
assert pull([ev(0, location="")] + [ev(i) for i in range(1, 6)]) == "ok"
assert DB["items"][0]["location"] == "Gym", DB["items"][0]
# blank pull quarantined, nothing touched
assert pull([]) == "quarantined" and all(r["missing_count"] == 0 for r in DB["items"]) and DB["quar"]
# suspicious drop quarantined
assert pull([ev(0), ev(1)]) == "quarantined"
# bad rows quarantined
assert pull([ev(i, summary="") for i in range(6)]) == "quarantined"
# one item gone -> missing, archived after 3 good pulls, never deleted
for _ in range(3): assert pull([ev(i) for i in range(5)]) == "ok"
r5 = next(r for r in DB["items"] if r["ext_id"] == "e5"); assert r5["missing_count"] == 3 and r5["archived_at"], r5
assert len(DB["items"]) == 6
# reappearing un-archives
pull([ev(i) for i in range(6)]); assert next(r for r in DB["items"] if r["ext_id"] == "e5")["archived_at"] is None
# all-day google end is exclusive; ICS + Graph normalizers
a = X.norm_google_event({"event_id": "x", "summary": "Trip", "start_time": "2026-10-02", "end_time": "2026-10-05", "all_day": True})
assert a["all_day"] and a["due_date"] == "2026-10-02" and a["ends_at"].startswith("2026-10-04")
ics = "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:w1\nSUMMARY:Band practice\nDTSTART;TZID=America/New_York:20261013T153000\nDTEND;TZID=America/New_York:20261013T163000\nRRULE:FREQ=WEEKLY;COUNT=3\nEND:VEVENT\nBEGIN:VEVENT\nUID:a1\nSUMMARY:No school\nDTSTART;VALUE=DATE:20261020\nDTEND;VALUE=DATE:20261021\nEND:VEVENT\nEND:VCALENDAR\n"
rs = X.ics_rows(ics, *W); assert len(rs) == 4 and len({r["ext_id"] for r in rs}) == 4 and any(r["all_day"] and r["due_date"] == "2026-10-20" for r in rs)
g = X.norm_graph_task({"id": "t1", "title": "Read ch 4", "status": "completed", "dueDateTime": {"dateTime": "2026-10-16T00:00:00.0000000", "timeZone": "UTC"}})
assert g["done"] and g["due_date"] == "2026-10-16"
ge = X.norm_graph_event({"id": "g1", "subject": "Club", "start": {"dateTime": "2026-10-15T19:00:00.0000000", "timeZone": "UTC"}, "end": {"dateTime": "2026-10-15T20:00:00.0000000", "timeZone": "UTC"}})
assert ge["due_date"] == "2026-10-15" and ge["starts_at"].startswith("2026-10-15T19:00")
t = X.norm_google_task({"id": "k", "title": "Pay bill", "status": "needsAction", "due": "2026-10-20T00:00:00.000Z"}, {"id": "L", "title": "My Tasks"})
assert t["due_date"] == "2026-10-20" and not t["done"] and t["list_id"] == "L"
print("ext_sync tests: all passed")
