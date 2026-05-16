"""Congress Ideology Map — Flask application."""
import logging
import sys

from flask import Flask, jsonify, render_template

from lib.data import get_history, get_members, last_refresh_info

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# ── App factory ───────────────────────────────────────────────────────────────
app = Flask(__name__)


# ── Routes ────────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/members")
def api_members():
    return jsonify(get_members())


@app.route("/api/last-refresh")
def api_last_refresh():
    return jsonify(last_refresh_info())


@app.route("/api/history/<bioguide_id>")
def api_history(bioguide_id: str):
    return jsonify(get_history(bioguide_id))


@app.route("/api/spotlights")
def api_spotlights():
    import json, os
    path = "/home/user/work/data/spotlights.json"
    if os.path.exists(path):
        with open(path) as f:
            return jsonify(json.load(f))
    return jsonify({})


@app.route("/health")
def health():
    members = get_members()
    return jsonify({"status": "ok", "members": len(members)})


# ── Dev server entry point ────────────────────────────────────────────────────
if __name__ == "__main__":
    from config import DEBUG, HOST, PORT
    logger.info("Starting dev server on %s:%d", HOST, PORT)
    app.run(host=HOST, port=PORT, debug=DEBUG)
