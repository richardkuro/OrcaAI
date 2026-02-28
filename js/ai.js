/* ============================================================
   ai.js — AI summarization, key points, tone analysis
   Dual mode: Local (no API) or Gemini API
   ============================================================ */

const AI = (() => {
    'use strict';

    let apiKey = null;
    let enabled = false;       // API enabled
    let localMode = true;      // Always available as fallback

    function setApiKey(key) {
        apiKey = key;
        enabled = !!key;
        console.log('[AI] Mode:', enabled ? 'Gemini API' : 'Local (no API)');
    }

    function isEnabled() { return true; } // Always enabled (local fallback)
    function hasApiKey() { return enabled; }

    // ══════════════════════════════════════════════════════
    //  LOCAL SUMMARIZATION (No API needed, runs instantly)
    // ══════════════════════════════════════════════════════

    function localSummarize(entries) {
        if (!entries.length) return { summary: 'No transcript yet.', keypoints: [], tone: '' };

        // Group by speaker
        const bySpeaker = {};
        entries.forEach(e => {
            if (!bySpeaker[e.speakerName]) bySpeaker[e.speakerName] = [];
            bySpeaker[e.speakerName].push(e);
        });

        const speakerNames = Object.keys(bySpeaker);
        const totalWords = entries.reduce((s, e) => s + e.text.split(/\s+/).length, 0);
        const duration = entries.length > 0 ?
            `from ${entries[0].time} to ${entries[entries.length - 1].time}` : '';

        // ── Summary ──
        const speakerParts = speakerNames.map(name => {
            const count = bySpeaker[name].length;
            const words = bySpeaker[name].reduce((s, e) => s + e.text.split(/\s+/).length, 0);
            return `${name} (${count} statements, ~${words} words)`;
        });
        const summary = `Meeting with ${speakerNames.length} speaker(s): ${speakerParts.join(', ')}. ` +
            `Total: ${entries.length} transcript entries, ~${totalWords} words ${duration}. ` +
            getMeetingFlow(entries);

        // ── Key Points (extract important sentences) ──
        const keypoints = extractKeyPoints(entries);

        // ── Tone ──
        const toneCounts = {};
        entries.forEach(e => { toneCounts[e.tone] = (toneCounts[e.tone] || 0) + 1; });
        const sorted = Object.entries(toneCounts).sort((a, b) => b[1] - a[1]);
        const toneLines = sorted.map(([t, c]) =>
            `${t}: ${c} entries (${Math.round(c / entries.length * 100)}%)`
        );

        const speakerTones = speakerNames.map(name => {
            const sTones = {};
            bySpeaker[name].forEach(e => { sTones[e.tone] = (sTones[e.tone] || 0) + 1; });
            const top = Object.entries(sTones).sort((a, b) => b[1] - a[1])[0];
            return `${name}: primarily ${top ? top[0] : 'neutral'}`;
        });

        const tone = `Overall distribution:\n${toneLines.join('\n')}\n\nBy speaker:\n${speakerTones.join('\n')}`;

        return { summary, keypoints, tone };
    }

    function getMeetingFlow(entries) {
        if (entries.length < 3) return '';
        const third = Math.floor(entries.length / 3);
        const segments = [
            entries.slice(0, third),
            entries.slice(third, third * 2),
            entries.slice(third * 2),
        ];
        const toneOf = seg => {
            const tc = {};
            seg.forEach(e => { tc[e.tone] = (tc[e.tone] || 0) + 1; });
            return Object.entries(tc).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';
        };
        return `The meeting began ${toneOf(segments[0])}, continued ${toneOf(segments[1])}, and ended ${toneOf(segments[2])}.`;
    }

    function extractKeyPoints(entries) {
        // Score sentences by importance keywords
        const importantWords = new Set([
            'important', 'critical', 'urgent', 'deadline', 'decide', 'decision',
            'agree', 'agreed', 'action', 'must', 'should', 'need', 'priority',
            'next', 'plan', 'goal', 'result', 'conclusion', 'propose', 'proposal',
            'approve', 'approval', 'budget', 'schedule', 'milestone', 'risk',
            'issue', 'problem', 'solution', 'resolved', 'fix', 'update',
            'launch', 'release', 'deploy', 'deliver', 'complete', 'finish',
        ]);

        const scored = entries.map(e => {
            const words = e.text.toLowerCase().split(/\s+/);
            let score = 0;
            words.forEach(w => { if (importantWords.has(w)) score += 2; });
            if (e.tone === 'serious') score += 3;
            if (e.tone === 'excited') score += 1;
            if (e.text.includes('?')) score += 1;
            score += Math.min(words.length / 10, 2); // Longer sentences slightly preferred
            return { entry: e, score };
        });

        scored.sort((a, b) => b.score - a.score);

        // Take top 5-7 unique
        const seen = new Set();
        const points = [];
        for (const { entry } of scored) {
            const normalized = entry.text.toLowerCase().trim();
            if (seen.has(normalized) || normalized.length < 10) continue;
            seen.add(normalized);
            points.push(`[${entry.speakerName}]: "${entry.text}"`);
            if (points.length >= 7) break;
        }
        return points.length ? points : ['No significant key points detected.'];
    }

    // ══════════════════════════════════════════════════════
    //  GEMINI API (optional, for richer analysis)
    // ══════════════════════════════════════════════════════

    async function callGemini(prompt) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: 2500, temperature: 0.7 },
            }),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`Gemini API error (${res.status}): ${errText.substring(0, 150)}`);
        }
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    function buildTranscriptText(entries) {
        return entries.map(e => `[${e.speakerName}] (${e.tone}): ${e.text}`).join('\n');
    }

    async function geminiAnalyze(entries) {
        const txt = buildTranscriptText(entries);
        const result = await callGemini(
            `Analyze this meeting transcript. Provide ALL of the following in ONE response:

SUMMARY:
[3-5 sentence summary]

KEY POINTS:
1. [point]
2. [point]
...

TONE:
[tone analysis by speaker]

Transcript:
${txt}`
        );

        const summaryMatch = result.match(/SUMMARY:\s*([\s\S]*?)(?=KEY POINTS:|$)/i);
        const keypointsMatch = result.match(/KEY POINTS:\s*([\s\S]*?)(?=TONE:|$)/i);
        const toneMatch = result.match(/TONE:\s*([\s\S]*?)$/i);

        const summary = summaryMatch ? summaryMatch[1].trim() : result;
        const keypoints = [];
        if (keypointsMatch) {
            keypointsMatch[1].trim().split('\n').forEach(line => {
                const cleaned = line.replace(/^\d+\.\s*/, '').trim();
                if (cleaned) keypoints.push(cleaned);
            });
        }
        return { summary, keypoints, tone: toneMatch ? toneMatch[1].trim() : '' };
    }

    // ══════════════════════════════════════════════════════
    //  PUBLIC API (tries Gemini first, falls back to local)
    // ══════════════════════════════════════════════════════

    let cachedAnalysis = null;
    let cachedCount = 0;

    async function getAnalysis(entries) {
        if (cachedAnalysis && entries.length === cachedCount) return cachedAnalysis;

        if (enabled) {
            try {
                cachedAnalysis = await geminiAnalyze(entries);
                cachedCount = entries.length;
                console.log('[AI] Gemini analysis complete');
                return cachedAnalysis;
            } catch (e) {
                console.warn('[AI] Gemini failed, using local:', e.message);
            }
        }
        // Local fallback (always works)
        cachedAnalysis = localSummarize(entries);
        cachedCount = entries.length;
        console.log('[AI] Local analysis complete');
        return cachedAnalysis;
    }

    async function summarize(entries) { return (await getAnalysis(entries)).summary; }
    async function extractKeyPointsPublic(entries) { return (await getAnalysis(entries)).keypoints; }
    async function analyzeTones(entries) { return (await getAnalysis(entries)).tone || 'No data.'; }

    async function autoAnalyze(entries) {
        if (!entries.length) return null;
        console.log('[AI] Auto-analyzing meeting...');
        const a = await getAnalysis(entries);
        return { summary: a.summary, keypoints: a.keypoints };
    }

    return {
        setApiKey,
        isEnabled,
        hasApiKey,
        summarize,
        extractKeyPoints: extractKeyPointsPublic,
        analyzeTones,
        autoAnalyze,
    };
})();
