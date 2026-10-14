import sys, os; sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import merge as M
def test_blank_never_overwrites():
    m, c, _ = M.merge_fields({"a": "x", "b": [1], "c": 5}, {"a": "N/A", "b": [], "c": None}, ["a", "b", "c"]); assert m == {"a": "x", "b": [1], "c": 5} and c["kept_old"] == 3
def test_real_change_wins():
    m, c, ch = M.merge_fields({"a": "x"}, {"a": "y"}, ["a"]); assert m["a"] == "y" and ch
def test_missing_then_archive_after_3():
    r = [{"ext_id": "a", "name": "X", "missing_count": 0, "archived_at": None}]
    for i in range(3): r, _ = M.merge_rows(r, [], ("ext_id",), ["name"], f"t{i}")
    assert r[0]["missing_count"] == 3 and r[0]["archived_at"] == "t2" and r[0]["missing_since"] == "t0"
def test_validators():
    assert M.v_pct(150) == (None, True) and M.v_pct("88") == (88.0, False) and M.v_email("bad") == (None, True) and M.v_date("2026-13-01") == (None, True)
if __name__ == "__main__":
    for k, f in list(globals().items()):
        if k.startswith("test_"): f(); print("PASS", k)
