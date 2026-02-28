/* ============================================================
   deepgram.js — Deepgram WebSocket real-time transcription
   with voice-based speaker diarization
   ============================================================ */

const DeepgramEngine = (() => {
    'use strict';

    let ws = null;
    let dgMediaRecorder = null;
    let isActive = false;
    let apiKey = null;
    let onTranscript = null; // (text, isFinal, speakerIndex) => void
    let currentLang = 'en-US';
    let reconnectAttempts = 0;
    const MAX_RECONNECT = 5;

    function setApiKey(key) {
        apiKey = key;
        console.log('[Deepgram] API key', key ? 'set' : 'cleared');
    }

    function getApiKey() { return apiKey; }
    function isEnabled() { return !!apiKey; }

    function setLanguage(lang) {
        const map = {
            'en-US': 'en-US',
            'en-GB': 'en-GB',
            'hi-IN': 'hi',
            'hi-Latn': 'hi',
        };
        currentLang = map[lang] || 'en-US';
    }

    function setCallback(cb) {
        onTranscript = cb;
    }

    async function start(stream) {
        if (!apiKey) {
            console.warn('[Deepgram] No API key set');
            return false;
        }

        isActive = true;
        reconnectAttempts = 0;

        return connectWebSocket(stream);
    }

    function connectWebSocket(stream) {
        // Build WebSocket URL with diarization enabled
        const params = new URLSearchParams({
            model: 'nova-2',
            language: currentLang,
            smart_format: 'true',
            punctuate: 'true',
            interim_results: 'true',
            endpointing: '300',
            vad_events: 'true',
            profanity_filter: 'false',
            diarize: 'true',           // Voice-based speaker detection!
            utterances: 'false',
        });

        const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

        try {
            ws = new WebSocket(wsUrl, ['token', apiKey]);
        } catch (e) {
            console.error('[Deepgram] WebSocket creation failed:', e);
            return false;
        }

        ws.onopen = () => {
            console.log('[Deepgram] WebSocket connected (diarization enabled)');
            reconnectAttempts = 0;
            startStreaming(stream);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'Results' && data.channel) {
                    const alt = data.channel.alternatives[0];
                    if (alt && alt.transcript) {
                        const isFinal = data.is_final;

                        // Extract speaker from diarization
                        // Each word has a speaker field (0, 1, 2, ...)
                        let speakerIndex = -1;
                        if (alt.words && alt.words.length > 0) {
                            // Use the most frequent speaker in this segment
                            const speakerCounts = {};
                            for (const word of alt.words) {
                                if (word.speaker !== undefined) {
                                    speakerCounts[word.speaker] = (speakerCounts[word.speaker] || 0) + 1;
                                }
                            }
                            if (Object.keys(speakerCounts).length > 0) {
                                speakerIndex = parseInt(
                                    Object.entries(speakerCounts)
                                        .sort((a, b) => b[1] - a[1])[0][0]
                                );
                            }
                        }

                        if (onTranscript) {
                            onTranscript(alt.transcript, isFinal, speakerIndex);
                        }
                    }
                }
            } catch (e) {
                // Non-JSON message, ignore
            }
        };

        ws.onerror = (e) => {
            console.error('[Deepgram] WebSocket error:', e);
        };

        ws.onclose = (e) => {
            console.log('[Deepgram] WebSocket closed:', e.code, e.reason);
            if (isActive && reconnectAttempts < MAX_RECONNECT) {
                reconnectAttempts++;
                console.log(`[Deepgram] Reconnecting (attempt ${reconnectAttempts})...`);
                setTimeout(() => {
                    if (isActive) connectWebSocket(stream);
                }, 1000 * reconnectAttempts);
            }
        };

        return true;
    }

    function startStreaming(stream) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/webm')
                ? 'audio/webm'
                : 'audio/ogg;codecs=opus';

        try {
            dgMediaRecorder = new MediaRecorder(stream, { mimeType });
        } catch (e) {
            dgMediaRecorder = new MediaRecorder(stream);
        }

        dgMediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(event.data);
            }
        };

        dgMediaRecorder.start(100); // 100ms slices = fast initial response
        console.log('[Deepgram] Streaming audio with', mimeType);
    }

    function stop() {
        isActive = false;

        if (dgMediaRecorder && dgMediaRecorder.state !== 'inactive') {
            try { dgMediaRecorder.stop(); } catch (_) { }
            dgMediaRecorder = null;
        }

        if (ws) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'CloseStream' }));
            }
            ws.close();
            ws = null;
        }

        console.log('[Deepgram] Stopped');
    }

    function pause() {
        if (dgMediaRecorder && dgMediaRecorder.state === 'recording') {
            dgMediaRecorder.pause();
            console.log('[Deepgram] Paused');
        }
    }

    function resume() {
        if (dgMediaRecorder && dgMediaRecorder.state === 'paused') {
            dgMediaRecorder.resume();
            console.log('[Deepgram] Resumed');
        }
    }

    return {
        setApiKey,
        getApiKey,
        isEnabled,
        setLanguage,
        setCallback,
        start,
        stop,
        pause,
        resume,
    };
})();
