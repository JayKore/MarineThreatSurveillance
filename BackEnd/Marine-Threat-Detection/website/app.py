"""
Marine Threat Surveillance — Flask app

Pages (Jinja2):  /  /detect  /dashboard  /approach  /evaluation  /dataset
APIs:            /predict  /health  /auth/{login,signup,logout,me}
"""

from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional

from flask import (
    Flask, render_template, request, jsonify,
    redirect, url_for, session, send_from_directory
)
from werkzeug.security import generate_password_hash, check_password_hash

# project imports
THIS_DIR = Path(__file__).resolve().parent
PROJECT_DIR = THIS_DIR.parent
sys.path.insert(0, str(PROJECT_DIR))

from config import (
    STATIC_DIR, MODEL_PATH, FALLBACK_MODEL_PATH,
    NORMALIZATION, IMAGE_SIZE, ALLOWED_EXTENSIONS, MAX_FILE_SIZE,
    CLASSES, DEBUG, SECRET_KEY, UPLOAD_FOLDER,
    LOG_FILE, LOG_LEVEL,
)

# heavy deps loaded lazily so the app can boot even if torch is missing
try:
    import torch
    import torchvision.transforms as transforms
    from PIL import Image
    TORCH_AVAILABLE = True
except Exception as _e:  # pragma: no cover
    TORCH_AVAILABLE = False
    _import_err = _e

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = Flask(
    __name__,
    static_folder=str(THIS_DIR / "static"),
    template_folder=str(THIS_DIR / "templates"),
)
app.config["SECRET_KEY"] = SECRET_KEY
app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["JSON_SORT_KEYS"] = False

# logging
if not app.debug:
    fh = RotatingFileHandler(str(LOG_FILE), maxBytes=10_485_760, backupCount=10)
    fh.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]"
    ))
    fh.setLevel(getattr(logging, LOG_LEVEL))
    app.logger.addHandler(fh)
    app.logger.setLevel(getattr(logging, LOG_LEVEL))

USERS_FILE = PROJECT_DIR / "users.json"
if not USERS_FILE.exists():
    USERS_FILE.write_text(json.dumps({"users": {}}, indent=2))

# Live YOLOv8 surveillance — ported from the GitHub repo's BackEnd/detection.
# The detector lazy-loads its deps; if torch/ultralytics/cv2 are missing it
# stays dormant and the /live page renders a "missing deps" notice.
from live_detection import LiveDetector  # noqa: E402
LIVE_SNAPSHOTS_DIR = THIS_DIR / "static" / "snapshots"
live_detector = LiveDetector(LIVE_SNAPSHOTS_DIR)


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

class ThreatModel:
    """Wraps the PyTorch classifier — provides .ready and .predict()."""

    def __init__(self):
        self.ready: bool = False
        self.model = None
        self.transform = None
        self.device = None
        self.error: Optional[str] = None
        if not TORCH_AVAILABLE:
            self.error = f"torch import failed: {_import_err}"
            app.logger.error(self.error)
            return
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self._load()

    def _load(self):
        path = MODEL_PATH if MODEL_PATH.exists() and MODEL_PATH.stat().st_size > 0 else FALLBACK_MODEL_PATH
        if not path.exists() or path.stat().st_size == 0:
            self.error = f"Model weights missing or empty at {MODEL_PATH} or {FALLBACK_MODEL_PATH}."
            app.logger.warning(self.error)
            return
        try:
            # weights_only=False because best_model.pth was saved as a full
            # nn.Module (ResNet), not a state_dict. We trust this file because
            # it's the project's own checkpoint pulled from the team Drive.
            self.model = torch.load(str(path), map_location=self.device, weights_only=False)
            self.model.to(self.device)
            self.model.eval()
            self.transform = transforms.Compose([
                transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
                transforms.ToTensor(),
                transforms.Normalize(
                    torch.Tensor(NORMALIZATION["mean"]),
                    torch.Tensor(NORMALIZATION["std"]),
                ),
            ])
            self.ready = True
            app.logger.info(f"Model loaded from {path}")
        except Exception as e:
            self.error = f"Model load failed: {e}"
            app.logger.exception(self.error)

    def predict(self, image_path: Path, threshold: float):
        """Run inference and return (detections, inference_ms, image_size)."""
        assert self.ready, "Model not loaded"

        img = Image.open(str(image_path)).convert("RGB")
        w, h = img.size
        tensor = self.transform(img).unsqueeze(0).to(self.device)

        t0 = time.perf_counter()
        with torch.no_grad():
            logits = self.model(tensor)
            probs = torch.nn.functional.softmax(logits, dim=1)[0]
        ms = int((time.perf_counter() - t0) * 1000)

        # The trained model is a binary image-level classifier.
        # We surface its prediction as a single full-image bbox detection
        # so the frontend bbox-rendering pipeline still works.
        detections = []
        for i, label in enumerate(CLASSES):
            conf = float(probs[i].item())
            if conf >= threshold:
                detections.append({
                    "label": label,
                    "confidence": conf,
                    "bbox": [0, 0, w, h],
                })

        # If nothing crossed the threshold, return the top class anyway
        if not detections:
            top = int(torch.argmax(probs).item())
            detections.append({
                "label": CLASSES[top],
                "confidence": float(probs[top].item()),
                "bbox": [0, 0, w, h],
            })

        # Sort threats first, then by confidence
        detections.sort(key=lambda d: (d["label"] != "threat", -d["confidence"]))

        # Per-class probabilities so the frontend can render a clear
        # "threat 99% / not threat 1%" breakdown in the analysis card / PDF.
        all_scores = {CLASSES[i]: float(probs[i].item()) for i in range(len(CLASSES))}
        return detections, ms, [w, h], all_scores


