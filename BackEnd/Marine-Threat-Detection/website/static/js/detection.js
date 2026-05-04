/* ============================================================
   DETECTION CONSOLE
   Upload → POST /predict → render bbox overlay + summary
   ============================================================ */

(function () {
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const thresholdInput = document.getElementById('threshold');
  const thresholdValue = document.getElementById('threshold-value');
  const runBtn = document.getElementById('run-btn');
  const canvasWrap = document.getElementById('canvas-wrap');
  const placeholder = document.getElementById('canvas-placeholder');
  const detectionsEl = document.getElementById('detections');
  const analysisCard = document.getElementById('analysis-card');
  const errorCard = document.getElementById('error-card');
  const inferenceTime = document.getElementById('inference-time');
  const inferenceMs = document.getElementById('inference-ms');
  const resultsActions = document.getElementById('results-actions');
  const saveBtn = document.getElementById('save-btn');
  const reportBtn = document.getElementById('report-btn');
  const healthTag = document.getElementById('health-tag');

  let currentFile = null;
  let lastResult = null;

  // --- health ping ---------------------------------------------------
  fetch('/health').then(r => r.ok ? r.json() : null).then(d => {
    if (!d) { healthTag.textContent = 'Backend: offline'; healthTag.classList.add('tag--threat'); return; }
    healthTag.textContent = `Model: ${d.model_loaded ? 'loaded' : 'not loaded'}`;
    healthTag.classList.add(d.model_loaded ? 'tag--safe' : 'tag--amber');
  }).catch(() => { healthTag.textContent = 'Backend: offline'; healthTag.classList.add('tag--threat'); });

  // --- threshold slider ---------------------------------------------
  const updateThreshold = () => {
    const v = parseFloat(thresholdInput.value);
    thresholdValue.textContent = v.toFixed(2);
    thresholdInput.style.setProperty('--p', `${v * 100}%`);
  };
  thresholdInput.addEventListener('input', updateThreshold);
  updateThreshold();

  // --- file pick / drag-drop ----------------------------------------
  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) {
      showError('Please drop an image file (JPG / PNG / BMP).');
      return;
    }
    currentFile = file;
    runBtn.disabled = false;
    showImagePreview(file);
    detectionsEl.innerHTML = '';
    if (analysisCard) { analysisCard.hidden = true; analysisCard.innerHTML = ''; }
    resultsActions.hidden = true;
    inferenceTime.hidden = true;
    hideError();
  };

  const showImagePreview = (file) => {
    canvasWrap.innerHTML = '';
    const stack = document.createElement('div');
    stack.className = 'canvas-img-stack';
    const img = document.createElement('img');
    img.alt = 'preview';
    img.id = 'preview-img';
    const canvas = document.createElement('canvas');
    canvas.id = 'overlay-canvas';
    stack.appendChild(img);
    stack.appendChild(canvas);
    canvasWrap.appendChild(stack);

    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    };
    img.src = URL.createObjectURL(file);
  };

  fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

  ['dragenter', 'dragover'].forEach((evt) => uploadZone.addEventListener(evt, (e) => {
    e.preventDefault(); uploadZone.classList.add('is-hover');
  }));
  ['dragleave', 'drop'].forEach((evt) => uploadZone.addEventListener(evt, (e) => {
    e.preventDefault(); uploadZone.classList.remove('is-hover');
  }));
  uploadZone.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  });

  // --- run inference ------------------------------------------------
  runBtn.addEventListener('click', async () => {
    if (!currentFile) return;
    hideError();
    runBtn.classList.add('is-loading');
    runBtn.disabled = true;
    runBtn.querySelector('span').textContent = 'Analyzing...';

    try {
      const fd = new FormData();
      fd.append('image', currentFile);
      fd.append('threshold', thresholdInput.value);

      const res = await fetch('/predict', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`);

      lastResult = data;
      renderResult(data);
    } catch (err) {
      showError(err.message);
    } finally {
      runBtn.classList.remove('is-loading');
      runBtn.disabled = false;
      runBtn.querySelector('span').textContent = 'Run Detection';
    }
  });

  // --- render bboxes + cards ----------------------------------------
  const severityFor = (label, conf) => {
    if (!label) return 'safe';
    const l = label.toLowerCase();
    if (l.includes('threat') || l === 'shark' || l === 'eel' || l.includes('snake') || l.includes('mine')) return 'threat';
    if (conf < 0.6) return 'warning';
    return 'safe';
  };

  const colorFor = (severity) => ({ threat: '#ff3b3b', warning: '#f5b400', safe: '#2ad48f', cyan: '#00d4ff' }[severity] || '#00d4ff');

  // Build the human-readable verdict + reasoning shown in the analysis card
  // and embedded into the PDF report. Pure presentation logic — no network.
  const buildAnalysis = (data) => {
    const dets = data.detections || [];
    const scores = data.all_scores || {};
    const top = dets[0] || { label: 'unknown', confidence: 0 };
    const verdict = String(top.label || 'unknown').toLowerCase();
    const isThreat = verdict === 'threat' || /shark|eel|snake|mine/.test(verdict);
    const conf = top.confidence || 0;
    const confPct = (conf * 100).toFixed(1);

    let confidenceTier;
    if (conf >= 0.9) confidenceTier = 'very high';
    else if (conf >= 0.75) confidenceTier = 'high';
    else if (conf >= 0.6) confidenceTier = 'moderate';
    else confidenceTier = 'low';

    const reasoning = isThreat
      ? `The classifier assigned the input image to the "threat" class with ${confPct}% confidence (${confidenceTier}). ` +
        `Threats covered by this model include marine species that pose risk to humans (sharks, eels, sea snakes), ` +
        `as well as anomalous floating objects. Recommend escalating to a human reviewer if the scene contains beach-goers or divers.`
      : `The classifier assigned the input image to the "not threat" class with ${confPct}% confidence (${confidenceTier}). ` +
        `Visual signature is consistent with safe marine scenes (open water, vessels at distance, benign wildlife). ` +
        `No further action recommended unless context (e.g. proximity to swim zones) indicates otherwise.`;

    return {
      verdict: isThreat ? 'THREAT' : 'NOT THREAT',
      isThreat,
      confidence: conf,
      confidencePct: confPct,
      confidenceTier,
      reasoning,
      scores,
      threshold: data.threshold,
      inferenceMs: data.inference_time_ms,
      imageSize: data.image_size,
      timestamp: data.timestamp || new Date().toISOString(),
    };
  };

  const renderAnalysis = (a) => {
    if (!analysisCard) return;
    const scoreRows = Object.entries(a.scores)
      .sort((x, y) => y[1] - x[1])
      .map(([cls, p]) => `
        <div class="analysis-bar">
          <span class="analysis-bar__label">${cls.toUpperCase()}</span>
          <div class="analysis-bar__track">
            <div class="analysis-bar__fill ${cls === 'threat' ? 'threat' : 'safe'}" style="width:${(p * 100).toFixed(1)}%"></div>
          </div>
          <span class="analysis-bar__pct">${(p * 100).toFixed(1)}%</span>
        </div>
      `).join('');

    analysisCard.innerHTML = `
      <div class="analysis-card__head ${a.isThreat ? 'threat' : 'safe'}">
        <div class="analysis-card__verdict">
          <span class="analysis-card__dot"></span>
          <span class="analysis-card__verdict-label">VERDICT</span>
          <strong>${a.verdict}</strong>
        </div>
        <div class="analysis-card__conf">${a.confidencePct}% <span>${a.confidenceTier}</span></div>
      </div>
      <p class="analysis-card__reasoning">${a.reasoning}</p>
      <div class="analysis-card__scores">${scoreRows}</div>
    `;
    analysisCard.classList.toggle('threat', a.isThreat);
    analysisCard.hidden = false;
  };

  const renderResult = (data) => {
    const dets = data.detections || [];
    const canvas = document.getElementById('overlay-canvas');
    const img = document.getElementById('preview-img');
    if (canvas && img) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // animate bboxes in
      dets.forEach((d, i) => {
        const [x1, y1, x2, y2] = d.bbox;
        const sev = severityFor(d.label, d.confidence);
        const col = colorFor(sev);
        const start = performance.now();
        const dur = 320;
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
        const animate = (now) => {
          const t = Math.min((now - start) / dur, 1);
          const eased = 1 - Math.pow(1 - t, 3);
          const w = (x2 - x1) * eased;
          const h = (y2 - y1) * eased;
          ctx.save();
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(2, canvas.width / 320);
          ctx.shadowColor = col;
          ctx.shadowBlur = 10;
          ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
          if (t === 1) {
            // label tag
            ctx.fillStyle = col;
            ctx.shadowBlur = 0;
            const label = `${d.label.toUpperCase()} ${d.confidence.toFixed(2)}`;
            ctx.font = `${Math.max(11, canvas.width / 80)}px IBM Plex Mono, monospace`;
            const padX = 6, padY = 4;
            const tw = ctx.measureText(label).width;
            ctx.fillRect(x1, y1 - 22, tw + padX * 2, 22);
            ctx.fillStyle = '#050a16';
            ctx.fillText(label, x1 + padX, y1 - 6);
          }
          ctx.restore();
          if (t < 1) requestAnimationFrame(animate);
        };
        setTimeout(() => requestAnimationFrame(animate), i * 100);
      });
    }

    // Detection cards
    detectionsEl.innerHTML = '';
    if (!dets.length) {
      detectionsEl.innerHTML = '<div class="detection-card safe"><span class="detection-card__label">No detections above threshold</span></div>';
    } else {
      dets.forEach((d) => {
        const sev = severityFor(d.label, d.confidence);
        const card = document.createElement('div');
        card.className = `detection-card ${sev}`;
        card.innerHTML = `
          <span class="detection-card__label">${d.label.toUpperCase()}</span>
          <span class="detection-card__conf">${(d.confidence * 100).toFixed(1)}%</span>
        `;
        detectionsEl.appendChild(card);
      });
    }

    // Threat-analysis card (verdict + reasoning + per-class score bars)
    renderAnalysis(buildAnalysis(data));

    inferenceMs.textContent = `${data.inference_time_ms} ms`;
    inferenceTime.hidden = false;
    resultsActions.hidden = false;
  };

  // --- save to dashboard (localStorage) -----------------------------
  saveBtn.addEventListener('click', async () => {
    if (!lastResult || !currentFile) return;
    const dataUrl = await fileToDataUrl(currentFile);
    const record = {
      id: 'mts_' + Date.now(),
      timestamp: new Date().toISOString(),
      thumbnail: dataUrl,
      detections: lastResult.detections,
      all_scores: lastResult.all_scores || {},
      inference_time_ms: lastResult.inference_time_ms,
      image_size: lastResult.image_size,
      threshold: parseFloat(thresholdInput.value),
    };
    const key = 'mts_history';
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    list.unshift(record);
    localStorage.setItem(key, JSON.stringify(list.slice(0, 200))); // cap at 200
    saveBtn.textContent = '✓ Saved';
    setTimeout(() => (saveBtn.textContent = 'Save to Dashboard'), 1600);
  });

  // Lazy-load jsPDF only when the user clicks Download. Cached after first use.
  let jsPdfPromise = null;
  function loadJsPDF() {
    if (jsPdfPromise) return jsPdfPromise;
    jsPdfPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
      s.onload = () => resolve(window.jspdf?.jsPDF);
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return jsPdfPromise;
  }

  reportBtn.addEventListener('click', async () => {
    if (!lastResult || !currentFile) return;
    const original = reportBtn.textContent;
    reportBtn.textContent = 'Generating PDF…';
    reportBtn.disabled = true;
    try {
      const jsPDF = await loadJsPDF();
      if (!jsPDF) throw new Error('Failed to load PDF library');
      const a = buildAnalysis(lastResult);
      const dataUrl = await fileToDataUrl(currentFile);

      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 40;

      // Header band
      doc.setFillColor(5, 14, 28);
      doc.rect(0, 0, pageW, 70, 'F');
      doc.setTextColor(0, 212, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('MARINE THREAT SURVEILLANCE', margin, 32);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(180, 200, 220);
      doc.text('Inference Report', margin, 50);
      doc.text(new Date(a.timestamp).toLocaleString(), pageW - margin, 50, { align: 'right' });

      // Verdict banner
      const isT = a.isThreat;
      doc.setFillColor(...(isT ? [255, 59, 59] : [42, 212, 143]));
      doc.rect(margin, 90, pageW - margin * 2, 50, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.text(`VERDICT: ${a.verdict}`, margin + 16, 122);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.text(`${a.confidencePct}%  (${a.confidenceTier})`, pageW - margin - 16, 122, { align: 'right' });

      // Image embed (scaled to fit 460pt wide max)
      let imgY = 165;
      try {
        const props = doc.getImageProperties(dataUrl);
        const maxW = pageW - margin * 2;
        const maxH = 280;
        let drawW = maxW, drawH = (props.height * drawW) / props.width;
        if (drawH > maxH) { drawH = maxH; drawW = (props.width * drawH) / props.height; }
        const fmt = (props.fileType || 'JPEG').toUpperCase();
        doc.addImage(dataUrl, fmt, margin, imgY, drawW, drawH);
        imgY += drawH + 20;
      } catch (e) {
        imgY += 6;
      }

      // Reasoning section
      doc.setTextColor(20, 28, 44);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('ANALYSIS', margin, imgY);
      imgY += 8;
      doc.setDrawColor(0, 212, 255);
      doc.line(margin, imgY, margin + 60, imgY);
      imgY += 16;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      doc.setTextColor(45, 55, 72);
      const split = doc.splitTextToSize(a.reasoning, pageW - margin * 2);
      doc.text(split, margin, imgY);
      imgY += split.length * 14 + 14;

      // Per-class scores
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(20, 28, 44);
      doc.text('PER-CLASS PROBABILITIES', margin, imgY);
      imgY += 8;
      doc.setDrawColor(0, 212, 255);
      doc.line(margin, imgY, margin + 60, imgY);
      imgY += 18;
      doc.setFontSize(10);
      const barW = pageW - margin * 2 - 180;
      Object.entries(a.scores).sort((x, y) => y[1] - x[1]).forEach(([cls, p]) => {
        doc.setTextColor(60, 70, 90);
        doc.text(cls.toUpperCase(), margin, imgY);
        // bar background
        doc.setFillColor(230, 235, 240);
        doc.rect(margin + 110, imgY - 9, barW, 11, 'F');
        // bar fill
        const isThreatBar = cls.toLowerCase() === 'threat';
        doc.setFillColor(...(isThreatBar ? [255, 59, 59] : [42, 212, 143]));
        doc.rect(margin + 110, imgY - 9, barW * p, 11, 'F');
        // pct
        doc.setTextColor(20, 28, 44);
        doc.text(`${(p * 100).toFixed(1)}%`, pageW - margin, imgY, { align: 'right' });
        imgY += 22;
      });

      // Meta footer
      imgY += 6;
      doc.setDrawColor(220, 226, 234);
      doc.line(margin, imgY, pageW - margin, imgY);
      imgY += 16;
      doc.setFontSize(9);
      doc.setTextColor(80, 90, 110);
      const meta = [
        `Threshold: ${(a.threshold ?? 0.5).toFixed(2)}`,
        `Inference time: ${a.inferenceMs} ms`,
        `Image size: ${a.imageSize?.[0]} x ${a.imageSize?.[1]} px`,
        `Filename: ${currentFile.name}`,
      ];
      meta.forEach((line) => { doc.text(line, margin, imgY); imgY += 13; });

      // Page footer
      doc.setFontSize(8);
      doc.setTextColor(140, 150, 170);
      doc.text('Generated by MTS — Flask + PyTorch • Report is a model output, not a substitute for human review.',
               pageW / 2, pageH - 24, { align: 'center' });

      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      doc.save(`mts_report_${ts}.pdf`);
    } catch (e) {
      showError(`PDF generation failed: ${e.message}`);
    } finally {
      reportBtn.textContent = original;
      reportBtn.disabled = false;
    }
  });

  // --- helpers ------------------------------------------------------
  function showError(msg) {
    errorCard.textContent = msg;
    errorCard.classList.add('show');
  }
  function hideError() {
    errorCard.classList.remove('show');
    errorCard.textContent = '';
  }
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
})();
