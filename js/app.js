/* ============================================================
   app.js — Main entry point, state management, event wiring
   ============================================================ */

const Orca = (() => {
    'use strict';

    // ── Shared state ──
    let entries = [];
    let wordCount = 0;
    let toneCounts = {};
    let summary = null;
    let keypoints = [];

    // ── Init ──
    async function init() {
        console.group('[Orca] Initializing...');

        UI.cacheElements();
        await Recorder.loadMics();

        // Set up recorder callbacks
        Recorder.setCallbacks({
            onEntry: handleNewEntry,
            onInterim: handleInterim,
            onSpeakersChanged: handleSpeakersChanged,
        });

        // Wire up buttons
        document.getElementById('recordBtn').addEventListener('click', handleRecordClick);
        document.getElementById('pauseBtn').addEventListener('click', handlePauseClick);
        document.getElementById('clearBtn').addEventListener('click', clearAll);
        document.getElementById('summarizeBtn').addEventListener('click', doSummarize);
        document.getElementById('keypointsBtn').addEventListener('click', doKeyPoints);
        document.getElementById('toneBtn').addEventListener('click', doToneReport);

        // Text exports
        document.getElementById('exportTxtBtn').addEventListener('click', () => Export.asTxt(entries, summary, keypoints));
        document.getElementById('exportJsonBtn').addEventListener('click', () => Export.asJson(entries, summary, keypoints));
        document.getElementById('exportMdBtn').addEventListener('click', () => Export.asMarkdown(entries, summary, keypoints));

        // Audio exports (both panels)
        document.getElementById('exportWebmBtn').addEventListener('click', () => Recorder.downloadWebM());
        document.getElementById('exportMp3Btn').addEventListener('click', () => Recorder.downloadMP3());
        document.getElementById('exportWebmBtn2').addEventListener('click', () => Recorder.downloadWebM());
        document.getElementById('exportMp3Btn2').addEventListener('click', () => Recorder.downloadMP3());

        // Engine selector
        const engineSelect = document.getElementById('engineSelect');
        engineSelect.addEventListener('change', handleEngineChange);

        // Language selector
        document.getElementById('langSelect').addEventListener('change', (e) => {
            Recorder.setLanguage(e.target.value);
        });

        // Stop confirmation modal
        document.getElementById('cancelStopBtn').addEventListener('click', () => {
            document.getElementById('stopConfirmModal').classList.remove('visible');
        });
        document.getElementById('confirmStopBtn').addEventListener('click', () => {
            document.getElementById('stopConfirmModal').classList.remove('visible');
            doStop();
        });

        // Check browser speech support and update UI
        updateEngineNote();

        // ── DEMO MODE: API keys hardcoded ──
        const DEMO_DEEPGRAM_KEY = '8e44c11077a58f718d1b46940775d00534d7020c';
        const DEMO_GEMINI_KEY = 'AIzaSyBoIS4xgdArJNOxoO_0Hq116YEY1QBsHIw';

        // Auto-configure Deepgram (no prompt)
        const dgKey = sessionStorage.getItem('mm_deepgram_key') || DEMO_DEEPGRAM_KEY;
        DeepgramEngine.setApiKey(dgKey);
        sessionStorage.setItem('mm_deepgram_key', dgKey);
        console.log('[Orca] Deepgram configured (voice diarization enabled)');

        // Set Deepgram as default engine
        engineSelect.value = 'deepgram';
        Recorder.setEngine('deepgram');
        updateEngineNote();

        // Auto-configure Gemini (no modal)
        const geminiKey = sessionStorage.getItem('mm_api_key') || DEMO_GEMINI_KEY;
        AI.setApiKey(geminiKey);
        sessionStorage.setItem('mm_api_key', geminiKey);
        console.log('[Orca] Gemini key loaded (demo mode)');
        // Skip API key modal in demo mode
        // UI.showApiKeyModal();

        console.log('[Orca] Ready');
        console.groupEnd();
    }

    // ── Engine note/warning ──
    function updateEngineNote() {
        const note = document.getElementById('engineNote');
        const engine = document.getElementById('engineSelect').value;

        if (engine === 'browser' && !Recorder.hasBrowserSpeech()) {
            note.style.display = 'block';
            note.innerHTML = '⚠️ <strong>Browser speech API not available.</strong> Switch to <strong>Deepgram</strong> for cross-browser + voice-based speaker detection.';
            note.style.color = '#f59e0b';
        } else if (engine === 'deepgram' && !DeepgramEngine.isEnabled()) {
            note.style.display = 'block';
            note.innerHTML = 'ℹ️ Deepgram needs an API key. Get one free at <a href="https://console.deepgram.com" target="_blank" style="color:var(--accent)">console.deepgram.com</a>';
            note.style.color = 'var(--muted)';
        } else if (engine === 'deepgram') {
            note.style.display = 'block';
            note.innerHTML = '✅ Deepgram active — <strong>voice diarization ON</strong>. Speakers detected by voice. Uncensored. Works in all browsers.';
            note.style.color = '#22c55e';
        } else if (engine === 'browser') {
            note.style.display = 'block';
            note.innerHTML = 'ℹ️ Browser engine: Chrome/Edge only. Gap-based speaker detection. Some words may be censored.';
            note.style.color = 'var(--muted)';
        } else {
            note.style.display = 'none';
        }
    }

    function handleEngineChange(e) {
        const engine = e.target.value;
        Recorder.setEngine(engine);
        updateEngineNote();

        if (engine === 'deepgram' && !DeepgramEngine.isEnabled()) {
            // Prompt for Deepgram key
            const key = prompt('Enter your Deepgram API key (get free at console.deepgram.com):');
            if (key && key.trim()) {
                DeepgramEngine.setApiKey(key.trim());
                sessionStorage.setItem('mm_deepgram_key', key.trim());
                updateEngineNote();
            }
        }
    }

    // ── API key handling ──
    function saveApiKey() {
        const key = document.getElementById('apiKeyInput').value.trim();
        if (!key) return;
        AI.setApiKey(key);
        sessionStorage.setItem('mm_api_key', key);
        UI.hideApiKeyModal();
        console.log('[Orca] API key saved to session');
    }

    function skipApiKey() {
        AI.setApiKey(null);
        UI.hideApiKeyModal();
        console.log('[Orca] AI features skipped');
    }

    // ── Recording controls ──
    async function handleRecordClick() {
        if (!Recorder.isRecording()) {
            await Recorder.start();
            UI.setRecordButton(true);
            UI.setStatus('RECORDING', true);
            UI.startTimer();
            // Show controls
            document.getElementById('pauseBtn').style.display = 'block';
            document.getElementById('exportWebmBtn').style.display = 'block';
            document.getElementById('exportMp3Btn').style.display = 'block';
        } else {
            // Show stop confirmation
            document.getElementById('stopConfirmModal').classList.add('visible');
        }
    }

    function handlePauseClick() {
        const pauseBtn = document.getElementById('pauseBtn');

        if (!Recorder.isPaused()) {
            Recorder.pause();
            UI.setStatus('PAUSED', false);
            UI.stopTimer();
            pauseBtn.textContent = '▶';
            pauseBtn.title = 'Resume';
            pauseBtn.style.color = 'var(--success)';
            pauseBtn.style.borderColor = 'var(--success)';
            // Clear speaking badge
            UI.renderSpeakers(Recorder.getSpeakers(), -1);
        } else {
            Recorder.resume();
            UI.setStatus('RECORDING', true);
            UI.startTimer();
            pauseBtn.textContent = '⏸';
            pauseBtn.title = 'Pause';
            pauseBtn.style.color = '';
            pauseBtn.style.borderColor = '';
        }
    }

    function doStop() {
        Recorder.stop();
        UI.setRecordButton(false);
        UI.setStatus('STOPPED', false);
        UI.resetTimer(); // zero accumulated elapsed so next recording starts from 0

        // Clear speaking badge
        UI.renderSpeakers(Recorder.getSpeakers(), -1);

        // Reset pause button
        const pauseBtn = document.getElementById('pauseBtn');
        pauseBtn.textContent = '⏸';
        pauseBtn.title = 'Pause';
        pauseBtn.style.color = '';
        pauseBtn.style.borderColor = '';
        pauseBtn.style.display = 'none';

        // Auto-analyze (works with or without API key)
        autoAnalyzeOnStop();
    }

    // ── Handle new transcript entry ──
    function handleNewEntry(entry) {
        entries.push(entry);
        wordCount += entry.text.split(/\s+/).length;
        toneCounts[entry.tone] = (toneCounts[entry.tone] || 0) + 1;

        Transcript.renderEntry(entry);
        UI.updateStats(wordCount, entries.length, Recorder.getSpeakers().length, toneCounts);
        UI.enableAIButtons();
    }

    function handleInterim(text) {
        Transcript.renderInterim(text);
    }

    function handleSpeakersChanged(speakers, activeSpeakerId) {
        UI.renderSpeakers(speakers, activeSpeakerId);
        UI.updateStats(wordCount, entries.length, speakers.length, toneCounts);
    }

    // ── AI actions ──
    async function autoAnalyzeOnStop() {
        if (!entries.length) return;

        UI.showLoading('Auto-analyzing meeting');
        try {
            const result = await AI.autoAnalyze(entries);
            if (result) {
                summary = result.summary;
                keypoints = result.keypoints;

                document.getElementById('summaryContent').textContent = summary;

                if (keypoints.length) {
                    document.getElementById('keypointsList').innerHTML =
                        `<div class="keypoints"><div class="keypoints-title">Key Points & Action Items</div>` +
                        keypoints.map((p, i) =>
                            `<div class="keypoint-item"><div class="keypoint-num">${i + 1}.</div><div>${Transcript.esc(p)}</div></div>`
                        ).join('') + `</div>`;
                }
            }
        } catch (e) {
            console.error('[Orca] Auto-analyze error:', e);
            document.getElementById('summaryContent').textContent =
                'Could not generate auto-summary. You can try again with the buttons above.\n\nError: ' + e.message;
        }
    }

    async function doSummarize() {
        if (!entries.length) return;

        UI.showLoading('Generating summary');
        try {
            summary = await AI.summarize(entries);
            document.getElementById('summaryContent').textContent = summary;
        } catch (e) {
            document.getElementById('summaryContent').textContent = 'Error: ' + e.message;
        }
    }

    async function doKeyPoints() {
        if (!entries.length) return;

        UI.showLoading('Extracting key points');
        try {
            keypoints = await AI.extractKeyPoints(entries);
            document.getElementById('summaryContent').textContent = 'Key points extracted below:';
            document.getElementById('keypointsList').innerHTML =
                `<div class="keypoints"><div class="keypoints-title">Key Points & Action Items</div>` +
                keypoints.map((p, i) =>
                    `<div class="keypoint-item"><div class="keypoint-num">${i + 1}.</div><div>${Transcript.esc(p)}</div></div>`
                ).join('') + `</div>`;
        } catch (e) {
            document.getElementById('summaryContent').textContent = 'Error: ' + e.message;
        }
    }

    async function doToneReport() {
        if (!entries.length) return;

        UI.showLoading('Analyzing communication tones');
        try {
            const result = await AI.analyzeTones(entries);
            document.getElementById('summaryContent').textContent = result;
            document.getElementById('keypointsList').innerHTML = '';
        } catch (e) {
            document.getElementById('summaryContent').textContent = 'Error: ' + e.message;
        }
    }

    // ── Speaker rename ──
    function renameSpeaker(id, name) {
        Recorder.renameSpeaker(id, name);
        entries.forEach(e => {
            if (e.speakerId === id) e.speakerName = name;
        });
    }

    // ── Clear all ──
    function clearAll() {
        Recorder.reset();
        entries = [];
        wordCount = 0;
        toneCounts = {};
        summary = null;
        keypoints = [];

        Transcript.clearTranscript();
        UI.resetTimer();
        UI.updateStats(0, 0, 0, {});
        UI.renderSpeakers([], 0);
        UI.disableAIButtons();
        UI.setStatus('STANDBY', false);
        UI.setRecordButton(false);

        // Hide controls
        document.getElementById('pauseBtn').style.display = 'none';
        document.getElementById('exportWebmBtn').style.display = 'none';
        document.getElementById('exportMp3Btn').style.display = 'none';

        document.getElementById('summaryContent').innerHTML =
            '<span class="summary-placeholder">Record a meeting, then stop to auto-generate summary and key points. Or use the buttons above.</span>';
        document.getElementById('keypointsList').innerHTML = '';
        document.getElementById('toneSummary').style.display = 'none';

        console.log('[Orca] Cleared all data');
    }

    return {
        init,
        saveApiKey,
        skipApiKey,
        renameSpeaker,
    };
})();

document.addEventListener('DOMContentLoaded', Orca.init);
