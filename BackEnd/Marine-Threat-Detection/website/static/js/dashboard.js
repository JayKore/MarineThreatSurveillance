/* ============================================================
   DASHBOARD
   localStorage-driven history, filters, modal viewer
   ============================================================ */

(function () {
  const KEY = 'mts_history';
  const skeletons = document.getElementById('dashboard-skeletons');
  const grid = document.getElementById('history-grid');
  const empty = document.getElementById('empty-state');
  const filterFrom = document.getElementById('filter-from');
  const filterTo = document.getElementById('filter-to');
  const filterLevel = document.getElementById('filter-level');
  const filterClass = document.getElementById('filter-class');

  const recordModal = document.getElementById('record-modal');
  const recordTitle = document.getElementById('record-title');
  const recordImage = document.getElementById('record-image');
  const recordAnalysis = document.getElementById('record-analysis');
  const recordMeta = document.getElementById('record-meta');
  const recordPdfBtn = document.getElementById('record-pdf-btn');
  let activeRecord = null;

  const clearBtn = document.getElementById('clear-history-btn');
  const confirmModal = document.getElementById('confirm-clear');
  const confirmBtn = document.getElementById('confirm-clear-btn');

  // require auth: redirect home if not logged in
  fetch('/auth/me').then((r) => {
    if (!r.ok) {
      window.location.href = '/?auth=required';
    } else {
      // small delay to show skeletons briefly, feels less janky
      setTimeout(load, 220);
    }
  });

  let allRecords = [];

  function load() {
    allRecords = JSON.parse(localStorage.getItem(KEY) || '[]');
    populateClassFilter();
    render();
  }

  function populateClassFilter() {
    const set = new Set();
    allRecords.forEach((r) => (r.detections || []).forEach((d) => set.add(d.label)));
    [...set].sort().forEach((label) => {
      const opt = document.createElement('option');
      opt.value = label;
      opt.textContent = label;
      filterClass.appendChild(opt);
    });
  }

  function severityOf(rec) {
    const dets = rec.detections || [];
    const labels = dets.map((d) => (d.label || '').toLowerCase()).join(' ');
    if (/threat|shark|eel|snake|mine/.test(labels)) return 'threat';
    if (dets.some((d) => d.confidence < 0.6)) return 'warning';
    return 'safe';
  }

  function passesFilters(rec) {
    if (filterFrom.value) {
      if (new Date(rec.timestamp) < new Date(filterFrom.value)) return false;
    }
    if (filterTo.value) {
      const d = new Date(filterTo.value); d.setHours(23,59,59,999);
      if (new Date(rec.timestamp) > d) return false;
    }
    if (filterLevel.value && severityOf(rec) !== filterLevel.value) return false;
    if (filterClass.value && !(rec.detections || []).some((d) => d.label === filterClass.value)) return false;
    return true;
  }

  function render() {
    skeletons.hidden = true;
    const records = allRecords.filter(passesFilters);
    grid.innerHTML = '';

    if (!records.length) {
      grid.hidden = true;
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    grid.hidden = false;

    records.forEach((rec) => {
      const sev = severityOf(rec);
      const dt = new Date(rec.timestamp);
      const card = document.createElement('div');
      card.className = 'history-card';
      card.innerHTML = `
        <div class="history-card__thumb">
          <span class="history-card__badge ${sev}">${sev}</span>
          ${rec.thumbnail ? `<img src="${rec.thumbnail}" alt="">` : ''}
        </div>
        <div class="history-card__body">
          <div class="history-card__time">${dt.toLocaleString()}</div>
          <div class="history-card__count">${(rec.detections || []).length} detections</div>
        </div>
      `;
      card.addEventListener('click', () => openRecord(rec));
      grid.appendChild(card);
    });
  }

  [filterFrom, filterTo, filterLevel, filterClass].forEach((el) =>
    el.addEventListener('change', render)
  );

  // Re-build the analysis (verdict + reasoning) from a saved record. Mirrors
  // detection.js#buildAnalysis but operates on the localStorage record shape.
  function buildAnalysisFromRecord(rec) {
    const dets = rec.detections || [];
    const top = dets[0] || { label: 'unknown', confidence: 0 };
    const verdict = String(top.label || 'unknown').toLowerCase();
    const isThreat = verdict === 'threat' || /shark|eel|snake|mine/.test(verdict);
    const conf = top.confidence || 0;
    const confPct = (conf * 100).toFixed(1);
    let tier;
    if (conf >= 0.9) tier = 'very high';
    else if (conf >= 0.75) tier = 'high';
    else if (conf >= 0.6) tier = 'moderate';
    else tier = 'low';
    const reasoning = isThreat
      ? `The classifier assigned the input image to the "threat" class with ${confPct}% confidence (${tier}). ` +
        `Threats covered include marine species that pose risk to humans (sharks, eels, sea snakes), as well as anomalous floating objects.`
      : `The classifier assigned the input image to the "not threat" class with ${confPct}% confidence (${tier}). ` +
        `Visual signature is consistent with safe marine scenes.`;
    // If all_scores wasn't saved (old records), reconstruct from detections.
    let scores = rec.all_scores;
    if (!scores || !Object.keys(scores).length) {
      scores = {};
      dets.forEach((d) => { scores[d.label] = d.confidence; });
    }
    return {
      verdict: isThreat ? 'THREAT' : 'NOT THREAT',
      isThreat, confidence: conf, confidencePct: confPct, confidenceTier: tier,
      reasoning, scores, threshold: rec.threshold, inferenceMs: rec.inference_time_ms,
      imageSize: rec.image_size, timestamp: rec.timestamp,
    };
  }

  function renderAnalysisCard(target, a) {
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
    target.innerHTML = `
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
    target.classList.toggle('threat', a.isThreat);
  }

  function openRecord(rec) {
    activeRecord = rec;
    recordTitle.textContent = `Detection — ${new Date(rec.timestamp).toLocaleString()}`;

    recordImage.innerHTML = '';
    if (rec.thumbnail) {
      const img = document.createElement('img');
      img.src = rec.thumbnail;
      img.alt = 'detection';
      recordImage.appendChild(img);
    } else {
      recordImage.innerHTML = '<div class="muted" style="padding:2rem; text-align:center;">No image saved with this record.</div>';
    }

    renderAnalysisCard(recordAnalysis, buildAnalysisFromRecord(rec));

    recordMeta.innerHTML = `
      <div>Inference time: <strong>${rec.inference_time_ms ?? '—'} ms</strong></div>
      <div>Threshold: <strong>${(rec.threshold ?? 0.5).toFixed(2)}</strong></div>
      <div>Image size: <strong>${rec.image_size?.[0] ?? '—'} × ${rec.image_size?.[1] ?? '—'}</strong></div>
      <div>Detections: <strong>${(rec.detections || []).length}</strong></div>
    `;

    window.MTS.openModal('record-modal');
  }

  // PDF report — mirrors detection.js, sourced from the saved record.
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

  recordPdfBtn?.addEventListener('click', async () => {
    if (!activeRecord) return;
    const original = recordPdfBtn.textContent;
    recordPdfBtn.textContent = 'Generating…';
    recordPdfBtn.disabled = true;
    try {
      const jsPDF = await loadJsPDF();
      const a = buildAnalysisFromRecord(activeRecord);
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 40;

      doc.setFillColor(5, 14, 28);
      doc.rect(0, 0, pageW, 70, 'F');
      doc.setTextColor(0, 212, 255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
      doc.text('MARINE THREAT SURVEILLANCE', margin, 32);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.setTextColor(180, 200, 220);
      doc.text('Inference Report (archived)', margin, 50);
      doc.text(new Date(a.timestamp).toLocaleString(), pageW - margin, 50, { align: 'right' });

      doc.setFillColor(...(a.isThreat ? [255, 59, 59] : [42, 212, 143]));
      doc.rect(margin, 90, pageW - margin * 2, 50, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
      doc.text(`VERDICT: ${a.verdict}`, margin + 16, 122);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
      doc.text(`${a.confidencePct}%  (${a.confidenceTier})`, pageW - margin - 16, 122, { align: 'right' });

      let y = 165;
      if (activeRecord.thumbnail) {
        try {
          const props = doc.getImageProperties(activeRecord.thumbnail);
          const maxW = pageW - margin * 2; const maxH = 280;
          let dW = maxW, dH = (props.height * dW) / props.width;
          if (dH > maxH) { dH = maxH; dW = (props.width * dH) / props.height; }
          doc.addImage(activeRecord.thumbnail, (props.fileType || 'JPEG').toUpperCase(), margin, y, dW, dH);
          y += dH + 20;
        } catch (e) { y += 6; }
      }

      doc.setTextColor(20, 28, 44);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('ANALYSIS', margin, y);
      y += 8; doc.setDrawColor(0, 212, 255); doc.line(margin, y, margin + 60, y); y += 16;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
      doc.setTextColor(45, 55, 72);
      const split = doc.splitTextToSize(a.reasoning, pageW - margin * 2);
      doc.text(split, margin, y);
      y += split.length * 14 + 14;

      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20, 28, 44);
      doc.text('PER-CLASS PROBABILITIES', margin, y);
      y += 8; doc.line(margin, y, margin + 60, y); y += 18;
      doc.setFontSize(10);
      const barW = pageW - margin * 2 - 180;
      Object.entries(a.scores).sort((x, y) => y[1] - x[1]).forEach(([cls, p]) => {
        doc.setTextColor(60, 70, 90);
        doc.text(cls.toUpperCase(), margin, y);
        doc.setFillColor(230, 235, 240);
        doc.rect(margin + 110, y - 9, barW, 11, 'F');
        const isT = cls.toLowerCase() === 'threat';
        doc.setFillColor(...(isT ? [255, 59, 59] : [42, 212, 143]));
        doc.rect(margin + 110, y - 9, barW * p, 11, 'F');
        doc.setTextColor(20, 28, 44);
        doc.text(`${(p * 100).toFixed(1)}%`, pageW - margin, y, { align: 'right' });
        y += 22;
      });

      y += 6; doc.setDrawColor(220, 226, 234); doc.line(margin, y, pageW - margin, y); y += 16;
      doc.setFontSize(9); doc.setTextColor(80, 90, 110);
      [
        `Threshold: ${(a.threshold ?? 0.5).toFixed(2)}`,
        `Inference time: ${a.inferenceMs} ms`,
        `Image size: ${a.imageSize?.[0]} x ${a.imageSize?.[1]} px`,
        `Record id: ${activeRecord.id}`,
      ].forEach((line) => { doc.text(line, margin, y); y += 13; });

      doc.setFontSize(8); doc.setTextColor(140, 150, 170);
      doc.text('Generated by MTS — Flask + PyTorch • Report is a model output, not a substitute for human review.',
               pageW / 2, pageH - 24, { align: 'center' });

      const ts = new Date(a.timestamp).toISOString().replace(/[:.]/g, '-').slice(0, 19);
      doc.save(`mts_archive_${ts}.pdf`);
    } catch (e) {
      alert('PDF generation failed: ' + e.message);
    } finally {
      recordPdfBtn.textContent = original;
      recordPdfBtn.disabled = false;
    }
  });

  // --- clear history ------------------------------------------------
  clearBtn.addEventListener('click', () => window.MTS.openModal('confirm-clear'));
  confirmBtn.addEventListener('click', () => {
    localStorage.removeItem(KEY);
    window.MTS.closeModal(confirmModal);
    allRecords = [];
    render();
  });
})();