threat_model = ThreatModel()


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _read_users() -> dict:
    return json.loads(USERS_FILE.read_text())


def _write_users(data: dict) -> None:
    USERS_FILE.write_text(json.dumps(data, indent=2))


def _avatar_initials(username: str) -> str:
    parts = username.replace("_", " ").replace(".", " ").split()
    if len(parts) >= 2:
        return (parts[0][0] + parts[1][0]).upper()
    return username[:2].upper()


def _current_user() -> Optional[dict]:
    u = session.get("user")
    if not u:
        return None
    return {"username": u, "avatar_initials": _avatar_initials(u)}


def _allowed_image(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


# ---------------------------------------------------------------------------
# PAGE ROUTES
# ---------------------------------------------------------------------------

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/detect")
def detect():
    return render_template("detect.html")


@app.route("/dashboard")
def dashboard():
    # auth gate (UI also redirects if /auth/me 401s)
    if not _current_user():
        return redirect(url_for("home") + "?auth=required")
    return render_template("dashboard.html")


@app.route("/approach")
def approach():
    return render_template("approach.html")


@app.route("/evaluation")
def evaluation():
    return render_template("evaluation.html")


@app.route("/dataset")
def dataset():
    samples_dir = THIS_DIR / "static" / "assets" / "samples"
    sample_files = []
    if samples_dir.exists():
        sample_files = sorted([
            p.name for p in samples_dir.iterdir()
            if p.is_file() and p.stat().st_size > 0
            and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"}
        ])
    LABELS = ["vessel", "cargo", "shark", "eel", "buoy", "debris", "sea snake", "jellyfish", "patrol"]
    samples = [(f, LABELS[i % len(LABELS)]) for i, f in enumerate(sample_files[:9])]
    return render_template("dataset.html", samples=samples, labels=LABELS)


# ---------------------------------------------------------------------------
# AUTH
# ---------------------------------------------------------------------------

@app.post("/auth/signup")
def auth_signup():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return jsonify(success=False, error="Username and password required"), 400
    if len(password) < 4:
        return jsonify(success=False, error="Password must be at least 4 characters"), 400

    users_db = _read_users()
    if username in users_db["users"]:
        return jsonify(success=False, error="Username already taken"), 409

    users_db["users"][username] = {
        "email": email,
        "password_hash": generate_password_hash(password),
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    _write_users(users_db)
    session["user"] = username
    return jsonify(success=True, user={"username": username, "avatar_initials": _avatar_initials(username)})


@app.post("/auth/login")
def auth_login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    users_db = _read_users()
    rec = users_db["users"].get(username)
    if not rec or not check_password_hash(rec["password_hash"], password):
        return jsonify(success=False, error="Invalid username or password"), 401
    session["user"] = username
    return jsonify(success=True, user={"username": username, "avatar_initials": _avatar_initials(username)})


@app.post("/auth/logout")
def auth_logout():
    session.pop("user", None)
    return jsonify(success=True)


@app.get("/auth/me")
def auth_me():
    user = _current_user()
    if not user:
        return jsonify(error="Not authenticated"), 401
    return jsonify(user=user)


# ---------------------------------------------------------------------------
# INFERENCE
# ---------------------------------------------------------------------------

@app.post("/predict")
def predict():
    if "image" not in request.files:
        return jsonify(error="No image file provided (field name: 'image')"), 400
    file = request.files["image"]
    if not file or file.filename == "":
        return jsonify(error="Empty file"), 400
    if not _allowed_image(file.filename):
        return jsonify(error=f"File type not allowed. Use: {', '.join(sorted(ALLOWED_EXTENSIONS))}"), 400

    try:
        threshold = float(request.form.get("threshold", 0.5))
    except ValueError:
        threshold = 0.5
    threshold = max(0.0, min(1.0, threshold))

    if not threat_model.ready:
        return jsonify(error=threat_model.error or "Model not loaded"), 503

    # save the upload
    ext = file.filename.rsplit(".", 1)[1].lower()
    secure_name = f"upload_{uuid.uuid4().hex[:12]}.{ext}"
    save_path = Path(app.config["UPLOAD_FOLDER"]) / secure_name
    save_path.parent.mkdir(parents=True, exist_ok=True)
    file.save(str(save_path))

    try:
        detections, ms, size, all_scores = threat_model.predict(save_path, threshold)
    except Exception as e:
        app.logger.exception("Prediction error")
        return jsonify(error=f"Prediction failed: {e}"), 500

    return jsonify(
        success=True,
        detections=detections,
        all_scores=all_scores,
        inference_time_ms=ms,
        image_size=size,
        image_url=f"/uploads/{secure_name}",
        threshold=threshold,
        timestamp=datetime.utcnow().isoformat() + "Z",
    )


@app.get("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


@app.get("/health")
def health():
    return jsonify(
        status="ok",
        model_loaded=bool(threat_model.ready),
        model_error=threat_model.error,
        torch=TORCH_AVAILABLE,
        live_available=live_detector.is_available()[0],
        timestamp=datetime.utcnow().isoformat() + "Z",
    )


# ---------------------------------------------------------------------------
# Live YOLOv8 surveillance
# ---------------------------------------------------------------------------

@app.get("/live")
def live_page():
    avail, reason = live_detector.is_available()
    return render_template(
        "live.html",
        live_available=avail,
        live_unavailable_reason=reason,
        camera_index_default=0,
    )


@app.post("/live/start")
def live_start():
    try:
        cam = int(request.json.get("camera_index", 0)) if request.is_json else 0
    except (TypeError, ValueError):
        cam = 0
    ok, msg = live_detector.start(camera_index=cam)
    return (jsonify(success=ok, message=msg), 200 if ok else 409)


@app.post("/live/stop")
def live_stop():
    ok, msg = live_detector.stop()
    return jsonify(success=ok, message=msg)


@app.get("/live/status")
def live_status():
    return jsonify(live_detector.get_status())


@app.get("/live/stream.mjpg")
def live_stream():
    from flask import Response
    return Response(
        live_detector.iter_jpeg_frames(),
        mimetype="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@app.get("/live/snapshots/<path:filename>")
def live_snapshot(filename):
    return send_from_directory(str(LIVE_SNAPSHOTS_DIR), filename)


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------

@app.errorhandler(413)
def too_large(_):
    return jsonify(error=f"File too large. Max {MAX_FILE_SIZE // 1024 // 1024} MB"), 413


@app.errorhandler(404)
def not_found(_):
    if request.path.startswith(("/predict", "/auth", "/health", "/uploads")):
        return jsonify(error="Not found"), 404
    return render_template("base.html"), 404


@app.errorhandler(500)
def server_error(e):
    app.logger.exception("500: %s", e)
    if request.is_json or request.path.startswith(("/predict", "/auth", "/health")):
        return jsonify(error="Internal server error"), 500
    return render_template("base.html"), 500


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if not threat_model.ready:
        print(f"[WARN] Model not loaded - /predict will return 503. Reason: {threat_model.error}")
    app.run(host="0.0.0.0", port=5000, debug=DEBUG)
