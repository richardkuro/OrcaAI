window.ENV = {};
window.loadEnv = async function () {
    try {
        // 1. Try Vercel Serverless API first
        const apiRes = await fetch('/api/config').catch(() => null);
        if (apiRes && apiRes.ok) {
            const config = await apiRes.json();
            window.ENV = { ...window.ENV, ...config };
            console.log('[Orca] Environment loaded from Vercel API');
        }

        // 2. Try Local .env for development (only if key not found yet)
        if (!window.ENV.DEEPGRAM_API_KEY) {
            const res = await fetch('.env');
            if (res.ok) {
                const text = await res.text();
                text.split('\n').forEach(line => {
                    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
                    if (match) {
                        const key = match[1];
                        let value = match[2] || '';
                        value = value.replace(/^(['"])(.*)\1$/, '$2').trim();
                        window.ENV[key] = value;
                    }
                });
                console.log('[Orca] Environment loaded from local .env');
            }
        }
    } catch (e) {
        console.warn('[Orca] Environment loading partially failed:', e);
    }
};
