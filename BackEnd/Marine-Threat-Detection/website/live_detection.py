"""
Live Surveillance module — wraps a YOLOv8 inference loop on a webcam.

Adapted from the YOLOv8/FastAPI version of this project on GitHub:
  https://github.com/JayKore/MarineThreatSurveillance (BackEnd/detection/inference.py)

Differences from the original:
  - Single-module, no `backend.config.settings` package — config is inlined.
  - No FastAPI / WebSocket dependency. The Flask app polls `get_status()` over HTTP
    and serves the annotated frames as an MJPEG stream via `iter_jpeg_frames()`.
  - All ML imports are lazy. If torch / ultralytics / opencv are missing,
    `LiveDetector.is_available()` returns False with a human-readable reason
    and every entry point becomes a no-op so the rest of the Flask app keeps
    working.

Concurrency model:
  - One background thread runs the camera capture + YOLO inference loop.
  - The latest annotated JPEG-encoded frame is kept in memory under a lock.
  - The MJPEG stream and the status polling endpoint both read this state.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterator, Optional

logger = logging.getLogger(__name__)


# ─── Config (inlined from BackEnd/config/settings.py on GitHub) ─────────────

YOLO_MODEL_NAME = os.getenv("YOLO_MODEL_NAME", "yolov8n.pt")
CONFIDENCE_THRESHOLD = float(os.getenv("LIVE_CONFIDENCE", "0.45"))
FRAME_WIDTH = int(os.getenv("LIVE_FRAME_WIDTH", "640"))
FRAME_HEIGHT = int(os.getenv("LIVE_FRAME_HEIGHT", "480"))
PROCESS_EVERY_N_FRAMES = int(os.getenv("LIVE_PROCESS_EVERY_N", "2"))
SNAPSHOT_COOLDOWN_SECONDS = float(os.getenv("LIVE_SNAPSHOT_COOLDOWN", "8"))
MAX_RECENT_DETECTIONS = 30
MAX_SNAPSHOTS = 50
JPEG_QUALITY = 75

# COCO classes considered marine "threats". Boats are the canonical example.
# The dictionary is the full set we'll DRAW; the set marks which raise the alarm.
MONITORED_CLASS_IDS = {0, 1, 8, 14, 15, 16, 17}  # person, bicycle, boat, bird, cat, dog, horse
THREAT_CLASS_IDS = {8}  # boat
COCO_NAMES = {
    0: "person", 1: "bicycle", 8: "boat",
    14: "bird", 15: "cat", 16: "dog", 17: "horse",
}


# ─── Data shapes ────────────────────────────────────────────────────────────

@dataclass
class Detection:
    class_id: int
    class_name: str
    confidence: float
    bbox: tuple  # (x1, y1, x2, y2)
    is_threat: bool
    timestamp: float = field(default_factory=time.time)

    def to_dict(self):
        d = asdict(self)
        d["bbox"] = list(self.bbox)
        return d


@dataclass
class Snapshot:
    filename: str
    timestamp: float
    threat_class: str
    confidence: float

    def to_dict(self):
        return asdict(self)


# ─── Detector ───────────────────────────────────────────────────────────────

class LiveDetector:
    """
    Encapsulates the camera + YOLOv8 loop. There's exactly one instance,
    held by app.py. Calls are thread-safe.
    """

    def __init__(self, snapshots_dir: Path):
        self.snapshots_dir = snapshots_dir
        self.snapshots_dir.mkdir(parents=True, exist_ok=True)

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

        self._model = None
        self._cv2 = None
        self._np = None

        self._latest_jpeg: Optional[bytes] = None
        self._fps = 0.0
        self._frame_count = 0
        self._loop_start = 0.0
        self._cam_index = 0

        self._recent_detections: deque[Detection] = deque(maxlen=MAX_RECENT_DETECTIONS)
        self._recent_snapshots: deque[Snapshot] = deque(maxlen=MAX_SNAPSHOTS)
        self._last_snapshot_time: dict[int, float] = {}

        self._last_error: Optional[str] = None
        self._availability_checked = False
        self._available = False
        self._availability_reason = "not yet probed"

    # ───── Availability / status ─────

    def is_available(self) -> tuple[bool, str]:
        """Lazily check whether torch/ultralytics/cv2 are importable."""
        if self._availability_checked:
            return self._available, self._availability_reason
        try:
            import torch  # noqa: F401
            import cv2  # noqa: F401
            from ultralytics import YOLO  # noqa: F401
            self._available = True
            self._availability_reason = "ok"
        except Exception as e:  # pragma: no cover
            self._available = False
            self._availability_reason = f"missing dependency: {e}"
        self._availability_checked = True
        return self._available, self._availability_reason

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def get_status(self) -> dict:
        avail, reason = self.is_available()
        with self._lock:
            return {
                "available": avail,
                "availability_reason": reason,
                "running": self.is_running,
                "fps": round(self._fps, 1),
                "frame_count": self._frame_count,
                "camera_index": self._cam_index,
                "model_name": YOLO_MODEL_NAME,
                "confidence_threshold": CONFIDENCE_THRESHOLD,
                "recent_detections": [d.to_dict() for d in list(self._recent_detections)[-10:]],
                "recent_snapshots": [s.to_dict() for s in list(self._recent_snapshots)[-12:]],
                "active_threats": sum(1 for d in self._recent_detections
                                       if d.is_threat and time.time() - d.timestamp < 5),
                "last_error": self._last_error,
            }

    # ───── Lifecycle ─────

    def start(self, camera_index: int = 0) -> tuple[bool, str]:
        avail, reason = self.is_available()
        if not avail:
            return False, reason
        if self.is_running:
            return False, "already running"
        self._cam_index = camera_index
        self._stop_event.clear()
        self._last_error = None
        self._thread = threading.Thread(target=self._run, daemon=True, name="LiveDetector")
        self._thread.start()
        return True, "started"

    def stop(self) -> tuple[bool, str]:
        if not self.is_running:
            return False, "not running"
        self._stop_event.set()
        self._thread.join(timeout=4.0)
        self._thread = None
        return True, "stopped"

    # ───── Streaming ─────

    def iter_jpeg_frames(self) -> Iterator[bytes]:
        """
        Generator yielding multipart/x-mixed-replace MJPEG frames. Used by the
        Flask route as `Response(detector.iter_jpeg_frames(), mimetype=...)`.
        """
        boundary = b"--frame"
        while True:
            with self._lock:
                jpeg = self._latest_jpeg
            if jpeg is not None:
                yield (
                    boundary + b"\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(jpeg)).encode() + b"\r\n\r\n"
                    + jpeg + b"\r\n"
                )
            else:
                # Idle frame so the browser doesn't immediately give up before
                # the camera warms up.
                placeholder = self._idle_jpeg()
                yield (
                    boundary + b"\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(placeholder)).encode() + b"\r\n\r\n"
                    + placeholder + b"\r\n"
                )
            time.sleep(0.04)  # ~25 fps cap on the wire
            if not self.is_running and self._latest_jpeg is None:
                # No more frames coming, shut the generator.
                break

    # ───── Internal ─────

    def _run(self):
        """Camera capture + YOLO inference loop. Runs on its own thread."""
        try:
            import cv2
            import numpy as np
            from ultralytics import YOLO
        except Exception as e:
            self._last_error = f"import failed: {e}"
            logger.exception("Live detector failed to import deps")
            return

        self._cv2 = cv2
        self._np = np

        try:
            self._model = YOLO(YOLO_MODEL_NAME)
            logger.info("Loaded YOLO model %s", YOLO_MODEL_NAME)
        except Exception as e:
            self._last_error = f"model load failed: {e}"
            logger.exception("Failed to load YOLO model")
            return

        cap = cv2.VideoCapture(self._cam_index, cv2.CAP_DSHOW if os.name == "nt" else 0)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)

        if not cap.isOpened():
            self._last_error = f"could not open camera index {self._cam_index}"
            logger.error(self._last_error)
            return

        self._loop_start = time.time()
        self._frame_count = 0
        loop_n = 0

        try:
            while not self._stop_event.is_set():
                ok, frame = cap.read()
                if not ok:
                    self._last_error = "camera read failed"
                    time.sleep(0.05)
                    continue
                loop_n += 1

                # Skip detection on some frames for throughput; still display them.
                if loop_n % PROCESS_EVERY_N_FRAMES == 0:
                    detections = self._infer(frame)
                    self._record_detections(frame, detections)
                    self._draw(frame, detections)
                else:
                    self._draw(frame, [])

                self._update_fps()
                ok2, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
                if ok2:
                    with self._lock:
                        self._latest_jpeg = jpeg.tobytes()
                        self._frame_count += 1
        except Exception as e:
            self._last_error = f"loop crashed: {e}"
            logger.exception("Live detector loop crashed")
        finally:
            cap.release()
            with self._lock:
                self._latest_jpeg = None

    def _infer(self, frame) -> list[Detection]:
        results = self._model(
            frame,
            conf=CONFIDENCE_THRESHOLD,
            classes=list(MONITORED_CLASS_IDS),
            verbose=False,
        )
        out: list[Detection] = []
        if not results:
            return out
        boxes = results[0].boxes
        if boxes is None or len(boxes) == 0:
            return out
        for box in boxes:
            cid = int(box.cls[0].item())
            conf = float(box.conf[0].item())
            x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
            name = COCO_NAMES.get(cid, f"class_{cid}")
            is_threat = cid in THREAT_CLASS_IDS
            out.append(Detection(cid, name, conf, (x1, y1, x2, y2), is_threat))
        return out

    def _draw(self, frame, detections: list[Detection]):
        cv2 = self._cv2
        h, w = frame.shape[:2]
        threat_count = 0
        for d in detections:
            x1, y1, x2, y2 = d.bbox
            color = (0, 0, 220) if d.is_threat else (0, 200, 80)
            thickness = 3 if d.is_threat else 2
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, thickness)
            label = f"{d.class_name} {d.confidence:.0%}"
            if d.is_threat:
                label = "THREAT: " + label
                threat_count += 1
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
            cv2.rectangle(frame, (x1, y1 - th - 8), (x1 + tw + 6, y1), color, -1)
            cv2.putText(frame, label, (x1 + 3, y1 - 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)

        # Status overlay
        cv2.putText(frame, f"FPS {self._fps:.1f}", (10, 24),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 212, 255), 2, cv2.LINE_AA)
        cv2.putText(frame, f"DET {len(detections)}", (10, 46),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 212, 255), 2, cv2.LINE_AA)
        if threat_count:
            cv2.rectangle(frame, (0, h - 32), (w, h), (0, 0, 200), -1)
            cv2.putText(frame, f"!! {threat_count} THREAT(S) DETECTED",
                        (12, h - 9), cv2.FONT_HERSHEY_SIMPLEX, 0.65,
                        (255, 255, 255), 2, cv2.LINE_AA)

    def _record_detections(self, frame, detections: list[Detection]):
        if not detections:
            return
        now = time.time()
        with self._lock:
            for d in detections:
                self._recent_detections.append(d)

        # Snapshot any threat that's past the cooldown for its class
        for d in detections:
            if not d.is_threat:
                continue
            last = self._last_snapshot_time.get(d.class_id, 0)
            if now - last < SNAPSHOT_COOLDOWN_SECONDS:
                continue
            self._last_snapshot_time[d.class_id] = now
            self._save_snapshot(frame, d, now)

    def _save_snapshot(self, frame, det: Detection, ts: float):
        cv2 = self._cv2
        ts_str = time.strftime("%Y%m%d_%H%M%S", time.localtime(ts))
        filename = f"threat_{det.class_name}_{ts_str}.jpg"
        path = self.snapshots_dir / filename
        try:
            cv2.imwrite(str(path), frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            with self._lock:
                self._recent_snapshots.append(Snapshot(filename, ts, det.class_name, det.confidence))
        except Exception:
            logger.exception("Failed to save snapshot")

    def _update_fps(self):
        now = time.time()
        elapsed = now - self._loop_start
        if elapsed > 0:
            self._fps = self._frame_count / elapsed if self._frame_count else 0.0
        # Periodically reset the window so FPS stays a recent measurement.
        if elapsed > 5.0:
            self._loop_start = now
            self._frame_count = 0

    _idle_cache: Optional[bytes] = None

    def _idle_jpeg(self) -> bytes:
        """A small black JPEG used while the camera is warming up."""
        if LiveDetector._idle_cache is None:
            try:
                import io
                from PIL import Image as _Img
                buf = io.BytesIO()
                _Img.new("RGB", (320, 180), (5, 14, 28)).save(buf, format="JPEG", quality=70)
                LiveDetector._idle_cache = buf.getvalue()
            except Exception:
                # Hard fallback: 35-byte SOI/EOI-only marker (browser will skip).
                LiveDetector._idle_cache = b"\xff\xd8\xff\xd9"
        return LiveDetector._idle_cache
