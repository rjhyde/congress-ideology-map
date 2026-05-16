"""Data layer — member loading with hot-reload sentinel support."""
import json
import logging
import os

from config import DATA_PATH, HISTORY_PATH, SENTINEL_PATH, REFRESH_INFO

logger = logging.getLogger(__name__)

_members: list = []
_history: dict = {}
_last_sentinel: float = 0.0


def _load_members() -> list:
    with open(DATA_PATH) as f:
        return json.load(f)


def _load_history() -> dict:
    try:
        with open(HISTORY_PATH) as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning("member_history.json not found — history unavailable")
        return {}


def get_members() -> list:
    """Return member list, hot-reloading when the refresh sentinel changes."""
    global _members, _history, _last_sentinel

    sentinel_mtime = (
        os.path.getmtime(SENTINEL_PATH) if os.path.exists(SENTINEL_PATH) else 0.0
    )

    if not _members or sentinel_mtime > _last_sentinel:
        logger.info("Loading member data from %s", DATA_PATH)
        _members = _load_members()
        _history = _load_history()
        _last_sentinel = sentinel_mtime
        logger.info("Loaded %d members", len(_members))
        if os.path.exists(SENTINEL_PATH):
            os.remove(SENTINEL_PATH)

    return _members


def get_history(bioguide_id: str) -> list:
    """Return per-congress history for one member."""
    global _history
    if not _history:
        _history = _load_history()
    return _history.get(bioguide_id, [])


def last_refresh_info() -> dict:
    """Return metadata from the last data refresh."""
    import datetime
    try:
        with open(REFRESH_INFO) as f:
            return json.load(f)
    except FileNotFoundError:
        return {
            "timestamp": datetime.datetime.now().isoformat(),
            "members_count": len(get_members()),
            "sources": [],
        }
