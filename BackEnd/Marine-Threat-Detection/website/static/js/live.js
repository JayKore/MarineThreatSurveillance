// Live Surveillance — controls + status polling
// Talks to /live/start, /live/stop, /live/status. Image src is the MJPEG endpoint.

(function () {
  const startBtn = document.getElementById('liveStartBtn');
  const stopBtn = document.getElementById('liveStopBtn');
  const cameraSelect = document.getElementById('liveCamera');
  const streamImg = document.getElementById('liveStream');
  const pill = document.querySelector('[data-status-pill]');
  const activeThreatsEl = document.querySelector('[data-active-threats]');

  const stat = {
    status: document.querySelector('[data-stat-status]'),
    fps: document.querySelector('[data-stat-fps]'),
    frames: document.querySelector('[data-stat-frames]'),
    model: document.querySelector('[data-stat-model]'),
    conf: document.querySelector('[data-stat-conf]'),
    cam: document.querySelector('[data-stat-cam]'),
  };
  const hud = {
    fps: document.querySelector('[data-hud-fps]'),
    det: document.querySelector('[data-hud-det]'),
    cam: document.querySelector('[data-hud-cam]'),
  };
  const detList = document.querySelector('[data-detection-list]');
  const errorEl = document.querySelector('[data-last-error]');
  const snapshotGrid = document.querySelector('[data-snapshot-grid]');
  const snapCountEl = document.querySelector('[data-snap-count]');

  let pollHandle = null;
  let running = false;

  const streamPanel = document.querySelector('.live-stream');

  function setRunning(isRunning) {
    running = isRunning;
    startBtn.disabled = isRunning;
    stopBtn.disabled = !isRunning;
    cameraSelect.disabled = isRunning;
    pill.textContent = isRunning ? 'LIVE' : 'STANDBY';
    pill.classList.toggle('live-pill--running', isRunning);
    if (streamPanel) streamPanel.classList.toggle('is-running', isRunning);
  }

  async function startStream() {
    const cam = parseInt(cameraSelect.value, 10) || 0;
    startBtn.disabled = true;
    pill.textContent = 'STARTING…';
    try {
      const res = await fetch('/live/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ camera_index: cam }),
      });
      const data = await res.json();
      if (!data.success) {
        showError(data.message || 'Failed to start');
        startBtn.disabled = false;
        pill.textContent = 'STANDBY';
        return;
      }
      // Force a fresh MJPEG connection (busts cache)
      const baseSrc = streamImg.dataset.src;
      streamImg.src = baseSrc + (baseSrc.includes('?') ? '&' : '?') + 't=' + Date.now();
      setRunning(true);
      startPolling();
    } catch (e) {
      showError(String(e));
      startBtn.disabled = false;
    }
  }

  async function stopStream() {
    stopBtn.disabled = true;
    try {
      await fetch('/live/stop', { method: 'POST' });
    } catch (e) { /* ignore */ }
    setRunning(false);
    streamImg.removeAttribute('src');
  }

  function showError(msg) {
    errorEl.textContent = msg || '—';
    errorEl.classList.toggle('has-error', !!msg && msg !== '—');
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function renderDetections(list) {
    if (!list || !list.length) {
      detList.innerHTML = '<li class="live-detection-list__empty">No detections yet.</li>';
      return;
    }
    const html = list.slice().reverse().map(d => `
      <li class="${d.is_threat ? 'threat' : ''}">
        <span>${d.class_name}</span>
        <span class="conf">${(d.confidence * 100).toFixed(0)}%</span>
        <span class="badge">${d.is_threat ? 'THREAT' : 'OK'}</span>
      </li>
    `).join('');
    detList.innerHTML = html;
  }

  function renderSnapshots(list) {
    if (!list || !list.length) {
      snapshotGrid.innerHTML = '<div class="live-snapshots__empty">Threat detections trigger an auto-snapshot. They will appear here.</div>';
      snapCountEl.textContent = '0 captured';
      return;
    }
    snapCountEl.textContent = `${list.length} captured`;
    const html = list.slice().reverse().map(s => `
      <a class="live-snap" href="/live/snapshots/${s.filename}" target="_blank" rel="noopener">
        <img src="/live/snapshots/${s.filename}" alt="${s.threat_class}" loading="lazy" />
        <div class="live-snap__meta">
          <span>${s.threat_class}</span>
          <span class="conf">${(s.confidence * 100).toFixed(0)}%</span>
        </div>
      </a>
    `).join('');
    snapshotGrid.innerHTML = html;
  }

  async function poll() {
    try {
      const res = await fetch('/live/status', { cache: 'no-store' });
      if (!res.ok) return;
      const s = await res.json();

      stat.status.textContent = s.running ? 'LIVE' : 'IDLE';
      stat.fps.textContent = s.fps != null ? s.fps.toFixed(1) : '—';
      stat.frames.textContent = s.frame_count ?? '—';
      stat.model.textContent = s.model_name ?? '—';
      stat.conf.textContent = s.confidence_threshold != null ? s.confidence_threshold.toFixed(2) : '—';
      stat.cam.textContent = `Cam ${s.camera_index}`;

      hud.fps.textContent = `FPS ${s.fps != null ? s.fps.toFixed(1) : '—'}`;
      hud.det.textContent = `DET ${s.recent_detections.length}`;
      hud.cam.textContent = `CAM ${s.camera_index}`;

      const active = s.active_threats || 0;
      activeThreatsEl.textContent = `${active} ACTIVE`;
      activeThreatsEl.classList.toggle('live-pill--threat', active > 0);

      renderDetections(s.recent_detections);
      renderSnapshots(s.recent_snapshots);
      showError(s.last_error || '');

      if (s.running !== running) {
        setRunning(!!s.running);
      }
    } catch (e) {
      // Network blip — keep polling.
    }
  }

  function startPolling() {
    if (pollHandle) return;
    poll();
    pollHandle = setInterval(poll, 1000);
  }

  startBtn?.addEventListener('click', startStream);
  stopBtn?.addEventListener('click', stopStream);

  // Poll once on page load so the panel reflects current state even before
  // the user starts the stream (e.g. it was already running).
  startPolling();
})();
