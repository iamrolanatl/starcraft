"""crystal-sync [setup|status|run [--child ID] [--scheduled]|daemon|install|uninstall|rotate|forget]
No arguments (double-click): opens the setup/status window."""
import argparse, sys
from . import config, engine, schedule, wizard, __version__
from .api import Api

def main(argv=None):
    ap = argparse.ArgumentParser(prog="crystal-sync", description=f"Crystal Sync {__version__}")
    ap.add_argument("cmd", nargs="?", default="ui", choices=["ui", "setup", "status", "run", "daemon", "install", "uninstall", "rotate", "forget", "version", "selftest"])
    ap.add_argument("--child"); ap.add_argument("--scheduled", action="store_true"); ap.add_argument("--no-browser", action="store_true"); ap.add_argument("--port", type=int, default=0)
    a = ap.parse_args(argv)
    if a.cmd == "version": print(__version__); return 0
    if a.cmd == "selftest":   # offline: parse an archived raw zip (CRYSTAL_SYNC_FIXTURE) and print row counts; no network, no keychain
        import json, os, tempfile
        from pathlib import Path
        if not os.environ.get("CRYSTAL_SYNC_FIXTURE"): print("set CRYSTAL_SYNC_FIXTURE=<raw zip>"); return 2
        w = Path(tempfile.mkdtemp()); (w / "raw").mkdir(); lg = lambda s, m, l="info": print(f"{l:5} {s:8} {m[:160]}")
        fl = engine.fetch_parentvue(w / "raw", {}, "", lg); (w / "raw/_fetch_log.json").write_text(json.dumps(fl))
        _, counts, reasons = engine.build_payload(w, lg); print("SELFTEST", json.dumps(counts), "quarantine:" if reasons else "accepted", reasons or ""); return 0
    if a.cmd in ("ui", "setup"): wizard.serve(not a.no_browser, a.port); return 0
    if a.cmd == "status":
        c = config.load(); print({"paired": bool(c.get("device_id")), "children": [k["name"] for k in c.get("children", [])], "last": c.get("last"), "config_dir": str(config.base_dir())}); return 0
    if a.cmd == "run":
        if a.scheduled:   # leader lease: only one paired computer logs in per slot
            st = engine.scheduled(); return 0 if st in ("ok", "done", "standby") else 1
        st = engine.run(a.child, trigger="schedule"); return 0 if st == "ok" else 1
    if a.cmd == "daemon": engine.daemon(); return 0
    if a.cmd == "install": print(schedule.install()); return 0
    if a.cmd == "uninstall": print(schedule.uninstall()); return 0
    if a.cmd == "rotate":
        c = config.load(); k = Api(c.get("server", config.DEFAULT_SERVER), config.secret_get("device_key")).rotate(); config.secret_set("device_key", k); print("device key rotated"); return 0
    if a.cmd == "forget":
        c = config.load(); schedule.uninstall(); config.secret_del("device_key")
        for kind, acc in (c.get("accounts") or {}).items(): config.secret_del(f"{kind}:{acc.get('username')}")
        config.save({}); print("Crystal Sync removed: background jobs, keychain entries and config cleared."); return 0

if __name__ == "__main__":
    sys.exit(main())
