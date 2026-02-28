/* ============================================================
   export.js — Export transcript as TXT, JSON, Markdown
   ============================================================ */

const Export = (() => {
    'use strict';

    function download(filename, content, type = 'text/plain') {
        const blob = new Blob([content], { type });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        console.log('[Export] Downloaded:', filename);
    }

    // ── TXT export ──
    function asTxt(entries, summary, keypoints) {
        if (!entries.length) { alert('No transcript to export.'); return; }

        let txt = '═══════════════════════════════════\n';
        txt += '  ORCA — Meeting Transcript\n';
        txt += '  ' + new Date().toLocaleString() + '\n';
        txt += '═══════════════════════════════════\n\n';

        entries.forEach(e => {
            txt += `[${e.time}] ${e.speakerName} (${e.tone}):\n`;
            txt += `  ${e.text}\n\n`;
        });

        if (summary) {
            txt += '\n─── SUMMARY ───\n' + summary + '\n';
        }
        if (keypoints && keypoints.length) {
            txt += '\n─── KEY POINTS ───\n';
            keypoints.forEach((p, i) => { txt += `${i + 1}. ${p}\n`; });
        }

        download('meeting-transcript.txt', txt);
    }

    // ── JSON export ──
    function asJson(entries, summary, keypoints) {
        if (!entries.length) { alert('No transcript to export.'); return; }

        const data = {
            metadata: {
                exportedAt: new Date().toISOString(),
                generator: 'Orca',
                entryCount: entries.length,
                speakerCount: new Set(entries.map(e => e.speakerId)).size,
            },
            summary: summary || null,
            keyPoints: keypoints || [],
            entries: entries,
        };

        download('meeting-transcript.json', JSON.stringify(data, null, 2), 'application/json');
    }

    // ── Markdown export ──
    function asMarkdown(entries, summary, keypoints) {
        if (!entries.length) { alert('No transcript to export.'); return; }

        let md = '# Meeting Transcript\n\n';
        md += `**Date:** ${new Date().toLocaleString()}  \n`;
        md += `**Speakers:** ${[...new Set(entries.map(e => e.speakerName))].join(', ')}  \n`;
        md += `**Entries:** ${entries.length}  \n\n`;

        if (summary) {
            md += '## Summary\n\n' + summary + '\n\n';
        }
        if (keypoints && keypoints.length) {
            md += '## Key Points\n\n';
            keypoints.forEach((p, i) => { md += `${i + 1}. ${p}\n`; });
            md += '\n';
        }

        md += '## Transcript\n\n';
        entries.forEach(e => {
            md += `**${e.speakerName}** _(${e.time} · ${e.tone})_  \n`;
            md += `${e.text}\n\n`;
        });

        download('meeting-transcript.md', md);
    }

    return { asTxt, asJson, asMarkdown };
})();
