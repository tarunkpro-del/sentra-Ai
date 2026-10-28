import { chromium } from 'playwright';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Launch a Chromium browser with:
 * - Geolocation + notification permissions GRANTED (no browser popups)
 * - Stealth anti-bot settings
 * - Always headless on production/Linux servers, headed only locally with HEADLESS=false
 */
export async function launchBrowser(url) {
    const forceHeaded = process.env.HEADLESS === 'false';
    const isServer = process.env.NODE_ENV === 'production' || (process.platform === 'linux' && !process.env.DISPLAY);
    const headless = forceHeaded ? false : (isServer ? true : false);
    const browser = await chromium.launch({
        headless,
        slowMo: headless ? 0 : 50,
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=VizDisplayCompositor',
            '--disable-web-security',
            '--disable-setuid-sandbox',
            '--disable-automation',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-infobars',
            '--window-size=1440,900',
            '--start-maximized',
            '--use-fake-ui-for-media-stream',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-client-side-phishing-detection',
            '--disable-component-update',
        ],
        timeout: 15000,
    });

    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        ignoreHTTPSErrors: true,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        locale: 'en-US',
        timezoneId: 'Asia/Kolkata',

        // ── Grant all permissions upfront so NO permission popups appear ──
        permissions: ['geolocation', 'notifications', 'clipboard-read', 'clipboard-write'],
        geolocation: { latitude: 13.0827, longitude: 80.2707 },  // Chennai coords

        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
    });

    // ── Anti-detection: hide automation indicators ──────────────────────────
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
        // Spoof permissions API so sites don't detect automation
        const origQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
        if (origQuery) {
            window.navigator.permissions.query = params =>
                params.name === 'notifications'
                    ? Promise.resolve({ state: 'granted' })
                    : origQuery(params);
        }
    });

    // ── Neutralize target="_blank" and window.open: force ALL clicks into the same tab ──
    await context.addInitScript(() => {
        // Redirect window.open to in-page navigation
        window.open = function (targetUrl) {
            if (targetUrl && typeof targetUrl === 'string') {
                try { window.location.href = targetUrl; } catch {}
            }
            return window;
        };

        // Capture phase click interceptor: strip target="_blank" BEFORE browser handles it
        document.addEventListener('click', (e) => {
            try {
                const anchor = e.target && e.target.closest ? e.target.closest('a') : null;
                if (anchor) {
                    const target = anchor.getAttribute('target');
                    if (target && target.toLowerCase() === '_blank') {
                        anchor.removeAttribute('target');
                        anchor.setAttribute('target', '_self');
                    }
                }
            } catch {}
        }, true);

        // Continuous DOM sanitizer to strip target="_blank" from any dynamically added elements
        const stripBlank = () => {
            try {
                const anchors = document.querySelectorAll('a[target="_blank"], a[target="_BLANK"]');
                for (let i = 0; i < anchors.length; i++) {
                    anchors[i].removeAttribute('target');
                    anchors[i].setAttribute('target', '_self');
                }
            } catch {}
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', stripBlank);
        } else {
            stripBlank();
        }
        const observer = new MutationObserver(stripBlank);
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    });

    // ── Hard tab limiter: enforce MAXIMUM 6 tabs across the entire browser context ──
    const MAX_ALLOWED_TABS = 6;
    context.on('page', async (newPage) => {
        try {
            // Small pause so newPage state stabilizes
            await sleep(100);
            const openPages = context.pages().filter(p => !p.isClosed());
            if (openPages.length > MAX_ALLOWED_TABS) {
                console.log(`[Browser] ⚠ Tab limit reached (${openPages.length} > ${MAX_ALLOWED_TABS}). Auto-closing extra tab.`);
                await newPage.close().catch(() => {});
            }
        } catch {}
    });

    const page = await context.newPage();

    // Navigate — fast timeout, continue if slow
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch {
        // Page may still have loaded enough — continue
        console.log(`[browser] goto timeout — continuing anyway`);
    }

    await sleep(1500); // let JS settle

    return { page, browser, context };
}

/**
 * Close the browser gracefully.
 */
export async function closeBrowser(browser) {
    try { if (browser) await browser.close(); } catch { }
}

/**
 * Switch viewport for responsive testing.
 */
export async function switchViewport(page, type) {
    const vp = { desktop: { width: 1440, height: 900 }, tablet: { width: 768, height: 1024 }, mobile: { width: 375, height: 812 } };
    await page.setViewportSize(vp[type] || vp.desktop);
}
