/* ============================================================
   ai.js — AI analysis via Deepgram Audio Intelligence
   POST-recording: summarize=v2, sentiment, topics (per speaker)
   LOCAL fallback: keyword-based (instant, no API call)
   ============================================================ */

const AI = (() => {
    'use strict';

    let _dgKey = null;          // Deepgram API key (set from app.js)
    let _cache = null;          // cached last analysis result

    function setDeepgramKey(key) {
        _dgKey = key;
        console.log('[AI] Deepgram key', key ? 'ready' : 'cleared');
    }

    // ══════════════════════════════════════════════════════
    //  DEEPGRAM AUDIO INTELLIGENCE  (pre-recorded REST)
    //  Called after stop with the recorded WebM blob
    // ══════════════════════════════════════════════════════

    async function deepgramAnalyze(blob, speakerMap, entries) {
        if (!_dgKey || !blob) throw new Error('no_key_or_blob');

        const params = new URLSearchParams({
            model: 'nova-2',
            summarize: 'v2',
            sentiment: 'true',
            topics: 'true',
            diarize: 'true',
            punctuate: 'true',
            smart_format: 'true',
        });

        const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
            method: 'POST',
            headers: {
                Authorization: `Token ${_dgKey}`,
                'Content-Type': blob.type || 'audio/webm',
            },
            body: blob,
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`Deepgram AI error (${res.status}): ${errText.substring(0, 200)}`);
        }

        const data = await res.json();
        return parseDgResponse(data, speakerMap, entries);
    }

    function parseDgResponse(data, speakerMap, entries) {
        const results = data?.results || {};
        const channel = results?.channels?.[0]?.alternatives?.[0] || {};
        const summaryObj = results?.summary || {};
        const topics = results?.topics?.segments || [];
        const sentimentSegs = results?.sentiments?.segments || [];
        const averageSentiment = results?.sentiments?.average || {};

        // ── Map Deepgram speaker indices → speaker names ──
        // speakerMap is our Recorder.getSpeakers() array: [{id, name, color, count}...]
        // dgSpeakerMap (passed from recorder): DG index → speaker id
        // We rebuild a simpler: speakerName per entry using the entries we already have
        const bySpeaker = {};
        entries.forEach(e => {
            if (!bySpeaker[e.speakerName]) bySpeaker[e.speakerName] = [];
            bySpeaker[e.speakerName].push(e);
        });
        const speakerNames = Object.keys(bySpeaker);

        // ── Global summary ──
        const globalSummary = summaryObj?.short || channel?.transcript?.slice(0, 300) || 'No summary available.';

        // ── Per-speaker summaries from local entries (DG free tier doesn't separate by speaker in summary) ──
        const perSpeaker = speakerNames.map(name => {
            const spEntries = bySpeaker[name];
            const spText = spEntries.map(e => e.text).join(' ');
            const wordCount = spEntries.reduce((s, e) => s + e.text.split(/\s+/).length, 0);

            // Extract local key points for this speaker
            const keypoints = extractLocalKeyPoints(spEntries, 5);

            // Find speaker color
            const spObj = speakerMap.find(s => s.name === name);
            const color = spObj?.color || '#00e5ff';

            return { name, color, summary: null, keypoints, wordCount, entryCount: spEntries.length, text: spText };
        });

        // ── Sentiment timeline ──
        // Build timeline from DG sentiment segments if available, else from local tone
        let timeline = [];

        if (sentimentSegs.length > 0) {
            // DG provides: { text, start, end, sentiment, sentiment_score }
            // We need to map to speaker — use the entries array by timestamp overlap
            sentimentSegs.forEach(seg => {
                // Find closest entry by position in transcript
                const globalScore = seg.sentiment_score ?? sentimentToScore(seg.sentiment);
                const speakerName = findSpeakerForSegment(seg, entries) || speakerNames[0] || 'Speaker 1';
                const color = speakerMap.find(s => s.name === speakerName)?.color || '#00e5ff';
                timeline.push({
                    time: formatSeconds(seg.start),
                    startSec: seg.start,
                    speakerName,
                    color,
                    sentiment: seg.sentiment || 'neutral',
                    score: globalScore,
                    text: seg.text?.slice(0, 60) || '',
                });
            });
        } else {
            // Local fallback: build from entries with tone→score mapping
            timeline = buildLocalTimeline(entries, speakerMap);
        }

        // ── Topics → global key points ──
        const globalKeypoints = [];
        topics.forEach(seg => {
            seg.topics?.forEach(t => {
                if (t.topic) globalKeypoints.push(t.topic);
            });
        });
        if (globalKeypoints.length === 0) {
            globalKeypoints.push(...extractLocalKeyPoints(entries, 6));
        }

        // Attach DG summary to perSpeaker (distribute global summary by proportion)
        perSpeaker.forEach(sp => {
            sp.summary = buildSpeakerSummary(sp, entries.length);
        });

        return {
            globalSummary,
            globalKeypoints,
            perSpeaker,     // [{name, color, summary, keypoints, wordCount, entryCount}]
            timeline,        // [{time, startSec, speakerName, color, sentiment, score}]
            source: 'deepgram',
        };
    }

    // Find which speaker in our entries most likely said a DG sentiment segment
    // (rough match by text proximity / word overlap)
    function findSpeakerForSegment(seg, entries) {
        if (!seg.text || entries.length === 0) return null;
        const segWords = new Set(seg.text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        let bestScore = 0;
        let bestSpeaker = entries[0]?.speakerName || null;

        entries.forEach(e => {
            const eWords = e.text.toLowerCase().split(/\s+/);
            let hits = 0;
            eWords.forEach(w => { if (segWords.has(w)) hits++; });
            if (hits > bestScore) { bestScore = hits; bestSpeaker = e.speakerName; }
        });
        return bestSpeaker;
    }

    function sentimentToScore(sentiment) {
        return sentiment === 'positive' ? 0.6 : sentiment === 'negative' ? -0.6 : 0;
    }

    function formatSeconds(sec) {
        if (sec == null) return '';
        const m = String(Math.floor(sec / 60)).padStart(2, '0');
        const s = String(Math.floor(sec % 60)).padStart(2, '0');
        return `${m}:${s}`;
    }

    function buildSpeakerSummary(sp, totalEntries) {
        const pct = Math.round(sp.entryCount / Math.max(totalEntries, 1) * 100);
        return `${sp.name} contributed ${sp.entryCount} statements (~${sp.wordCount} words, ${pct}% of conversation). ` +
            `Primary topics: ${sp.keypoints.slice(0, 2).join('; ') || 'general discussion'}.`;
    }

    // ══════════════════════════════════════════════════════
    //  LOCAL FALLBACK  (instant, no network)
    // ══════════════════════════════════════════════════════

    const TONE_SCORE = {
        excited: 0.8, happy: 0.6, neutral: 0, serious: -0.1,
        confused: -0.3, sad: -0.6, angry: -0.8,
    };

    const IMPORTANT_WORDS = new Set([
        'important', 'critical', 'urgent', 'deadline', 'decide', 'decision',
        'agree', 'agreed', 'action', 'must', 'should', 'need', 'priority',
        'next', 'plan', 'goal', 'result', 'conclusion', 'propose', 'proposal',
        'approve', 'approval', 'budget', 'schedule', 'milestone', 'risk',
        'issue', 'problem', 'solution', 'resolved', 'fix', 'update',
        'launch', 'release', 'deploy', 'deliver', 'complete', 'finish',
    ]);

    function localAnalyze(entries, speakerMap) {
        if (!entries.length) {
            return {
                globalSummary: 'No transcript yet.',
                globalKeypoints: [],
                perSpeaker: [],
                timeline: [],
                source: 'local',
            };
        }

        const bySpeaker = {};
        entries.forEach(e => {
            if (!bySpeaker[e.speakerName]) bySpeaker[e.speakerName] = [];
            bySpeaker[e.speakerName].push(e);
        });
        const speakerNames = Object.keys(bySpeaker);
        const totalWords = entries.reduce((s, e) => s + e.text.split(/\s+/).length, 0);
        const duration = entries.length > 0
            ? `${entries[0].time} → ${entries[entries.length - 1].time}` : '';

        // Global summary
        const speakerParts = speakerNames.map(n => {
            const c = bySpeaker[n].length;
            const w = bySpeaker[n].reduce((s, e) => s + e.text.split(/\s+/).length, 0);
            return `${n} (${c} statements, ~${w} words)`;
        });
        const globalSummary = `Meeting with ${speakerNames.length} speaker(s): ${speakerParts.join(', ')}. ` +
            `Total: ${entries.length} entries, ~${totalWords} words (${duration}).`;

        // Per-speaker
        const perSpeaker = speakerNames.map(name => {
            const spEntries = bySpeaker[name];
            const wordCount = spEntries.reduce((s, e) => s + e.text.split(/\s+/).length, 0);
            const pct = Math.round(spEntries.length / entries.length * 100);
            const topTone = getTopTone(spEntries);
            const summary = `${name} made ${spEntries.length} statements (~${wordCount} words, ${pct}% of conversation). Tone: primarily ${topTone}.`;
            const keypoints = extractLocalKeyPoints(spEntries, 5);
            const color = speakerMap.find(s => s.name === name)?.color || '#00e5ff';
            return { name, color, summary, keypoints, wordCount, entryCount: spEntries.length };
        });

        // Global key points
        const globalKeypoints = extractLocalKeyPoints(entries, 6);

        // Sentiment timeline from tone
        const timeline = buildLocalTimeline(entries, speakerMap);

        return { globalSummary, globalKeypoints, perSpeaker, timeline, source: 'local' };
    }

    function buildLocalTimeline(entries, speakerMap) {
        return entries.map((e, i) => {
            const color = speakerMap.find(s => s.name === e.speakerName)?.color || '#00e5ff';
            const score = TONE_SCORE[e.tone] ?? 0;
            return {
                time: e.time,
                startSec: i,        // fake seconds index when no DG timestamps
                speakerName: e.speakerName,
                color,
                sentiment: toneToSentiment(e.tone),
                score,
                text: e.text.slice(0, 60),
            };
        });
    }

    function toneToSentiment(tone) {
        if (tone === 'happy' || tone === 'excited') return 'positive';
        if (tone === 'angry' || tone === 'sad') return 'negative';
        return 'neutral';
    }

    function getTopTone(entries) {
        const tc = {};
        entries.forEach(e => { tc[e.tone] = (tc[e.tone] || 0) + 1; });
        return Object.entries(tc).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';
    }

    function extractLocalKeyPoints(entries, max = 5) {
        const scored = entries.map(e => {
            const words = e.text.toLowerCase().split(/\s+/);
            let score = 0;
            words.forEach(w => { if (IMPORTANT_WORDS.has(w)) score += 2; });
            if (e.tone === 'serious') score += 3;
            if (e.tone === 'excited') score += 1;
            if (e.text.includes('?')) score += 1;
            score += Math.min(words.length / 10, 2);
            return { entry: e, score };
        }).sort((a, b) => b.score - a.score);

        const seen = new Set();
        const points = [];
        for (const { entry } of scored) {
            const norm = entry.text.toLowerCase().trim();
            if (seen.has(norm) || norm.length < 10) continue;
            seen.add(norm);
            // Return clean text — capitalize first letter, ensure ends with period
            let text = entry.text.trim();
            text = text.charAt(0).toUpperCase() + text.slice(1);
            if (!/[.!?]$/.test(text)) text += '.';
            points.push(text);
            if (points.length >= max) break;
        }
        return points.length ? points : ['No significant key points detected.'];
    }


    // ══════════════════════════════════════════════════════
    //  PUBLIC API
    // ══════════════════════════════════════════════════════

    async function analyze(blob, speakerMap, entries) {
        if (!entries.length) return null;

        // Try Deepgram AI intelligence first
        if (_dgKey && blob) {
            try {
                console.log('[AI] Sending audio to Deepgram for AI analysis...');
                _cache = await deepgramAnalyze(blob, speakerMap, entries);
                console.log('[AI] Deepgram AI analysis complete');
                return _cache;
            } catch (e) {
                console.warn('[AI] Deepgram analysis failed, using local:', e.message);
            }
        }

        // Local fallback
        console.log('[AI] Running local analysis...');
        _cache = localAnalyze(entries, speakerMap);
        return _cache;
    }

    function getCache() { return _cache; }

    // Legacy shims so buttons in app.js still work without change
    async function summarize(entries) {
        return _cache?.globalSummary || localAnalyze(entries, []).globalSummary;
    }
    async function extractKeyPoints(entries) {
        return _cache?.globalKeypoints || localAnalyze(entries, []).globalKeypoints;
    }
    async function analyzeTones(entries) {
        if (!_cache) return 'No analysis yet. Stop recording to generate analysis.';
        return _cache.timeline.length + ' sentiment data points collected. See chart below.';
    }
    async function autoAnalyze(entries) {
        // Called immediately after stop — but blob may not be ready yet.
        // Real analysis is triggered with blob in app.js doStop flow.
        if (!entries.length) return null;
        const local = localAnalyze(entries, []);
        return { summary: local.globalSummary, keypoints: local.globalKeypoints };
    }

    return {
        setDeepgramKey,
        analyze,
        getCache,
        // Legacy API (used by button handlers)
        setApiKey: () => { },   // no-op — kept so old refs don't crash
        isEnabled: () => true,
        hasApiKey: () => !!_dgKey,
        summarize,
        extractKeyPoints,
        analyzeTones,
        autoAnalyze,
    };
})();
