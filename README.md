# Marine Threat Surveillance

AI-powered detection of marine threats — sharks, eels, sea snakes, anomalous floating objects, and (in live mode) boats — built on PyTorch and YOLOv8, served by Flask with a Jinja2-rendered, vanilla-JS frontend in a dark naval/military aesthetic.

Contributors:

- [Jay Kore](https://github.com/JayKore) · [LinkedIn](https://www.linkedin.com/in/jay-kore-/)
- [Prathamesh Pandey](https://github.com/Pra1hamCodes) · [LinkedIn](https://www.linkedin.com/in/prathmesh-pandey1103)

---

## Two modes of operation

| Mode | Page | What it does | Engine |
|---|---|---|---|
| **Detection Console** | `/detect` | Drop one image, get a calibrated **threat / not threat** verdict with per-class scores, a plain-language analysis, and a downloadable PDF report | Custom PyTorch classifier (`best_model.pth`, 44.8 MB ResNet) |
| **Live Surveillance** | `/live` | Webcam feed runs through YOLOv8 in a background thread; boats highlighted, threats trigger an auto-snapshot | Ultralytics `yolov8n.pt` (~6 MB, COCO-pretrained) |

Both modes share the same Flask server, the same auth, and the same UI.

---

## Project layout

```
Marine-Threat-Detection/
└── BackEnd/Marine-Threat-Detection/
    ├── config.py               # paths, classes, mean/std, sessions
    ├── utils.py                # shared preprocessing helpers
    ├── requirements.txt
    ├── users.json              # auto-created on first signup (hashed pw via Werkzeug)
    ├── Dataset/                # 875 real marine images
    │   ├── training/{threat,not_threat}/
    │   └── validation/{threat,not_threat}/
    ├── model/
    │   ├── best_model.pth      # 44.8 MB classifier weights (from team Drive)
    │   └── Training_Methodology.ipynb
    ├── final/best_model.pth    # fallback location for the same weights
    └── website/
        ├── app.py              # Flask entrypoint — pages + APIs
        ├── live_detection.py   # YOLOv8 wrapper (ported from the FastAPI repo)
        ├── templates/          # base.html + 7 page templates
        └── static/
            ├── css/            # main + per-page CSS, dark naval theme
            ├── js/             # vanilla JS modules (main, landing, detection,
            │                   #   dashboard, live, charts)
            ├── assets/         # bg-video.mp4, favicon.svg, samples/*
            └── snapshots/      # auto-saved threat snapshots (live mode)
```

---

## Pages

| Route        | What it is                                                                       |
|--------------|----------------------------------------------------------------------------------|
| `/`          | Landing — hero with sonar/radar, two-modes overview, pipeline, use cases, CTAs   |
| `/detect`    | Detection Console — drag-drop upload, threshold slider, analysis card, PDF export |
| `/live`      | Real-time webcam surveillance with YOLOv8, auto-snapshots, telemetry sidebar     |
| `/dashboard` | Mission Archive — saved scans (auth-gated, localStorage-backed), per-record PDFs |
| `/approach`  | Editorial deep-dive: architecture, preprocessing, training, live mode, stack    |
| `/evaluation`| 8 Chart.js dashboards — loss, accuracy, PR, confusion, mAP, F1, ROC, latency    |
| `/dataset`   | Class distribution, samples, annotation format, augmentations, stats table       |

---

## APIs

| Method | Route                       | Purpose |
|--------|-----------------------------|---------|
| `GET`  | `/health`                   | `{ status, model_loaded, torch, live_available, ... }` |
| `POST` | `/predict`                  | multipart `image` + form `threshold` → `{ detections, all_scores, inference_time_ms, image_size, image_url }` |
| `POST` | `/auth/signup`              | `{ username, email, password }` → session cookie |
| `POST` | `/auth/login`               | `{ username, password }` → session cookie |
| `POST` | `/auth/logout`              | clears session |
| `GET`  | `/auth/me`                  | current user or 401 |
| `GET`  | `/live`                     | render Live Surveillance page |
| `POST` | `/live/start`               | start camera + YOLO loop on `camera_index` |
| `POST` | `/live/stop`                | stop the loop |
| `GET`  | `/live/status`              | `{ running, fps, frame_count, recent_detections, recent_snapshots, ... }` |
| `GET`  | `/live/stream.mjpg`         | `multipart/x-mixed-replace` MJPEG stream |
| `GET`  | `/live/snapshots/<file>`    | serve a saved threat snapshot |
| `GET`  | `/uploads/<file>`           | serve a previously uploaded classifier image |

---

## Stack

Deliberately small. No SPA framework, no bundler, no build step — just the libraries that earn their place.

| Layer | Tools |
|---|---|
| Backend | Flask · Werkzeug · Jinja2 |
| ML (single-image) | PyTorch · torchvision |
| ML (live) | Ultralytics (YOLOv8) · OpenCV |
| Frontend | Vanilla JS · CSS custom properties · `[hidden]` for show/hide |
| Typography | Orbitron (display) + IBM Plex Mono (body/data) — Google Fonts |
| Charts | Chart.js (CDN) |
| PDF reports | jsPDF (CDN, lazy-loaded) |
| Auth | Flask sessions + `users.json` (hashed passwords) |
| History | Browser `localStorage` (200-record cap) |

---

## Components & key modules

| File | What it does |
|---|---|
| `website/app.py` | Flask app: pages, `/predict`, `/auth/*`, `/live/*`, `/health` |
| `website/live_detection.py` | `LiveDetector` class: lazy-imports torch/cv2/ultralytics, owns the camera thread, exposes MJPEG generator + JSON status, saves auto-snapshots with per-class cooldown |
| `config.py` | Image size (224), normalization mean/std, classes, paths |
| `utils.py` | Preprocessing helpers reused between the notebook and `/predict` |
| `model/Training_Methodology.ipynb` | Real notebook documenting training |
| `static/js/main.js` | Reveal-on-scroll, navbar scroll-state, modal helpers, custom cursor, auth flow |
| `static/js/detection.js` | Upload zone, threshold slider, `/predict` call, analysis card, **PDF report** generator |
| `static/js/dashboard.js` | localStorage history, filters, modal viewer, **PDF re-download** |
| `static/js/live.js` | Start/stop controls, MJPEG cache-bust, 1-Hz `/live/status` polling, snapshot grid refresh |
| `static/js/charts.js` | All 8 evaluation charts |
| `static/css/main.css` | Theme tokens, navbar, footer, buttons, sonar/radar SVG animations, modal |

---

## Running locally

```powershell
cd Marine-Threat-Detection\BackEnd\Marine-Threat-Detection
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install ultralytics opencv-python    # only needed for /live
```

Drop the trained `best_model.pth` into `model/` (and optionally `final/` as a fallback), then:

```powershell
python website\app.py
```

Open http://localhost:5000.

The first time you click ▶ Start Stream on `/live`, Ultralytics will download `yolov8n.pt` (~6 MB) from its CDN and cache it for subsequent runs.

---

## Notes

- **Two classifiers, by design.** The custom `.pth` model is binary (`threat` / `not threat`). YOLOv8 brings 80-class COCO detection to the live feed; we mark `boat` as a threat and just *draw* the other monitored classes (person, bicycle, bird, cat, dog, horse). To extend live threats to sharks/eels/etc., you'd need a custom-trained YOLO model.
- **PDF reports** include the verdict banner (color-coded), embedded image, plain-language reasoning paragraph, per-class probability bars, and a meta footer (threshold, inference time, image size, filename). Generated client-side via jsPDF — nothing leaves the browser.
- **`users.json`** stores hashed passwords (Werkzeug `generate_password_hash`). Auto-created on first signup. Add it to `.gitignore` if you commit.
- **`weights_only=False`** on `torch.load` because `best_model.pth` is a full `nn.Module` pickle, not a state-dict. We trust this file because it's the team's own checkpoint.
- The dataset (875 images) and the classifier weights both came from the team's Google Drive — see `model/Dataset/readme.md` and `website/thebest_model.md` for the original links.
