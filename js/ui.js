/* ============================================================
   ui.js — UI Helpers (status, timer, visualizer,
           per-speaker analysis cards, sentiment charts)
   ============================================================ */

const UI = (() => {
    'use strict';

    // ── DOM refs (cached on init) ──
    let els = {};

    // Chart instances — destroyed before re-render
    const _charts = {};

    function cacheElements() {
        els = {
            statusDot: document.getElementById('statusDot'),
            statusText: document.getElementById('statusText'),
            timer: document.getElementById('timer'),
            viz: document.getElementById('viz'),
            statWords: document.getElementById('statWords'),
            statEntries: document.getElementById('statEntries'),
            statSpeakers: document.getElementById('statSpeakers'),
            statDuration: document.getElementById('statDuration'),
            toneSummary: document.getElementById('toneSummary'),
            toneBars: document.getElementById('toneBars'),
            recordBtn: document.getElementById('recordBtn'),
            speakerList: document.getElementById('speakerList'),
            summaryContent: document.getElementById('summaryContent'),
            keypointsList: document.getElementById('keypointsList'),
            emotionCharts: document.getElementById('emotionChartsSection'),
        };
        console.log('[UI] Elements cached');
    }

    // ── Status badge ──
    function setStatus(text, isRecording) {
        els.statusText.textContent = text;
        els.statusDot.className = 'status-dot' + (isRecording ? ' recording' : '');
    }

    // ── Record button ──
    function setRecordButton(recording) {
        if (recording) {
            els.recordBtn.className = 'record-btn stop';
            els.recordBtn.innerHTML = '<span>⏹</span> Stop Recording';
        } else {
            els.recordBtn.className = 'record-btn start';
            els.recordBtn.innerHTML = '<span>⏺</span> Start Recording';
        }
    }

    // ── Timer ──
    let _timerInterval = null;
    let _startTime = null;
    let _elapsed = 0;

    function startTimer() {
        _startTime = Date.now();
        _timerInterval = setInterval(() => {
            const s = Math.floor((_elapsed + (Date.now() - _startTime)) / 1000);
            const m = String(Math.floor(s / 60)).padStart(2, '0');
            const sec = String(s % 60).padStart(2, '0');
            els.timer.textContent = `${m}:${sec}`;
            els.statDuration.textContent = `${Math.floor(s / 60)}m`;
        }, 1000);
    }

    function stopTimer() {
        if (_startTime !== null) {
            _elapsed += Date.now() - _startTime;
            _startTime = null;
        }
        clearInterval(_timerInterval);
        _timerInterval = null;
    }

    function resetTimer() {
        stopTimer();
        _elapsed = 0;
        els.timer.textContent = '—';
        els.statDuration.textContent = '0m';
    }

    // ── Stats ──
    function updateStats(wordCount, entryCount, speakerCount, toneCounts) {
        els.statWords.textContent = wordCount;
        els.statEntries.textContent = entryCount;
        els.statSpeakers.textContent = speakerCount;

        const toneEmoji = { neutral: '😐', happy: '😊', excited: '🤩', angry: '😠', sad: '😢', confused: '😕', serious: '🎯' };
        const toneColors = { neutral: '#94a3b8', happy: '#fbbf24', excited: '#f97316', angry: '#ef4444', sad: '#60a5fa', confused: '#a78bfa', serious: '#6b7280' };

        const total = entryCount;
        if (total > 0 && Object.keys(toneCounts).length > 0) {
            els.toneSummary.style.display = 'block';
            const sorted = Object.entries(toneCounts).sort((a, b) => b[1] - a[1]);
            els.toneBars.innerHTML = sorted.map(([tone, count]) => `
        <div class="tone-bar-row">
          <div class="tone-bar-label">${toneEmoji[tone] || ''} ${tone}</div>
          <div class="tone-bar-track">
            <div class="tone-bar-fill" style="width:${Math.round(count / total * 100)}%;background:${toneColors[tone] || '#888'}"></div>
          </div>
          <div class="tone-bar-count">${count}</div>
        </div>
      `).join('');
        }
    }

    // ── Speaker list ──
    function renderSpeakers(speakers, activeSpeakerId) {
        if (!speakers || speakers.length === 0) {
            els.speakerList.innerHTML = `
        <div style="font-size:0.7rem;color:var(--muted);text-align:center;padding:12px 0;">
          Speakers will appear here automatically when you record.
        </div>`;
            return;
        }
        els.speakerList.innerHTML = speakers.map(s => {
            const isActive = s.id === activeSpeakerId;
            return `
        <div class="speaker-item">
          <div class="speaker-color" style="background:${s.color}"></div>
          <input class="speaker-name" value="${s.name}" placeholder="Name..."
            onchange="Orca.renameSpeaker(${s.id}, this.value)">
          ${isActive ? '<span class="speaker-active-badge">speaking</span>' : ''}
          <span class="speaker-count-badge">${s.count || 0} entries</span>
        </div>`;
        }).join('');
    }

    // ── Visualizer ──
    let _animFrame = null;

    function drawVisualizer(analyser) {
        if (!analyser) return;
        const canvas = els.viz;
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        const buf = new Uint8Array(analyser.frequencyBinCount);

        function draw() {
            _animFrame = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(buf);
            ctx.clearRect(0, 0, W, H);
            const barW = (W / buf.length) * 2.5;
            let x = 0;
            for (let i = 0; i < buf.length; i++) {
                const h = (buf[i] / 255) * H;
                const alpha = 0.4 + (buf[i] / 255) * 0.6;
                ctx.fillStyle = `rgba(0,229,255,${alpha})`;
                ctx.fillRect(x, H - h, barW - 1, h);
                x += barW;
            }
        }
        draw();
    }

    function stopVisualizer() {
        if (_animFrame) {
            cancelAnimationFrame(_animFrame);
            _animFrame = null;
        }
        const ctx = els.viz.getContext('2d');
        ctx.clearRect(0, 0, els.viz.width, els.viz.height);
    }

    // ── Modal (legacy — kept for HTML compatibility) ──
    function showApiKeyModal() { /* no-op: Gemini removed */ }
    function hideApiKeyModal() { /* no-op */ }

    // ── Loading state ──
    function showLoading(message) {
        els.summaryContent.innerHTML = `
      <div class="summary-loading">
        <span>✦ ${message || 'Analyzing'}</span>
        <div class="loading-dots"><span>.</span><span>.</span><span>.</span></div>
      </div>`;
        els.keypointsList.innerHTML = '';
        if (els.emotionCharts) els.emotionCharts.innerHTML = '';
    }

    // ── Enable / disable AI buttons ──
    function enableAIButtons() {
        ['summarizeBtn', 'keypointsBtn', 'toneBtn'].forEach(id => {
            document.getElementById(id).disabled = false;
        });
    }

    function disableAIButtons() {
        ['summarizeBtn', 'keypointsBtn', 'toneBtn'].forEach(id => {
            document.getElementById(id).disabled = true;
        });
    }

    // ══════════════════════════════════════════════════════
    //  RENDER SUMMARY ONLY (called when Summarize button clicked)
    // ══════════════════════════════════════════════════════

    function renderAnalysis(result) {
        if (!result) return;
        // Clear key points and charts — summary view only shows the summary
        els.keypointsList.innerHTML = '';
        if (els.emotionCharts) els.emotionCharts.innerHTML = '';

        const summaryText = result.globalSummary || 'No summary available.';
        els.summaryContent.innerHTML = `<p class="analysis-global-text">${esc(summaryText)}</p>`;
    }

    // ══════════════════════════════════════════════════════
    //  RENDER KEY POINTS (called when Key Points button clicked)
    // ══════════════════════════════════════════════════════

    function renderKeyPoints(result) {
        if (!result) return;
        // Clear summary text and charts
        els.summaryContent.innerHTML = '';
        if (els.emotionCharts) els.emotionCharts.innerHTML = '';

        let html = '';

        // Per-speaker key points
        if (result.perSpeaker && result.perSpeaker.length > 0) {
            html += `<div class="speaker-cards">`;
            result.perSpeaker.forEach(sp => {
                const kps = sp.keypoints && sp.keypoints.length > 0
                    ? sp.keypoints.map(p => `<li>${esc(p)}</li>`).join('')
                    : `<li style="color:var(--muted)">No key points extracted.</li>`;
                html += `
          <div class="speaker-card">
            <div class="speaker-card-header">
              <div class="speaker-card-dot" style="background:${sp.color}"></div>
              <div class="speaker-card-name">${esc(sp.name)}</div>
              <div class="speaker-card-stats">${sp.entryCount} statements · ~${sp.wordCount} words</div>
            </div>
            <div class="speaker-card-body">
              <ul class="speaker-keypoints">${kps}</ul>
            </div>
          </div>`;
            });
            html += `</div>`;
        }

        // Global key points section
        if (result.globalKeypoints && result.globalKeypoints.length > 0) {
            html += `
        <div class="keypoints">
          <div class="keypoints-title">🔑 Top Key Points</div>
          ${result.globalKeypoints.map((p, i) =>
                `<div class="keypoint-item"><div class="keypoint-num">${i + 1}.</div><div>${esc(p)}</div></div>`
            ).join('')}
        </div>`;
        }

        if (!html) {
            html = `<p style="color:var(--muted);font-size:0.78rem;padding:4px 0;">No key points extracted yet.</p>`;
        }

        els.keypointsList.innerHTML = html;
    }

    // ══════════════════════════════════════════════════════
    //  RENDER EMOTION / SENTIMENT CHARTS  (speaker dropdown)
    // ══════════════════════════════════════════════════════

    function renderEmotionCharts(timeline, speakers) {
        if (!els.emotionCharts) return;
        // Clear summary and key points — chart view is exclusive
        els.summaryContent.innerHTML = '';
        els.keypointsList.innerHTML = '';

        if (!timeline || timeline.length === 0) {
            els.emotionCharts.innerHTML = '<p style="color:var(--muted);font-size:0.75rem;padding:8px 0;">No sentiment data available.</p>';
            return;
        }

        // Destroy existing chart instances
        Object.values(_charts).forEach(c => { try { c.destroy(); } catch (_) { } });
        Object.keys(_charts).forEach(k => delete _charts[k]);

        // Group timeline by speaker
        const bySpeaker = {};
        timeline.forEach(pt => {
            if (!bySpeaker[pt.speakerName]) bySpeaker[pt.speakerName] = [];
            bySpeaker[pt.speakerName].push(pt);
        });

        const speakerNames = Object.keys(bySpeaker);
        if (speakerNames.length === 0) {
            els.emotionCharts.innerHTML = '';
            return;
        }

        const firstSpeaker = speakerNames[0];

        // Build dropdown + legend header
        const dropdownOptions = speakerNames.map((name, i) => {
            const color = bySpeaker[name][0]?.color || '#00e5ff';
            return `<option value="${esc(name)}" style="color:${color}">${esc(name)}</option>`;
        }).join('');

        let html = `
      <div class="emotion-charts-header">
        <div class="emotion-speaker-select-wrap">
          <select id="speakerChartSelect" class="emotion-speaker-select" onchange="UI._onSpeakerChartSelect(this.value)">
            ${dropdownOptions}
          </select>
        </div>
        <div class="emotion-charts-legend">
          <span class="emo-dot" style="background:#22c55e"></span>Positive&nbsp;&nbsp;
          <span class="emo-dot" style="background:#94a3b8"></span>Neutral&nbsp;&nbsp;
          <span class="emo-dot" style="background:#ef4444"></span>Negative
        </div>
      </div>
      <div id="emotionChartContainer"></div>`;

        els.emotionCharts.innerHTML = html;

        // Store data for switching via dropdown
        els.emotionCharts._bySpeaker = bySpeaker;

        // Render first speaker immediately
        _renderChartForSpeaker(firstSpeaker, bySpeaker[firstSpeaker]);
    }

    // Called by dropdown change
    function _onSpeakerChartSelect(name) {
        if (!els.emotionCharts || !els.emotionCharts._bySpeaker) return;
        const bySpeaker = els.emotionCharts._bySpeaker;
        if (!bySpeaker[name]) return;
        _renderChartForSpeaker(name, bySpeaker[name]);
    }

    function _renderChartForSpeaker(name, pts) {
        const container = document.getElementById('emotionChartContainer');
        if (!container) return;

        const color = pts[0]?.color || '#00e5ff';
        const safeId = 'chart_active_speaker';

        // Destroy previous chart if any
        if (_charts['__active__']) {
            try { _charts['__active__'].destroy(); } catch (_) { }
            delete _charts['__active__'];
        }

        container.innerHTML = `
      <div class="emotion-chart-wrap">
        <canvas id="${safeId}" class="emotion-canvas"></canvas>
      </div>`;

        const canvas = document.getElementById(safeId);
        if (!canvas) return;

        if (typeof Chart !== 'undefined') {
            const labels = pts.map(p => p.time || '');
            const scores = pts.map(p => p.score ?? 0);

            _charts['__active__'] = new Chart(canvas, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: name,
                        data: scores,
                        borderColor: color,
                        backgroundColor: 'transparent',
                        borderWidth: 2.5,
                        pointBackgroundColor: scores.map(s =>
                            s > 0.1 ? '#22c55e' : s < -0.1 ? '#ef4444' : '#94a3b8'
                        ),
                        pointBorderColor: 'transparent',
                        pointRadius: 4,
                        pointHoverRadius: 7,
                        tension: 0.4,
                        fill: false,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 500, easing: 'easeInOutQuart' },
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                title: (items) => `${items[0].label}`,
                                label: (item) => {
                                    const pt = pts[item.dataIndex];
                                    const sLabel = item.raw > 0.1 ? '😊 Positive' : item.raw < -0.1 ? '😟 Negative' : '😐 Neutral';
                                    return [`${sLabel} (${item.raw.toFixed(2)})`, pt?.text ? `"${pt.text.slice(0, 50)}…"` : ''];
                                },
                            },
                            backgroundColor: 'rgba(15,23,42,0.92)',
                            titleColor: '#e2e8f0',
                            bodyColor: '#94a3b8',
                            borderColor: 'rgba(255,255,255,0.08)',
                            borderWidth: 1,
                            padding: 10,
                        },
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255,255,255,0.04)' },
                            ticks: {
                                color: '#64748b',
                                font: { size: 10, family: 'JetBrains Mono' },
                                maxTicksLimit: 8,
                                maxRotation: 0,
                            },
                        },
                        y: {
                            min: -1,
                            max: 1,
                            grid: {
                                color: (ctx) => ctx.tick.value === 0
                                    ? 'rgba(148,163,184,0.25)'
                                    : 'rgba(255,255,255,0.04)',
                            },
                            ticks: {
                                color: '#64748b',
                                font: { size: 10 },
                                callback: (v) => v === 1 ? '+1 😊' : v === -1 ? '-1 😟' : v === 0 ? '0' : v.toFixed(1),
                            },
                        },
                    },
                },
            });
        } else {
            // Fallback canvas
            _renderFallbackChart(canvas, pts, color);
        }
    }

    function _renderFallbackChart(canvas, pts, color) {
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        const scores = pts.map(p => p.score ?? 0);
        const n = scores.length;
        if (n < 2) return;
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, H / 2);
        ctx.lineTo(W, H / 2);
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        scores.forEach((s, i) => {
            const x = (i / (n - 1)) * W;
            const y = H / 2 - (s * H / 2 * 0.85);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    // ── Escape HTML ──
    function esc(str = '') {
        return String(str).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    // ── Public API ──
    return {
        cacheElements,
        els: () => els,
        setStatus,
        setRecordButton,
        startTimer,
        stopTimer,
        resetTimer,
        updateStats,
        renderSpeakers,
        drawVisualizer,
        stopVisualizer,
        showApiKeyModal,
        hideApiKeyModal,
        showLoading,
        enableAIButtons,
        disableAIButtons,
        renderAnalysis,
        renderKeyPoints,
        renderEmotionCharts,
        _onSpeakerChartSelect,
    };
})();
