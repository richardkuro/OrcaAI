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

        if (window.loadEnv) {
            await window.loadEnv();
        }

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

        // ── Configure Deepgram (transcription + AI analysis) ──
        let dgKey = window.ENV?.DEEPGRAM_API_KEY || window.ENV?.DEEPGRAM_KEY || sessionStorage.getItem('mm_deepgram_key');
        if (!dgKey) {
            dgKey = window.prompt("Enter your Deepgram API Key for AI features (or cancel to use free Browser engine):") || '';
            if (dgKey) sessionStorage.setItem('mm_deepgram_key', dgKey);
        }

        DeepgramEngine.setApiKey(dgKey);
        AI.setDeepgramKey(dgKey);        // share key with AI module for post-analysis

        engineSelect.value = 'deepgram';
        Recorder.setEngine('deepgram');
        updateEngineNote();

        console.log('[Orca] Ready — no external AI key required');
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
            note.innerHTML = '✅ Deepgram active — <strong>voice diarization + AI analysis ON</strong>. Speakers detected by voice.';
            note.style.color = '#22c55e';
        } else if (engine === 'browser') {
            note.style.display = 'block';
            note.innerHTML = 'ℹ️ Browser engine: Chrome/Edge only. Gap-based speaker detection. AI analysis uses local mode.';
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
            const envKey = window.ENV?.DEEPGRAM_API_KEY || window.ENV?.DEEPGRAM_KEY;
            const key = envKey || prompt('Enter your Deepgram API key (get free at console.deepgram.com):');
            if (key && key.trim()) {
                DeepgramEngine.setApiKey(key.trim());
                AI.setDeepgramKey(key.trim());
                if (!envKey) sessionStorage.setItem('mm_deepgram_key', key.trim());
                updateEngineNote();
            }
        }
    }

    // ── Recording controls ──
    async function handleRecordClick() {
        if (!Recorder.isRecording()) {
            await Recorder.start();
            UI.setRecordButton(true);
            UI.setStatus('RECORDING', true);
            UI.startTimer();
            document.getElementById('pauseBtn').style.display = 'block';
            document.getElementById('exportWebmBtn').style.display = 'block';
            document.getElementById('exportMp3Btn').style.display = 'block';
        } else {
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
        UI.resetTimer();

        UI.renderSpeakers(Recorder.getSpeakers(), -1);

        const pauseBtn = document.getElementById('pauseBtn');
        pauseBtn.textContent = '⏸';
        pauseBtn.title = 'Pause';
        pauseBtn.style.color = '';
        pauseBtn.style.borderColor = '';
        pauseBtn.style.display = 'none';

        // Run AI analysis (Deepgram REST or local fallback)
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

    // ── AI analysis on stop ──
    async function autoAnalyzeOnStop() {
        if (!entries.length) return;

        UI.showLoading('Analyzing…');

        // Wait for the export recorder to finish (onstop fires async)
        await new Promise(r => setTimeout(r, 600));

        const blob = Recorder.getRecordedBlob();
        const speakers = Recorder.getSpeakers();

        try {
            const result = await AI.analyze(blob, speakers, entries);
            if (!result) return;

            summary = result.globalSummary;
            keypoints = result.globalKeypoints;

            // Auto-show: summary only. Key points and charts are on-demand.
            UI.renderAnalysis(result);
            setActiveAIButton('summarizeBtn');

            console.log('[Orca] AI analysis complete (source:', result.source, ')');
        } catch (e) {
            console.error('[Orca] Analysis error:', e);
            document.getElementById('summaryContent').textContent =
                'Analysis failed: ' + e.message;
        }
    }

    // ── Active button state ──
    function setActiveAIButton(activeId) {
        ['summarizeBtn', 'keypointsBtn', 'toneBtn'].forEach(id => {
            const btn = document.getElementById(id);
            if (id === activeId) {
                btn.classList.add('primary');
            } else {
                btn.classList.remove('primary');
            }
        });
    }

    // ── Manual AI buttons ──
    async function doSummarize() {
        if (!entries.length) return;
        setActiveAIButton('summarizeBtn');
        UI.showLoading('Generating summary');
        try {
            const cached = AI.getCache();
            if (cached) {
                UI.renderAnalysis(cached);
            } else {
                const blob = Recorder.getRecordedBlob();
                const result = await AI.analyze(blob, Recorder.getSpeakers(), entries);
                if (result) { summary = result.globalSummary; UI.renderAnalysis(result); }
            }
        } catch (e) {
            document.getElementById('summaryContent').textContent = 'Error: ' + e.message;
        }
    }

    async function doKeyPoints() {
        if (!entries.length) return;
        setActiveAIButton('keypointsBtn');
        UI.showLoading('Extracting key points');
        try {
            const cached = AI.getCache();
            if (cached) {
                UI.renderKeyPoints(cached);
            } else {
                const blob = Recorder.getRecordedBlob();
                const result = await AI.analyze(blob, Recorder.getSpeakers(), entries);
                if (result) { keypoints = result.globalKeypoints; UI.renderKeyPoints(result); }
            }
        } catch (e) {
            document.getElementById('summaryContent').textContent = 'Error: ' + e.message;
        }
    }

    async function doToneReport() {
        if (!entries.length) return;
        setActiveAIButton('toneBtn');
        UI.showLoading('Loading emotion charts');
        try {
            const speakers = Recorder.getSpeakers();
            const cached = AI.getCache();
            if (cached) {
                UI.renderEmotionCharts(cached.timeline, speakers);
            } else {
                const blob = Recorder.getRecordedBlob();
                const result = await AI.analyze(blob, speakers, entries);
                if (result) UI.renderEmotionCharts(result.timeline, speakers);
            }
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

        document.getElementById('pauseBtn').style.display = 'none';
        document.getElementById('exportWebmBtn').style.display = 'none';
        document.getElementById('exportMp3Btn').style.display = 'none';

        document.getElementById('summaryContent').innerHTML =
            '<span class="summary-placeholder">Record a meeting, then stop to auto-generate summary and key points. Or use the buttons above.</span>';
        document.getElementById('keypointsList').innerHTML = '';
        document.getElementById('emotionChartsSection').innerHTML = '';
        document.getElementById('toneSummary').style.display = 'none';

        console.log('[Orca] Cleared all data');
    }

    return {
        init,
        renameSpeaker,
        // Legacy (kept so HTML doesn't break if refs exist)
        saveApiKey: () => { },
        skipApiKey: () => { },
    };
})();

document.addEventListener('DOMContentLoaded', Orca.init);
