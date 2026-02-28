/* ============================================================
   recorder.js — Audio capture, dual-engine transcription,
   Deepgram voice diarization, MP3/WebM export, pause/resume
   ============================================================ */

const Recorder = (() => {
    'use strict';

    // ── State ──
    let isRecording = false;
    let isPaused = false;
    let recognition = null;
    let audioCtx = null;
    let analyser = null;
    let sourceNode = null;
    let mediaStream = null;
    let currentEngine = 'deepgram'; // default to Deepgram for diarization
    let currentLang = 'en-US';

    // ── Audio recording (for export) ──
    let exportRecorder = null;
    let audioChunks = [];
    let recordedBlob = null;

    // ── Speaker detection ──
    const SPEAKER_COLORS = [
        '#00e5ff', '#f59e0b', '#a78bfa', '#22c55e',
        '#f97316', '#ec4899', '#06b6d4', '#14b8a6',
        '#84cc16', '#e879f9', '#fb923c', '#38bdf8',
    ];
    let speakers = [];
    let dgSpeakerMap = {}; // Maps Deepgram speaker index → our speaker id
    let currentSpeakerId = 0;
    let nextSpeakerId = 1;

    // Energy-based speaker detection (browser engine fallback)
    let lastSpeechEnd = 0;
    let isSpeaking = false;
    let energyCheckInterval = null;
    const SILENCE_THRESHOLD = 10;
    const SPEAKER_GAP_MS = 2000;
    const SILENCE_FRAMES = 5;
    let silentFrameCount = 0;

    // ── Callbacks ──
    let onEntry = null;
    let onInterim = null;
    let onSpeakersChanged = null;

    function setCallbacks(callbacks) {
        onEntry = callbacks.onEntry || null;
        onInterim = callbacks.onInterim || null;
        onSpeakersChanged = callbacks.onSpeakersChanged || null;
    }

    // ── Engine / language selection ──
    function setEngine(engine) {
        currentEngine = engine;
        console.log('[Recorder] Engine set to:', engine);
    }

    function setLanguage(lang) {
        currentLang = lang;
        DeepgramEngine.setLanguage(lang);
        console.log('[Recorder] Language set to:', lang);
    }

    function getEngine() { return currentEngine; }

    function hasBrowserSpeech() {
        return ('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window);
    }

    // ── Microphone loading ──
    async function loadMics() {
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            const devices = await navigator.mediaDevices.enumerateDevices();
            const mics = devices.filter(d => d.kind === 'audioinput');
            const sel = document.getElementById('micSelect');
            sel.innerHTML = mics.map((d, i) =>
                `<option value="${d.deviceId}">${d.label || 'Microphone ' + (i + 1)}</option>`
            ).join('');
            console.log('[Recorder] Found', mics.length, 'microphone(s)');
        } catch (e) {
            console.warn('[Recorder] Mic access denied:', e.message);
            document.getElementById('micSelect').innerHTML = '<option>Default Microphone</option>';
        }
    }

    // ══════════════════════════════════════════════════════
    //  SPEAKER MANAGEMENT
    //  Deepgram: real voice-based, maps DG speaker IDs
    //  Browser:  silence-gap based (fallback)
    // ══════════════════════════════════════════════════════

    function getSpeakerByDgIndex(dgIndex) {
        // Deepgram gives us speaker indices (0, 1, 2, ...)
        // We map these to our internal speaker objects
        if (dgIndex < 0) return getOrCreateSpeaker(); // fallback

        if (dgSpeakerMap[dgIndex] !== undefined) {
            const id = dgSpeakerMap[dgIndex];
            const speaker = speakers.find(s => s.id === id);
            if (speaker) {
                currentSpeakerId = speaker.id;
                return speaker;
            }
        }

        // New speaker detected by voice
        const color = SPEAKER_COLORS[nextSpeakerId % SPEAKER_COLORS.length];
        const newSpeaker = { id: nextSpeakerId, name: `Speaker ${nextSpeakerId}`, color, count: 0 };
        speakers.push(newSpeaker);
        dgSpeakerMap[dgIndex] = nextSpeakerId;
        currentSpeakerId = nextSpeakerId;
        nextSpeakerId++;
        console.log('[Recorder] New speaker detected by voice (DG idx:', dgIndex, '):', newSpeaker.name);
        if (onSpeakersChanged) onSpeakersChanged(speakers, currentSpeakerId);
        return newSpeaker;
    }

    function getOrCreateSpeaker() {
        // Browser engine: silence-gap based
        const now = Date.now();

        if (!isSpeaking) {
            isSpeaking = true;
            if (lastSpeechEnd > 0 && (now - lastSpeechEnd) >= SPEAKER_GAP_MS) {
                const color = SPEAKER_COLORS[nextSpeakerId % SPEAKER_COLORS.length];
                const newSpeaker = { id: nextSpeakerId, name: `Speaker ${nextSpeakerId}`, color, count: 0 };
                speakers.push(newSpeaker);
                currentSpeakerId = nextSpeakerId;
                nextSpeakerId++;
                if (onSpeakersChanged) onSpeakersChanged(speakers, currentSpeakerId);
            }
        }

        if (speakers.length === 0) {
            speakers.push({ id: 1, name: 'Speaker 1', color: SPEAKER_COLORS[0], count: 0 });
            currentSpeakerId = 1;
            nextSpeakerId = 2;
            if (onSpeakersChanged) onSpeakersChanged(speakers, currentSpeakerId);
        }

        return speakers.find(s => s.id === currentSpeakerId);
    }

    function renameSpeaker(id, name) {
        const s = speakers.find(s => s.id === id);
        if (s) {
            s.name = name;
            if (onSpeakersChanged) onSpeakersChanged(speakers, currentSpeakerId);
        }
    }

    // ── Energy detection (browser engine only) ──
    function startEnergyDetection() {
        if (!analyser) return;
        const buf = new Uint8Array(analyser.frequencyBinCount);

        energyCheckInterval = setInterval(() => {
            if (isPaused) return;
            analyser.getByteFrequencyData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
            const rms = Math.sqrt(sum / buf.length);

            if (rms < SILENCE_THRESHOLD) {
                silentFrameCount++;
                if (silentFrameCount >= SILENCE_FRAMES && isSpeaking) {
                    isSpeaking = false;
                    lastSpeechEnd = Date.now();
                }
            } else {
                silentFrameCount = 0;
            }
        }, 80);
    }

    function stopEnergyDetection() {
        if (energyCheckInterval) {
            clearInterval(energyCheckInterval);
            energyCheckInterval = null;
        }
    }

    // ══════════════════════════════════════════════════════
    //  COMMIT TEXT — shared by all engines
    // ══════════════════════════════════════════════════════

    function commitText(text, speakerDgIndex) {
        if (!text || !text.trim() || isPaused) return;
        text = text.trim();

        // Get speaker: voice-based (Deepgram) or gap-based (Browser)
        let speaker;
        if (currentEngine === 'deepgram' && speakerDgIndex !== undefined && speakerDgIndex >= 0) {
            speaker = getSpeakerByDgIndex(speakerDgIndex);
        } else {
            speaker = getOrCreateSpeaker();
        }
        speaker.count = (speaker.count || 0) + 1;

        const entry = {
            id: Date.now() + Math.random(),
            speakerId: speaker.id,
            speakerName: speaker.name,
            speakerColor: speaker.color,
            text: text,
            tone: Transcript.detectEmotion(text),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            timestamp: Date.now(),
        };

        console.log(`[Recorder] [${entry.speakerName}] (${entry.tone}) "${text.substring(0, 60)}"`);
        if (onEntry) onEntry(entry);
        if (onSpeakersChanged) onSpeakersChanged(speakers, currentSpeakerId);
    }

    // ══════════════════════════════════════════════════════
    //  BROWSER ENGINE (Web Speech API)
    //  Commits interim text before restart to prevent loss
    // ══════════════════════════════════════════════════════

    let lastInterimText = '';
    let restartTimeout = null;

    function createBrowserRecognition() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return null;

        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.lang = { 'en-US': 'en-US', 'en-GB': 'en-GB', 'hi-IN': 'hi-IN', 'hi-Latn': 'hi-IN' }[currentLang] || 'en-US';
        return rec;
    }

    function wireBrowserRecognition(rec) {
        let sessionHasInterim = false;

        rec.onresult = (event) => {
            if (isPaused) return;
            let fullInterim = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const text = result[0].transcript;

                if (result.isFinal) {
                    const cleaned = text.trim();
                    if (cleaned) {
                        commitText(cleaned);
                        lastInterimText = '';
                        sessionHasInterim = false;
                    }
                } else {
                    fullInterim += text;
                }
            }

            if (fullInterim.trim()) {
                lastInterimText = fullInterim.trim();
                sessionHasInterim = true;
                if (onInterim) onInterim(lastInterimText);
            }
        };

        rec.onerror = (e) => {
            if (e.error === 'aborted') return;
            if (e.error === 'no-speech') { doRestart(); return; }
            console.warn('[Recorder] Speech error:', e.error);
            if (e.error === 'network' || e.error === 'service-not-allowed') {
                setTimeout(() => doRestart(), 300);
            }
        };

        rec.onend = () => {
            if (sessionHasInterim && lastInterimText) {
                commitText(lastInterimText);
                lastInterimText = '';
                sessionHasInterim = false;
                if (typeof Transcript !== 'undefined') Transcript.clearInterim();
            }
            doRestart();
        };
    }

    function doRestart() {
        if (!isRecording || isPaused) return;
        clearTimeout(restartTimeout);
        restartTimeout = setTimeout(() => {
            if (!isRecording || isPaused) return;
            try {
                if (recognition) {
                    recognition.onend = null;
                    recognition.onerror = null;
                    recognition.onresult = null;
                }
            } catch (_) { }

            recognition = createBrowserRecognition();
            if (recognition) {
                wireBrowserRecognition(recognition);
                try { recognition.start(); }
                catch (e) { setTimeout(() => doRestart(), 500); }
            }
        }, 100);
    }

    function startBrowserEngine() {
        lastInterimText = '';
        recognition = createBrowserRecognition();
        if (!recognition) {
            alert('Speech recognition not supported. Switch to Deepgram engine.');
            return false;
        }
        wireBrowserRecognition(recognition);
        recognition.start();
        console.log('[Recorder] Browser engine started (lang:', currentLang, ')');
        return true;
    }

    function stopBrowserEngine() {
        clearTimeout(restartTimeout);
        if (lastInterimText) { commitText(lastInterimText); lastInterimText = ''; }
        if (recognition) {
            recognition.onend = null;
            recognition.onerror = null;
            recognition.onresult = null;
            try { recognition.stop(); } catch (_) { }
            recognition = null;
        }
    }

    // ══════════════════════════════════════════════════════
    //  DEEPGRAM ENGINE with voice diarization
    // ══════════════════════════════════════════════════════

    let dgLastInterim = '';

    function startDeepgramEngine() {
        if (!DeepgramEngine.isEnabled()) {
            alert('Please set a Deepgram API key first.\nGet one free at console.deepgram.com');
            return false;
        }

        dgLastInterim = '';

        DeepgramEngine.setCallback((text, isFinal, speakerIndex) => {
            if (isPaused) return;

            if (!isFinal) {
                dgLastInterim = text;
                if (onInterim) onInterim(text);
            } else {
                dgLastInterim = '';
                commitText(text, speakerIndex);
            }
        });

        DeepgramEngine.start(mediaStream);
        console.log('[Recorder] Deepgram engine started (diarization ON)');
        return true;
    }

    function stopDeepgramEngine() {
        if (dgLastInterim) { commitText(dgLastInterim); dgLastInterim = ''; }
        DeepgramEngine.stop();
    }

    // ══════════════════════════════════════════════════════
    //  MAIN START / STOP / PAUSE / RESUME
    // ══════════════════════════════════════════════════════

    async function start() {
        if (isRecording) return;

        isRecording = true;
        isPaused = false;
        silentFrameCount = 0;
        isSpeaking = false;
        lastSpeechEnd = 0;
        audioChunks = [];
        recordedBlob = null;
        console.log('[Recorder] Starting with engine:', currentEngine);

        // Get microphone
        try {
            const deviceId = document.getElementById('micSelect').value;
            const constraints = deviceId
                ? { audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
                : { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

            mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

            // Lightweight audio context — only for visualizer + energy detection
            audioCtx = new AudioContext();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.3;
            sourceNode = audioCtx.createMediaStreamSource(mediaStream);
            sourceNode.connect(analyser);
            // No ScriptProcessor! This was causing the memory leak.
            UI.drawVisualizer(analyser);

            // Energy detection only needed for browser engine
            if (currentEngine === 'browser') {
                startEnergyDetection();
            }

            // WebM MediaRecorder for audio export
            try {
                const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                    ? 'audio/webm;codecs=opus' : 'audio/webm';
                exportRecorder = new MediaRecorder(mediaStream, { mimeType });
                exportRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) audioChunks.push(e.data);
                };
                exportRecorder.onstop = () => {
                    recordedBlob = new Blob(audioChunks, { type: exportRecorder.mimeType });
                    console.log('[Recorder] Audio ready:', (recordedBlob.size / 1024).toFixed(1), 'KB');
                };
                exportRecorder.start(1000);
            } catch (e) {
                console.warn('[Recorder] MediaRecorder unavailable:', e.message);
            }
        } catch (e) {
            console.error('[Recorder] Mic/audio error:', e.message);
        }

        // Start transcription engine
        if (currentEngine === 'deepgram') {
            if (!startDeepgramEngine()) {
                console.log('[Recorder] Falling back to browser engine');
                if (hasBrowserSpeech()) {
                    currentEngine = 'browser';
                    startEnergyDetection();
                    startBrowserEngine();
                }
            }
        } else {
            if (!startBrowserEngine()) {
                console.error('[Recorder] No transcription engine available');
            }
        }
    }

    function pause() {
        if (!isRecording || isPaused) return;
        isPaused = true;

        if (currentEngine === 'browser') {
            if (lastInterimText) { commitText(lastInterimText); lastInterimText = ''; }
            clearTimeout(restartTimeout);
            if (recognition) {
                recognition.onend = null; recognition.onerror = null; recognition.onresult = null;
                try { recognition.stop(); } catch (_) { }
                recognition = null;
            }
        } else {
            if (dgLastInterim) { commitText(dgLastInterim); dgLastInterim = ''; }
            DeepgramEngine.pause();
        }
        if (typeof Transcript !== 'undefined') Transcript.clearInterim();
        if (exportRecorder && exportRecorder.state === 'recording') exportRecorder.pause();
        console.log('[Recorder] Paused');
    }

    function resume() {
        if (!isRecording || !isPaused) return;
        isPaused = false;

        if (currentEngine === 'browser') {
            startBrowserEngine();
        } else {
            DeepgramEngine.resume();
        }
        if (exportRecorder && exportRecorder.state === 'paused') exportRecorder.resume();
        console.log('[Recorder] Resumed');
    }

    function stop() {
        isRecording = false;
        isPaused = false;

        if (currentEngine === 'browser') stopBrowserEngine();
        else stopDeepgramEngine();

        stopEnergyDetection();
        UI.stopVisualizer();

        if (exportRecorder && exportRecorder.state !== 'inactive') exportRecorder.stop();

        if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
        if (sourceNode) { try { sourceNode.disconnect(); } catch (_) { } sourceNode = null; }
        if (audioCtx) { audioCtx.close(); audioCtx = null; analyser = null; }

        console.log('[Recorder] Stopped');
    }

    // ══════════════════════════════════════════════════════
    //  EXPORT
    // ══════════════════════════════════════════════════════

    function getRecordedBlob() { return recordedBlob; }

    function downloadWebM() {
        if (!recordedBlob) { alert('No audio recording. Record first.'); return; }
        const url = URL.createObjectURL(recordedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `meeting-${new Date().toISOString().slice(0, 10)}.webm`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function downloadMP3() {
        if (!recordedBlob) { alert('No audio recording. Record first.'); return; }
        if (typeof lamejs === 'undefined') { alert('MP3 encoder loading. Try again.'); return; }

        console.log('[Recorder] Converting WebM → MP3...');
        UI.showLoading('Encoding MP3');

        // Decode the WebM blob to PCM, then encode to MP3
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const decodeCtx = new AudioContext();
                const audioBuffer = await decodeCtx.decodeAudioData(reader.result);
                const pcm = audioBuffer.getChannelData(0);
                const sampleRate = audioBuffer.sampleRate;
                decodeCtx.close();

                // Convert float32 to int16
                const samples = new Int16Array(pcm.length);
                for (let i = 0; i < pcm.length; i++) {
                    const s = Math.max(-1, Math.min(1, pcm[i]));
                    samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }

                const mp3enc = new lamejs.Mp3Encoder(1, sampleRate, 128);
                const mp3Chunks = [];
                const blockSize = 1152;
                for (let i = 0; i < samples.length; i += blockSize) {
                    const chunk = samples.subarray(i, i + blockSize);
                    const buf = mp3enc.encodeBuffer(chunk);
                    if (buf.length > 0) mp3Chunks.push(buf);
                }
                const end = mp3enc.flush();
                if (end.length > 0) mp3Chunks.push(end);

                const blob = new Blob(mp3Chunks, { type: 'audio/mp3' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `meeting-${new Date().toISOString().slice(0, 10)}.mp3`;
                a.click();
                URL.revokeObjectURL(url);
                console.log('[Recorder] MP3 downloaded:', (blob.size / 1024).toFixed(1), 'KB');
            } catch (e) {
                console.error('[Recorder] MP3 encoding failed:', e);
                alert('MP3 conversion failed. Download as WebM instead.');
            }
        };
        reader.readAsArrayBuffer(recordedBlob);
    }

    function downloadAudio(format) {
        if (format === 'mp3') downloadMP3();
        else downloadWebM();
    }

    // ── Reset ──
    function reset() {
        stop();
        speakers = [];
        dgSpeakerMap = {};
        currentSpeakerId = 0;
        nextSpeakerId = 1;
        lastSpeechEnd = 0;
        isSpeaking = false;
        silentFrameCount = 0;
        audioChunks = [];
        recordedBlob = null;
        exportRecorder = null;
        lastInterimText = '';
        dgLastInterim = '';
    }

    return {
        loadMics,
        start, stop, pause, resume, reset,
        setCallbacks, setEngine, setLanguage, getEngine,
        renameSpeaker,
        downloadAudio, downloadWebM, downloadMP3,
        getRecordedBlob, hasBrowserSpeech,
        isRecording: () => isRecording,
        isPaused: () => isPaused,
        getSpeakers: () => speakers,
        getCurrentSpeakerId: () => currentSpeakerId,
    };
})();
