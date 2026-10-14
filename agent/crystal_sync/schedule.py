"""Install/uninstall background jobs so sync survives reboots:
  Linux  : systemd --user  crystal-sync.service (daemon, Restart=always) + crystal-sync.timer (05:40/17:40, Persistent=true)
  macOS  : ~/Library/LaunchAgents com.crystal.sync.daemon.plist (KeepAlive) + com.crystal.sync.schedule.plist (StartCalendarInterval 5:40/17:40)
  Windows: Task Scheduler  'Crystal Sync Daemon' (at log-on) + 'Crystal Sync 0540' / 'Crystal Sync 1740' (daily)."""
import os, shlex, subprocess, sys
from pathlib import Path

def exe_cmd():
    if getattr(sys, "frozen", False):
        return [os.environ.get("APPIMAGE") or sys.executable]
    return [sys.executable, "-m", "crystal_sync"]

def _run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True); return r.returncode, (r.stdout + r.stderr).strip()

def install():
    cmd = exe_cmd(); out = []
    if sys.platform.startswith("linux"):
        d = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "systemd/user"; d.mkdir(parents=True, exist_ok=True)
        q = " ".join(shlex.quote(x) for x in cmd)
        (d / "crystal-sync.service").write_text(f"[Unit]\nDescription=Crystal Sync (polls for SYNC NOW, catches up missed 5:40 runs)\nAfter=network-online.target\n\n[Service]\nExecStart={q} daemon\nRestart=always\nRestartSec=30\n\n[Install]\nWantedBy=default.target\n")
        (d / "crystal-sync-run.service").write_text(f"[Unit]\nDescription=Crystal Sync scheduled pull\n\n[Service]\nType=oneshot\nExecStart={q} run --scheduled\n")
        (d / "crystal-sync-run.timer").write_text("[Unit]\nDescription=Crystal Sync at 5:40 AM and 5:40 PM\n\n[Timer]\nOnCalendar=*-*-* 05,17:40:00\nPersistent=true\nUnit=crystal-sync-run.service\n\n[Install]\nWantedBy=timers.target\n")
        for c in (["systemctl", "--user", "daemon-reload"], ["systemctl", "--user", "enable", "--now", "crystal-sync.service", "crystal-sync-run.timer"]): out.append(_run(c))
        out.append(_run(["loginctl", "enable-linger", os.environ.get("USER", "")]))   # keep running after logout (best effort)
    elif sys.platform == "darwin":
        la = Path.home() / "Library/LaunchAgents"; la.mkdir(parents=True, exist_ok=True); logs = Path.home() / "Library/Logs"
        args = "".join(f"<string>{x}</string>" for x in cmd)
        def plist(label, extra, sub): return (f'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
            f'<plist version="1.0"><dict><key>Label</key><string>{label}</string><key>ProgramArguments</key><array>{args}{sub}</array>{extra}'
            f'<key>StandardOutPath</key><string>{logs}/{label}.log</string><key>StandardErrorPath</key><string>{logs}/{label}.log</string></dict></plist>\n')
        p1 = la / "com.crystal.sync.daemon.plist"; p1.write_text(plist("com.crystal.sync.daemon", "<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>", "<string>daemon</string>"))
        cal = "<key>StartCalendarInterval</key><array>" + "".join(f"<dict><key>Hour</key><integer>{h}</integer><key>Minute</key><integer>40</integer></dict>" for h in (5, 17)) + "</array>"
        p2 = la / "com.crystal.sync.schedule.plist"; p2.write_text(plist("com.crystal.sync.schedule", cal, "<string>run</string><string>--scheduled</string>"))
        for p in (p1, p2): _run(["launchctl", "unload", str(p)]); out.append(_run(["launchctl", "load", "-w", str(p)]))
    elif os.name == "nt":
        tr = subprocess.list2cmdline(cmd)
        out.append(_run(["schtasks", "/Create", "/F", "/TN", "Crystal Sync Daemon", "/SC", "ONLOGON", "/RL", "LIMITED", "/TR", f"{tr} daemon"]))
        for t in ("05:40", "17:40"):
            out.append(_run(["schtasks", "/Create", "/F", "/TN", f"Crystal Sync {t.replace(':','')}", "/SC", "DAILY", "/ST", t, "/RL", "LIMITED", "/TR", f"{tr} run --scheduled"]))
        subprocess.Popen(cmd + ["daemon"], creationflags=0x08000000)   # start now, no console window
    return out

def uninstall():
    out = []
    if sys.platform.startswith("linux"):
        out.append(_run(["systemctl", "--user", "disable", "--now", "crystal-sync.service", "crystal-sync-run.timer"]))
        d = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "systemd/user"
        for f in ("crystal-sync.service", "crystal-sync-run.service", "crystal-sync-run.timer"): (d / f).unlink(missing_ok=True)
    elif sys.platform == "darwin":
        for n in ("daemon", "schedule"):
            p = Path.home() / f"Library/LaunchAgents/com.crystal.sync.{n}.plist"; out.append(_run(["launchctl", "unload", str(p)])); p.unlink(missing_ok=True)
    elif os.name == "nt":
        for t in ("Crystal Sync Daemon", "Crystal Sync 0540", "Crystal Sync 1740"): out.append(_run(["schtasks", "/Delete", "/F", "/TN", t]))
    return out
