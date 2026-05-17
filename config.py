"""Application configuration."""
import os

DATA_DIR        = os.environ.get('DATA_DIR', '/home/user/work/data')
DATA_PATH       = os.path.join(DATA_DIR, 'enhanced_members.json')
HISTORY_PATH    = os.path.join(DATA_DIR, 'member_history.json')
SENTINEL_PATH   = os.path.join(DATA_DIR, '.refresh_done')
REFRESH_INFO    = os.path.join(DATA_DIR, 'last_refresh.json')

# Spotlights: ship with the repo, fallback to DATA_DIR for runtime overrides
_repo_spotlights = os.path.join(os.path.dirname(__file__), 'data', 'spotlights.json')
SPOTLIGHTS_PATH = os.environ.get('SPOTLIGHTS_PATH', _repo_spotlights)

HOST  = os.environ.get('HOST', '0.0.0.0')
PORT  = int(os.environ.get('PORT', 8050))
DEBUG = os.environ.get('DEBUG', 'false').lower() == 'true'
