/* ============================================================
   transcript.js — Emotion detection & transcript rendering
   with smooth speaker change separators
   ============================================================ */

const Transcript = (() => {
    'use strict';

    // ── Emotion detection (keyword-based) ──
    const EMOTION_PATTERNS = {
        angry: {
            re: /\b(angry|furious|frustrated|upset|ridiculous|unacceptable|terrible|worst|hate|awful|stupid|absurd|nonsense|outrageous|disgusting|damn|hell|annoying|infuriating|mad|pissed|livid|rage)\b|!{2,}/i,
            emoji: '😠', color: '#ef4444',
        },
        excited: {
            re: /\b(amazing|awesome|fantastic|great|excellent|brilliant|incredible|wonderful|exciting|thrilled|love|perfect|outstanding|wow|extraordinary|phenomenal|superb|magnificent)\b|!{2,}/i,
            emoji: '🤩', color: '#f97316',
        },
        happy: {
            re: /\b(good|nice|glad|happy|pleased|satisfied|grateful|thankful|appreciate|enjoy|like|fine|cheerful|delighted|content|positive|optimistic|hopeful)\b/i,
            emoji: '😊', color: '#fbbf24',
        },
        sad: {
            re: /\b(sad|unfortunate|sorry|regret|disappoint|miss|loss|fail|struggle|difficult|hard|worry|concern|afraid|painful|hurt|grief|depressing|devastating)\b/i,
            emoji: '😢', color: '#60a5fa',
        },
        confused: {
            re: /\b(confused|unclear|unsure|don't understand|what do you mean|not sure|lost|complicated|huh|pardon|clarif|puzzled|bewildered|perplexed)\b|\?{2,}/i,
            emoji: '😕', color: '#a78bfa',
        },
        serious: {
            re: /\b(important|critical|urgent|serious|significant|crucial|essential|necessary|must|should|need to|deadline|priority|imperative|mandatory|vital)\b/i,
            emoji: '🎯', color: '#6b7280',
        },
    };

    const EMOTION_META = {
        neutral: { emoji: '😐', color: '#94a3b8' },
        happy: { emoji: '😊', color: '#fbbf24' },
        excited: { emoji: '🤩', color: '#f97316' },
        angry: { emoji: '😠', color: '#ef4444' },
        sad: { emoji: '😢', color: '#60a5fa' },
        confused: { emoji: '😕', color: '#a78bfa' },
        serious: { emoji: '🎯', color: '#6b7280' },
    };

    function detectEmotion(text) {
        const lower = text.toLowerCase();
        for (const [emotion, { re }] of Object.entries(EMOTION_PATTERNS)) {
            if (re.test(lower)) return emotion;
        }
        return 'neutral';
    }

    function esc(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── Speaker change tracking ──
    let lastRenderedSpeakerId = null;
    let interimEl = null;

    function renderInterim(text) {
        const body = document.getElementById('transcriptBody');
        document.getElementById('emptyState')?.remove();

        if (!interimEl) {
            interimEl = document.createElement('div');
            interimEl.className = 'transcript-entry interim-entry';
            interimEl.id = 'interimEntry';
            interimEl.innerHTML = `
        <div class="entry-meta">
          <div class="entry-speaker" style="color:var(--muted)">...</div>
          <div class="entry-time">live</div>
        </div>
        <div class="entry-bubble">
          <div class="entry-text entry-interim"></div>
        </div>`;
            body.appendChild(interimEl);
        }
        interimEl.querySelector('.entry-text').textContent = text;
        body.scrollTop = body.scrollHeight;
    }

    function clearInterim() {
        if (interimEl) {
            interimEl.remove();
            interimEl = null;
        }
    }

    function renderEntry(entry) {
        clearInterim();
        document.getElementById('emptyState')?.remove();

        const body = document.getElementById('transcriptBody');

        // Add speaker separator when speaker changes
        if (lastRenderedSpeakerId !== null && entry.speakerId !== lastRenderedSpeakerId) {
            const sep = document.createElement('div');
            sep.className = 'speaker-separator';
            sep.innerHTML = `<div class="sep-line"></div><span class="sep-label" style="color:${entry.speakerColor}">${esc(entry.speakerName)}</span><div class="sep-line"></div>`;
            body.appendChild(sep);
        }
        lastRenderedSpeakerId = entry.speakerId;

        const el = document.createElement('div');
        el.className = 'transcript-entry';
        el.setAttribute('data-id', entry.id);
        el.setAttribute('data-speaker', entry.speakerId);

        const meta = EMOTION_META[entry.tone] || EMOTION_META.neutral;

        el.innerHTML = `
      <div class="entry-meta">
        <div class="entry-speaker" style="color:${entry.speakerColor}">${esc(entry.speakerName)}</div>
        <div class="entry-time">${entry.time}</div>
        <div class="entry-tone-badge tone-${entry.tone}">${meta.emoji} ${entry.tone}</div>
      </div>
      <div class="entry-bubble" data-emotion="${entry.tone}" style="border-color:${entry.speakerColor}22">
        <div class="entry-text">${esc(entry.text)}</div>
      </div>`;

        body.appendChild(el);
        body.scrollTop = body.scrollHeight;
        return el;
    }

    function clearTranscript() {
        clearInterim();
        lastRenderedSpeakerId = null;
        const body = document.getElementById('transcriptBody');
        body.innerHTML = `
      <div class="transcript-empty" id="emptyState">
        <div class="icon">🎙️</div>
        <p>Start recording to see live transcript</p>
      </div>`;
    }

    return {
        detectEmotion,
        renderInterim,
        clearInterim,
        renderEntry,
        clearTranscript,
        EMOTION_META,
        esc,
    };
})();
