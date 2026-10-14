"""Paths, config (non-secret) and keychain access. Secrets live ONLY in the OS keychain via `keyring`."""
import json, os, sys
from pathlib import Path
from . import APP

DEFAULT_SERVER = "https://crystal-7ot.pages.dev"

def base_dir() -> Path:
    if os.environ.get("CRYSTAL_SYNC_HOME"): p = Path(os.environ["CRYSTAL_SYNC_HOME"])
    elif sys.platform == "darwin": p = Path.home() / "Library/Application Support" / APP
    elif os.name == "nt": p = Path(os.environ.get("APPDATA", Path.home())) / APP
    else: p = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "crystal-sync"
    p.mkdir(parents=True, exist_ok=True); return p

def cfg_path() -> Path: return base_dir() / "config.json"
def log_dir() -> Path: d = base_dir() / "logs"; d.mkdir(exist_ok=True); return d

def load() -> dict:
    try: return json.loads(cfg_path().read_text())
    except Exception: return {}

def save(c: dict):
    p = cfg_path(); tmp = p.with_suffix(".tmp"); tmp.write_text(json.dumps(c, indent=2)); os.replace(tmp, p)
    try: os.chmod(p, 0o600)
    except Exception: pass

# ---- keychain ----
def _kr():
    import keyring
    return keyring

def secret_set(name: str, value: str): _kr().set_password(APP, name, value)
def secret_get(name: str):
    try: return _kr().get_password(APP, name)
    except Exception: return None
def secret_del(name: str):
    try: _kr().delete_password(APP, name)
    except Exception: pass
