/**
 * safe-navigate.js — SPA-aware navigation with 404 detection
 *
 * Wraps page.goto to detect 404/Not Found responses and report them as bugs.
 * Used by all agents to ensure broken pages are always caught.
 */

/**
 * Navigate to a URL and check for 404 errors.
 *
 * @param {import('playwright').Page} page - Playwright page
 * @param {string} url - URL to navigate to
 * @param {object} options - Navigation options
 * @param {number} options.timeout - Navigation timeout (default 20000)
 * @param {Array} options.bugList - Array to push bugs into (optional)
 * @param {Function} options.log - Logging function (optional)
 * @param {string} options.source - Bug source label (default 'navigator')
 * @returns {{ ok: boolean, status: number|null }} Navigation result
 */
export async function safeNavigate(page, url, options = {}) {
    const {
        timeout = 20000,
        bugList = null,
        log = () => { },
        source = 'navigator',
    } = options;

    try {
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout,
        });

        const status = response?.status?.() ?? null;

        // Check HTTP status
        if (status && status >= 400) {
            log(`⚠️ HTTP ${status} on ${url}`);
            if (bugList) {
                bugList.push({
                    type: 'broken_page',
                    severity: status === 404 ? 'high' : 'medium',
                    title: `HTTP ${status} Error: ${new URL(url).pathname}`,
                    description: `Navigating to ${url} returned HTTP ${status}.`,
                    page: url,
                    expected: 'Page should load successfully (HTTP 200)',
                    actual: `Server returned HTTP ${status}`,
                    businessImpact: 'Broken pages cause users to leave, damaging SEO and conversions.',
                    source,
                });
            }
            return { ok: false, status };
        }

        // Check page content for 404/Not Found text
        const bodyText = await page.evaluate(() =>
            document.body?.innerText?.slice(0, 500) || ''
        ).catch(() => '');

        const is404Content = /404|not\s*found|page\s*(not|doesn.t)\s*(found|exist)/i.test(bodyText)
            && bodyText.length < 300; // Only flag if it's a short 404 page, not a page that mentions "404" incidentally

        if (is404Content) {
            log(`⚠️ 404 content detected on ${url}`);
            if (bugList) {
                bugList.push({
                    type: 'broken_page',
                    severity: 'high',
                    title: `404 Page: ${new URL(url).pathname}`,
                    description: `The page at ${url} shows "404 / Not Found" content.`,
                    page: url,
                    expected: 'Page should display proper content',
                    actual: `Page shows: "${bodyText.slice(0, 100)}"`,
                    businessImpact: 'Broken pages cause users to leave, damaging SEO and conversions.',
                    source,
                });
            }
            return { ok: false, status: 404 };
        }

        return { ok: true, status: status || 200 };

    } catch (err) {
        log(`⚠️ Navigation failed: ${url} — ${err.message?.slice(0, 60)}`);
        return { ok: false, status: null };
    }
}
