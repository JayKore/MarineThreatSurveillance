/* ============================================================
   EVALUATION CHARTS — Chart.js, dark naval theme
   ============================================================ */

(function () {
  if (!window.Chart) return;

  // ---- Theme defaults ------------------------------------------------
  Chart.defaults.color = '#6f7d92';
  Chart.defaults.font.family = 'IBM Plex Mono, monospace';
  Chart.defaults.font.size = 10;
  Chart.defaults.plugins.legend.labels.color = '#d3dcea';
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(5, 10, 22, 0.95)';
  Chart.defaults.plugins.tooltip.borderColor = '#00d4ff';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.titleColor = '#00d4ff';
  Chart.defaults.plugins.tooltip.bodyColor = '#d3dcea';
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 0;
  Chart.defaults.plugins.tooltip.titleFont = { family: 'Orbitron', size: 11 };

  const grid = { color: 'rgba(255,255,255,0.04)', drawBorder: false };
  const ticks = { color: '#6f7d92' };

  const baseOpts = (extra = {}) => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { grid, ticks },
      y: { grid, ticks }
    },
    ...extra
  });

  // ---- Synthetic data helpers ---------------------------------------
  const epochs = Array.from({ length: 25 }, (_, i) => i + 1);
  const decay = (s, e, n, jitter = 0.02) =>
    Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      const v = s + (e - s) * (1 - Math.exp(-3.5 * t));
      return +(v + (Math.random() - 0.5) * jitter).toFixed(3);
    });

  // ---- 1. LOSS -------------------------------------------------------
  new Chart(document.getElementById('chart-loss'), {
    type: 'line',
    data: {
      labels: epochs,
      datasets: [
        { label: 'Train Loss',      data: decay(1.6, 0.12, 25, 0.04), borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.08)', tension: 0.32, fill: true, pointRadius: 0, borderWidth: 2 },
        { label: 'Validation Loss', data: decay(1.5, 0.18, 25, 0.05), borderColor: '#ff6b35', backgroundColor: 'rgba(255,107,53,0.05)', tension: 0.32, fill: false, pointRadius: 0, borderWidth: 2 }
      ]
    },
    options: baseOpts({ scales: { x: { grid, ticks, title: { display: true, text: 'EPOCH', color: '#6f7d92' } }, y: { grid, ticks } } })
  });

  // ---- 2. ACCURACY ---------------------------------------------------
  const accGain = (s, e) => decay(s, e, 25, 0.01);
  new Chart(document.getElementById('chart-acc'), {
    type: 'line',
    data: {
      labels: epochs,
      datasets: [
        { label: 'Train Acc',      data: accGain(0.55, 0.97), borderColor: '#00d4ff', tension: 0.3, pointRadius: 0, borderWidth: 2, fill: false },
        { label: 'Validation Acc', data: accGain(0.52, 0.92), borderColor: '#ff6b35', tension: 0.3, pointRadius: 0, borderWidth: 2, fill: false }
      ]
    },
    options: baseOpts({ scales: { x: { grid, ticks, title: { display: true, text: 'EPOCH', color: '#6f7d92' } }, y: { grid, ticks, min: 0.4, max: 1 } } })
  });

  // ---- 3. PRECISION-RECALL ------------------------------------------
  const recall = Array.from({ length: 21 }, (_, i) => +(i / 20).toFixed(2));
  const prCurve = (a) => recall.map((r) => +Math.max(0.05, 0.99 - a * Math.pow(r, 2.4)).toFixed(3));
  new Chart(document.getElementById('chart-pr'), {
    type: 'line',
    data: {
      labels: recall,
      datasets: [
        { label: 'Vessel', data: prCurve(0.4), borderColor: '#00d4ff', pointRadius: 0, borderWidth: 2, tension: 0.2 },
        { label: 'Shark',  data: prCurve(0.7), borderColor: '#ff3b3b', pointRadius: 0, borderWidth: 2, tension: 0.2 },
        { label: 'Buoy',   data: prCurve(0.5), borderColor: '#2ad48f', pointRadius: 0, borderWidth: 2, tension: 0.2 }
      ]
    },
    options: baseOpts({ scales: { x: { grid, ticks, title: { display: true, text: 'RECALL', color: '#6f7d92' } }, y: { grid, ticks, title: { display: true, text: 'PRECISION', color: '#6f7d92' }, min: 0, max: 1 } } })
  });

  // ---- 4. CONFUSION MATRIX (custom grid) -----------------------------
  const confEl = document.getElementById('confusion');
  if (confEl) {
    const labels = ['Threat', 'Vessel', 'Marine Life', 'Debris'];
    const matrix = [
      [120, 6, 4, 2],
      [8, 102, 3, 5],
      [3, 5, 88, 4],
      [4, 6, 3, 57]
    ];
    confEl.style.gridTemplateColumns = `120px repeat(${labels.length}, 1fr)`;
    confEl.innerHTML = '';
    confEl.appendChild(cell('', 'h'));
    labels.forEach((l) => confEl.appendChild(cell(l, 'h')));
    matrix.forEach((row, i) => {
      confEl.appendChild(cell(labels[i], 'h'));
      const max = Math.max(...row);
      row.forEach((v, j) => {
        const intensity = v / max;
        const isDiag = i === j;
        const c = document.createElement('div');
        c.className = 'cell';
        c.textContent = v;
        c.style.background = `rgba(${isDiag ? '0,212,255' : '255,107,53'}, ${0.06 + intensity * 0.45})`;
        c.style.color = isDiag ? '#fff' : '#d3dcea';
        confEl.appendChild(c);
      });
    });
    function cell(t, kind = '') {
      const c = document.createElement('div');
      c.className = 'cell ' + kind;
      c.textContent = t;
      return c;
    }
  }

  // ---- 5. mAP BY CLASS -----------------------------------------------
  const classNames = ['Vessel', 'Cargo', 'Shark', 'Eel', 'Sea Snake', 'Buoy', 'Debris', 'Patrol', 'Sub', 'Mine', 'Jellyfish', 'Other'];
  const maps = [0.91, 0.88, 0.79, 0.74, 0.69, 0.92, 0.81, 0.85, 0.62, 0.71, 0.66, 0.78];
  new Chart(document.getElementById('chart-map'), {
    type: 'bar',
    data: {
      labels: classNames,
      datasets: [{
        label: 'mAP',
        data: maps,
        backgroundColor: maps.map((m) => m > 0.85 ? '#00d4ff' : m > 0.7 ? '#4be0ff' : '#ff6b35'),
        borderColor: '#0a0f1e',
        borderWidth: 1
      }]
    },
    options: baseOpts({
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { grid, ticks, min: 0, max: 1 }, y: { grid, ticks } }
    })
  });

  // ---- 6. F1 vs THRESHOLD --------------------------------------------
  const thr = Array.from({ length: 21 }, (_, i) => +(i / 20).toFixed(2));
  const f1 = thr.map((t) => +(0.65 + 0.32 * Math.exp(-Math.pow((t - 0.55) * 4, 2))).toFixed(3));
  new Chart(document.getElementById('chart-f1'), {
    type: 'line',
    data: { labels: thr, datasets: [{ label: 'F1', data: f1, borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.1)', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 }] },
    options: baseOpts({ plugins: { legend: { display: false } }, scales: { x: { grid, ticks, title: { display: true, text: 'THRESHOLD', color: '#6f7d92' } }, y: { grid, ticks, min: 0.5, max: 1 } } })
  });

  // ---- 7. ROC --------------------------------------------------------
  const fpr = Array.from({ length: 21 }, (_, i) => +(i / 20).toFixed(2));
  const tpr = fpr.map((f) => +(1 - Math.exp(-4.2 * f)).toFixed(3));
  new Chart(document.getElementById('chart-roc'), {
    type: 'line',
    data: {
      labels: fpr,
      datasets: [
        { label: 'ROC', data: tpr, borderColor: '#ff6b35', backgroundColor: 'rgba(255,107,53,0.1)', fill: true, tension: 0.2, pointRadius: 0, borderWidth: 2 },
        { label: 'Random', data: fpr, borderColor: '#3a6892', borderDash: [4, 4], borderWidth: 1, pointRadius: 0 }
      ]
    },
    options: baseOpts({ scales: { x: { grid, ticks, title: { display: true, text: 'FPR', color: '#6f7d92' }, min: 0, max: 1 }, y: { grid, ticks, title: { display: true, text: 'TPR', color: '#6f7d92' }, min: 0, max: 1 } } })
  });

  // ---- 8. LATENCY HISTOGRAM ------------------------------------------
  const bins = ['80','100','120','140','160','180','200','220','260+'];
  const counts = [12, 38, 92, 142, 88, 51, 28, 14, 6];
  new Chart(document.getElementById('chart-latency'), {
    type: 'bar',
    data: { labels: bins, datasets: [{ label: 'Inferences', data: counts, backgroundColor: '#00d4ff', borderColor: '#0a0f1e', borderWidth: 1 }] },
    options: baseOpts({ plugins: { legend: { display: false } }, scales: { x: { grid, ticks, title: { display: true, text: 'MS', color: '#6f7d92' } }, y: { grid, ticks } } })
  });
})();
