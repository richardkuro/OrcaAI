/* ============================================================
   ui.js — UI Helpers (status, timer, visualizer, modals)
   ============================================================ */

const UI = (() => {
    'use strict';

    // ── DOM refs (cached on init) ──
    let els = {};

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
            apiKeyModal: document.getElementById('apiKeyModal'),
            apiKeyInput: document.getElementById('apiKeyInput'),
            summaryContent: document.getElementById('summaryContent'),
            keypointsList: document.getElementById('keypointsList'),
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
    let _elapsed = 0;     // ms accumulated before last pause

    function startTimer() {
        // If resuming after a pause, _elapsed already holds the previous time
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
        // Accumulate elapsed time so resume picks up from here
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
        // Clear canvas
        const ctx = els.viz.getContext('2d');
        ctx.clearRect(0, 0, els.viz.width, els.viz.height);
    }

    // ── Modal ──
    function showApiKeyModal() {
        els.apiKeyModal.classList.add('visible');
    }

    function hideApiKeyModal() {
        els.apiKeyModal.classList.remove('visible');
    }

    // ── Loading state ──
    function showLoading(message) {
        els.summaryContent.innerHTML = `
      <div class="summary-loading">
        <span>✦ ${message || 'Analyzing'}</span>
        <div class="loading-dots"><span>.</span><span>.</span><span>.</span></div>
      </div>`;
        els.keypointsList.innerHTML = '';
    }

    // ── Enable AI buttons ──
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
    };
})();
