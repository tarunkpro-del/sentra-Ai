import { switchViewport } from './browser.js';
import { extractPageState } from './extractor.js';

/**
 * Run all validation checks — rule-based, zero AI.
 * Includes new checks for text spacing bugs, contradictions,
 * broken buttons, responsive issues, and more.
 */
export async function runAllValidations(page, pageState) {
    const issues = [];

    // 1. Text spacing / whitespace bugs
    const textBugs = await checkTextSpacing(page);
    issues.push(...textBugs);

    // 2. Broken links (quick HEAD check)
    const brokenLinks = await checkBrokenLinks(pageState);
    issues.push(...brokenLinks);

    // 3. Form validation
    const formIssues = await checkFormValidation(page, pageState);
    issues.push(...formIssues);

    // 4. Button functionality
    const buttonIssues = await checkButtonFunctionality(page, pageState);
    issues.push(...buttonIssues);

    // 5. Page load performance
    const loadIssues = await checkPageLoadTime(page);
    issues.push(...loadIssues);

    // 6. Responsive comparison
    const responsiveIssues = await checkResponsive(page);
    issues.push(...responsiveIssues);

    // 7. Image alt text
    const imageIssues = await checkImageAltText(page);
    issues.push(...imageIssues);

    // 8. Meta tags / SEO
    const metaIssues = await checkMetaTags(page);
    issues.push(...metaIssues);

    // 9. Content contradiction check
    const contradictions = await checkContradictions(page);
    issues.push(...contradictions);

    // 10. Overflow / clipping
    const overflowIssues = await checkOverflow(page);
    issues.push(...overflowIssues);

    // 11. Color contrast (WCAG AA)
    const contrastIssues = await checkColorContrast(page);
    issues.push(...contrastIssues);

    // 12. Text overflow on mobile
    const textOverflowIssues = await checkTextOverflowMobile(page);
    issues.push(...textOverflowIssues);

    // 13. Buttons invisible on mobile
    const invisibleBtnIssues = await checkButtonsInvisibleMobile(page);
    issues.push(...invisibleBtnIssues);

    return issues;
}

// ──────────────────────────────────────────────
// NEW: Text spacing / whitespace bug detection
// Catches bugs like "Star t Test" or "Boo k Now"
// ──────────────────────────────────────────────
async function checkTextSpacing(page) {
    const issues = [];
    try {
        const bugs = await page.evaluate(() => {
            const found = [];
            const els = document.querySelectorAll('button, a, h1, h2, h3, span, p, label, [role="button"]');
            const regex = /[a-zA-Z]\s[a-zA-Z]{1,2}\s[a-zA-Z]/; // e.g. "a t test"
            const singleCharGap = /(?<=[a-z])\s(?=[a-z]\s)/gi; // single char surrounded by spaces

            els.forEach(el => {
                const text = el.textContent?.trim();
                if (!text || text.length > 60 || text.length < 3) return;

                // Check for suspicious single-char word gaps inside what should be one word
                const words = text.split(/\s+/);
                for (let i = 1; i < words.length - 1; i++) {
                    if (words[i].length === 1 && /^[a-z]$/i.test(words[i])) {
                        // Single letter surrounded by words — likely a spacing bug
                        found.push({
                            text: text.slice(0, 50),
                            tag: el.tagName.toLowerCase(),
                            issue: `Suspicious spacing: "${text.slice(0, 40)}"`,
                        });
                        break;
                    }
                }
            });
            return found.slice(0, 5);
        });

        // Only report if 2+ separate elements have suspicious spacing
        if (bugs.length >= 2) {
            for (const bug of bugs.slice(0, 3)) {
                issues.push({
                    type: 'text-spacing',
                    severity: 'low',
                    message: `Text spacing bug in <${bug.tag}>: ${bug.issue}`,
                    details: bug,
                });
            }
        }
    } catch { }
    return issues;
}

// ──────────────────────────────────────────────
// NEW: Content contradiction check
// e.g. "No results found" + results visible below
// ──────────────────────────────────────────────
async function checkContradictions(page) {
    const issues = [];
    try {
        const contradictions = await page.evaluate(() => {
            const found = [];

            // Check for "no results" + results visible
            const allText = document.body.innerText.toLowerCase();
            const hasNoResults = allText.match(/no\s+(results?|items?|products?|buses?|flights?)\s+(found|available)/i);

            if (hasNoResults) {
                // Look for list items, cards, or result-like elements
                const resultPatterns = document.querySelectorAll(
                    '.result, .card, .item, .listing, .product, [class*="result"], [class*="card"], [class*="list-item"]'
                );
                let visibleResults = 0;
                resultPatterns.forEach(el => {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) visibleResults++;
                });

                if (visibleResults > 0) {
                    found.push({
                        message: `"${hasNoResults[0]}" displayed but ${visibleResults} result elements are visible`,
                        type: 'contradiction',
                    });
                }
            }

            return found;
        });

        for (const c of contradictions) {
            issues.push({
                type: 'contradiction',
                severity: 'high',
                message: c.message,
                details: c,
            });
        }
    } catch { }
    return issues;
}

// ──────────────────────────────────────────────
// Button functionality check
// Only flag truly broken buttons (no-op clicks) — skip navigation/action buttons
// ──────────────────────────────────────────────
async function checkButtonFunctionality(page, pageState) {
    const issues = [];
    // Skip buttons that are expected to navigate or open modals
    const SKIP_PATTERNS = /sign|log|cart|account|menu|home|back|close|search|add|buy|proceed|checkout|pay|submit|continue|register|login|next|prev|share|save|delete|remove|open|toggle/i;
    try {
        const buttons = (pageState.buttons || []).slice(0, 8);
        let noOpCount = 0;

        for (const btn of buttons) {
            if (!btn.text || btn.text.length < 2) continue;
            if (SKIP_PATTERNS.test(btn.text)) continue;

            try {
                const beforeUrl = page.url();
                const beforeHtml = await page.evaluate(() => document.body.innerHTML.length);

                const el = page.getByText(btn.text, { exact: true }).first();
                if (await el.isVisible({ timeout: 800 })) {
                    await el.click({ timeout: 2000, force: false });
                    await page.waitForTimeout(600);

                    const afterUrl = page.url();
                    // Navigate back if went to another page
                    if (afterUrl !== beforeUrl) {
                        try { await page.goBack({ timeout: 5000 }); await page.waitForTimeout(500); } catch { }
                        continue; // navigation = button works fine
                    }
                    const afterHtml = await page.evaluate(() => document.body.innerHTML.length);

                    // Only flag if DOM barely changed (threshold 500 bytes) meaning truly no-op
                    if (Math.abs(beforeHtml - afterHtml) < 500) {
                        noOpCount++;
                    }
                }
            } catch {
                // Navigation or modal close is fine
            }
        }
        // Only report if 3+ buttons are truly no-op (single button "doing nothing" may be intentional)
        if (noOpCount >= 3) {
            issues.push({
                type: 'broken-button',
                severity: 'medium',
                message: `${noOpCount} buttons clicked with no visible page change — may indicate broken interactions`,
                details: { noOpCount },
            });
        }
    } catch { }
    return issues;
}

// ──────────────────────────────────────────────
// NEW: Overflow / clipping detection
// ──────────────────────────────────────────────
async function checkOverflow(page) {
    const issues = [];
    try {
        const overflows = await page.evaluate(() => {
            const found = [];
            const els = document.querySelectorAll('*');
            const viewport = { w: window.innerWidth, h: window.innerHeight };

            for (let i = 0; i < Math.min(els.length, 500); i++) {
                const el = els[i];
                const rect = el.getBoundingClientRect();

                // Check if element extends beyond viewport horizontally
                if (rect.width > 0 && rect.right > viewport.w + 10) {
                    const tag = el.tagName.toLowerCase();
                    if (['script', 'style', 'link', 'meta', 'head'].includes(tag)) continue;
                    found.push({
                        tag,
                        className: (el.className || '').toString().slice(0, 40),
                        overflow: Math.round(rect.right - viewport.w),
                    });
                    if (found.length >= 3) break;
                }
            }
            return found;
        });

        for (const o of overflows) {
            issues.push({
                type: 'overflow',
                severity: 'low',
                message: `<${o.tag}> overflows viewport by ${o.overflow}px (class: ${o.className || 'none'})`,
                details: o,
            });
        }
    } catch { }
    return issues;
}

// ──────────────────────────────────────────────
// Existing checks (kept and improved)
// ──────────────────────────────────────────────

async function checkBrokenLinks(pageState) {
    const issues = [];
    const links = pageState?.links || [];
    const linksToCheck = links.filter(l => l?.href?.startsWith('http')).slice(0, 8);

    for (const link of linksToCheck) {
        try {
            let response = await fetch(link.href, {
                method: 'HEAD',
                signal: AbortSignal.timeout(3000),
            }).catch(() => null);

            // If HEAD was rejected (e.g. 405 Method Not Allowed), retry with GET
            if (!response || response.status === 405 || response.status === 403) {
                response = await fetch(link.href, {
                    method: 'GET',
                    headers: { 'Range': 'bytes=0-100' },
                    signal: AbortSignal.timeout(3000),
                }).catch(() => null);
            }

            if (response && (response.status === 404 || response.status >= 500)) {
                issues.push({
                    type: 'broken-link',
                    severity: response.status === 404 ? 'high' : 'medium',
                    title: `Broken Link: ${link.text || 'Navigation link'} (HTTP ${response.status})`,
                    message: `Link "${link.text || link.href}" points to ${link.href} which returned HTTP ${response.status}.`,
                    expected: 'Link should resolve to an active page (HTTP 200)',
                    actual: `Destination returned HTTP ${response.status}`,
                    details: { href: link.href, status: response.status },
                    isVisual: false, // Don't take redundant full-page screenshot
                });
            }
        } catch { }
    }
    return issues;
}

async function checkFormValidation(page, pageState) {
    const issues = [];
    const inputs = pageState?.inputs || [];
    if ((pageState?.forms_count ?? 0) > 0) {
        try {
            const forms = await page.locator('form').all();
            for (let i = 0; i < Math.min(forms.length, 3); i++) {
                const requiredInputs = await forms[i].locator('[required]').count();
                if (requiredInputs === 0 && inputs.some(inp => inp.type === 'email' || inp.type === 'password')) {
                    issues.push({
                        type: 'form-validation',
                        severity: 'medium',
                        message: `Form ${i + 1} has sensitive inputs but no required validation`,
                        details: { formIndex: i },
                    });
                }
            }
        } catch { }
    }
    return issues;
}

async function checkPageLoadTime(page) {
    const issues = [];
    try {
        const timing = await page.evaluate(() => {
            const nav = performance.getEntriesByType('navigation')[0];
            if (nav) {
                return {
                    loadTime: nav.loadEventEnd - nav.startTime,
                    domInteractive: nav.domInteractive - nav.startTime,
                };
            }
            return null;
        });

        if (timing) {
            if (timing.loadTime > 5000) {
                issues.push({
                    type: 'slow-load',
                    severity: 'high',
                    message: `Slow page load: ${Math.round(timing.loadTime)}ms (>5s)`,
                    details: timing,
                });
            } else if (timing.loadTime > 3000) {
                issues.push({
                    type: 'slow-load',
                    severity: 'medium',
                    message: `Moderate page load: ${Math.round(timing.loadTime)}ms (>3s)`,
                    details: timing,
                });
            }
        }
    } catch { }
    return issues;
}

async function checkResponsive(page) {
    const issues = [];
    try {
        const desktopState = await extractPageState(page);
        const desktopButtons = desktopState.buttons?.length ?? 0;
        const desktopLinks = desktopState.links?.length ?? 0;
        const desktopNavItems = desktopState.nav_items?.length ?? 0;

        await switchViewport(page, 'mobile');
        await page.waitForTimeout(1200);
        const mobileState = await extractPageState(page);
        const mobileButtons = mobileState.buttons?.length ?? 0;
        const mobileLinks = mobileState.links?.length ?? 0;
        const mobileNavItems = mobileState.nav_items?.length ?? 0;

        // Missing buttons on mobile
        if (desktopButtons > 0 && mobileButtons === 0) {
            issues.push({
                type: 'responsive-missing',
                severity: 'high',
                message: `All ${desktopButtons} buttons missing on mobile viewport`,
                details: { desktop: desktopButtons, mobile: mobileButtons },
            });
        } else if (desktopButtons > mobileButtons + 2) {
            issues.push({
                type: 'responsive-missing',
                severity: 'medium',
                message: `${desktopButtons - mobileButtons} buttons missing on mobile (${desktopButtons} → ${mobileButtons})`,
                details: { desktop: desktopButtons, mobile: mobileButtons },
            });
        }

        // Missing nav items
        if (desktopNavItems > 0 && mobileNavItems === 0) {
            issues.push({
                type: 'responsive-missing',
                severity: 'medium',
                message: `Navigation items not visible on mobile (${desktopNavItems} items hidden)`,
                details: { desktop: desktopNavItems, mobile: mobileNavItems },
            });
        }

        // Missing links
        if (desktopLinks > mobileLinks + 5) {
            issues.push({
                type: 'responsive-missing',
                severity: 'low',
                message: `${desktopLinks - mobileLinks} links missing on mobile`,
                details: { desktop: desktopLinks, mobile: mobileLinks },
            });
        }

        // Switch back
        await switchViewport(page, 'desktop');
    } catch { }
    return issues;
}

async function checkImageAltText(page) {
    const issues = [];
    try {
        const missingAlt = await page.evaluate(() => {
            const imgs = document.querySelectorAll('img');
            let missing = 0;
            imgs.forEach(img => { if (!img.alt || img.alt.trim() === '') missing++; });
            return { total: imgs.length, missing };
        });

        if (missingAlt.missing > 0) {
            issues.push({
                type: 'accessibility',
                severity: missingAlt.missing > 5 ? 'medium' : 'low',
                message: `${missingAlt.missing}/${missingAlt.total} images missing alt text`,
                details: missingAlt,
            });
        }
    } catch { }
    return issues;
}

async function checkMetaTags(page) {
    const issues = [];
    try {
        const meta = await page.evaluate(() => ({
            hasTitle: !!document.title,
            titleLength: document.title?.length || 0,
            hasDescription: !!document.querySelector('meta[name="description"]'),
            hasViewport: !!document.querySelector('meta[name="viewport"]'),
            hasH1: !!document.querySelector('h1'),
            h1Count: document.querySelectorAll('h1').length,
        }));

        if (!meta.hasTitle) issues.push({ type: 'seo', severity: 'high', message: 'Missing title tag', details: meta });
        if (!meta.hasDescription) issues.push({ type: 'seo', severity: 'medium', message: 'Missing meta description', details: meta });
        if (!meta.hasViewport) issues.push({ type: 'seo', severity: 'high', message: 'Missing viewport meta (not mobile-friendly)', details: meta });
        if (!meta.hasH1) issues.push({ type: 'seo', severity: 'medium', message: 'Missing H1 heading', details: meta });
        else if (meta.h1Count > 1) issues.push({ type: 'seo', severity: 'low', message: `${meta.h1Count} H1 tags found (should be 1)`, details: meta });
    } catch { }
    return issues;
}

// ──────────────────────────────────────────────
// NEW: Color contrast check (WCAG AA ≥ 4.5:1)
// Detects buttons/text where fg and bg colors are too similar
// ──────────────────────────────────────────────
async function checkColorContrast(page) {
    const issues = [];
    try {
        const results = await page.evaluate(() => {
            function luminance(r, g, b) {
                const a = [r, g, b].map(v => {
                    v /= 255;
                    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
                });
                return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
            }

            function parseColor(str) {
                const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (match) return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
                return null;
            }

            function contrastRatio(l1, l2) {
                const lighter = Math.max(l1, l2);
                const darker = Math.min(l1, l2);
                return (lighter + 0.05) / (darker + 0.05);
            }

            const found = [];
            const els = document.querySelectorAll('button, a, h1, h2, h3, [role="button"], .btn, [class*="btn"]');

            for (let i = 0; i < Math.min(els.length, 30); i++) {
                const el = els[i];
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;

                const style = window.getComputedStyle(el);
                const fg = parseColor(style.color);
                const bg = parseColor(style.backgroundColor);

                if (!fg || !bg) continue;
                // Skip transparent backgrounds
                const bgA = style.backgroundColor.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/);
                if (bgA && parseFloat(bgA[1]) < 0.1) continue;

                const fgL = luminance(fg[0], fg[1], fg[2]);
                const bgL = luminance(bg[0], bg[1], bg[2]);
                const ratio = contrastRatio(fgL, bgL);

                if (ratio < 2.5) { // Only flag truly terrible contrast (< 2.5:1)
                    found.push({
                        tag: el.tagName.toLowerCase(),
                        text: (el.textContent || '').trim().slice(0, 30),
                        ratio: Math.round(ratio * 100) / 100,
                        fgColor: style.color,
                        bgColor: style.backgroundColor,
                    });
                }
                if (found.length >= 5) break;
            }
            return found;
        });

        for (const r of results) {
            issues.push({
                type: 'color-contrast',
                severity: r.ratio < 2 ? 'high' : 'medium',
                message: `Low contrast (${r.ratio}:1) on <${r.tag}> "${r.text}" — fg: ${r.fgColor}, bg: ${r.bgColor}. WCAG AA requires ≥4.5:1`,
                details: r,
            });
        }
    } catch { }
    return issues;
}

// ──────────────────────────────────────────────
// NEW: Text overflow on mobile
// Detects text that clips or overflows on mobile viewport
// ──────────────────────────────────────────────
async function checkTextOverflowMobile(page) {
    const issues = [];
    try {
        await switchViewport(page, 'mobile');
        await page.waitForTimeout(1200);

        const overflows = await page.evaluate(() => {
            const found = [];
            const els = document.querySelectorAll('h1, h2, h3, p, span, a, button, div, li');

            for (let i = 0; i < Math.min(els.length, 200); i++) {
                const el = els[i];
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;

                // Check if text overflows its container
                if (el.scrollWidth > el.clientWidth + 5) {
                    const text = (el.textContent || '').trim().slice(0, 40);
                    if (!text || text.length < 3) continue;
                    found.push({
                        tag: el.tagName.toLowerCase(),
                        text,
                        scrollWidth: el.scrollWidth,
                        clientWidth: el.clientWidth,
                        overflow: el.scrollWidth - el.clientWidth,
                    });
                }

                // Check if element goes outside viewport
                if (rect.right > window.innerWidth + 5) {
                    const text = (el.textContent || '').trim().slice(0, 40);
                    if (!text || text.length < 3) continue;
                    found.push({
                        tag: el.tagName.toLowerCase(),
                        text,
                        rightEdge: Math.round(rect.right),
                        viewportWidth: window.innerWidth,
                        overflow: Math.round(rect.right - window.innerWidth),
                    });
                }

                if (found.length >= 5) break;
            }
            return found;
        });

        for (const o of overflows) {
            issues.push({
                type: 'text-overflow-mobile',
                severity: 'medium',
                message: `Text overflows on mobile: <${o.tag}> "${o.text}" exceeds by ${o.overflow}px`,
                details: o,
            });
        }

        await switchViewport(page, 'desktop');
    } catch {
        try { await switchViewport(page, 'desktop'); } catch { }
    }
    return issues;
}

// ──────────────────────────────────────────────
// NEW: Buttons invisible on mobile
// Detects buttons visible on desktop but hidden/invisible on mobile
// ──────────────────────────────────────────────
async function checkButtonsInvisibleMobile(page) {
    const issues = [];
    try {
        // Get desktop buttons
        const desktopButtons = await page.evaluate(() => {
            const btns = document.querySelectorAll('button, [role="button"], input[type="submit"], .btn, [class*="btn"]');
            const found = [];
            btns.forEach(b => {
                const rect = b.getBoundingClientRect();
                const style = window.getComputedStyle(b);
                if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
                    found.push({
                        text: (b.textContent || '').trim().slice(0, 30),
                        classes: (b.className || '').toString().slice(0, 50),
                        id: b.id || '',
                    });
                }
            });
            return found;
        });

        // Switch to mobile
        await switchViewport(page, 'mobile');
        await page.waitForTimeout(1200);

        const mobileButtons = await page.evaluate(() => {
            const btns = document.querySelectorAll('button, [role="button"], input[type="submit"], .btn, [class*="btn"]');
            const found = [];
            btns.forEach(b => {
                const rect = b.getBoundingClientRect();
                const style = window.getComputedStyle(b);
                if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                    found.push((b.textContent || '').trim().slice(0, 30));
                }
            });
            return found;
        });

        // Compare
        for (const dBtn of desktopButtons) {
            if (dBtn.text && dBtn.text.length > 1 && !mobileButtons.some(m => m.includes(dBtn.text) || dBtn.text.includes(m))) {
                issues.push({
                    type: 'button-invisible-mobile',
                    severity: 'high',
                    message: `Button "${dBtn.text}" visible on desktop but NOT visible on mobile`,
                    details: dBtn,
                });
            }
        }

        await switchViewport(page, 'desktop');
    } catch {
        try { await switchViewport(page, 'desktop'); } catch { }
    }
    return issues;
}

/**
 * Run rule-based checks scoped to each SENTRA QA agent (C–H).
 * `flags` tracks one-shot suites (responsive, performance) per worker run.
 */
export async function runAgentValidations(workerId, page, pageState, flags = {}) {
    const ps = {
        ...pageState,
        links: pageState?.links || [],
        buttons: pageState?.buttons || [],
        nav_items: pageState?.nav_items || [],
        inputs: pageState?.inputs || [],
        forms_count: pageState?.forms_count ?? 0,
    };
    const issues = [];

    try {
        switch (workerId) {
            case 'C':
                if (!flags.uiSuiteDone) {
                    flags.uiSuiteDone = true;
                    issues.push(...await checkOverflow(page));
                    issues.push(...await checkTextSpacing(page));
                    issues.push(...await checkColorContrast(page));
                    issues.push(...await checkResponsive(page));
                    issues.push(...await checkTextOverflowMobile(page));
                    issues.push(...await checkButtonsInvisibleMobile(page));
                    issues.push(...await checkMetaTags(page));
                } else {
                    issues.push(...await checkOverflow(page));
                }
                break;
            case 'D':
                if (!flags.linksChecked) {
                    flags.linksChecked = true;
                    issues.push(...await checkBrokenLinks(ps));
                }
                issues.push(...await checkContradictions(page));
                break;
            case 'E':
                issues.push(...await checkFormValidation(page, ps));
                if (!flags.securityMetaDone) {
                    flags.securityMetaDone = true;
                    issues.push(...await checkMetaTags(page));
                }
                break;
            case 'F':
                if (!flags.perfDone) {
                    flags.perfDone = true;
                    issues.push(...await checkPageLoadTime(page));
                }
                break;
            case 'G':
                issues.push(...await checkFormValidation(page, ps));
                break;
            case 'H':
                issues.push(...await checkContradictions(page));
                break;
            default:
                break;
        }
    } catch (err) {
        console.log(`[validator] Agent ${workerId}: ${err.message?.slice(0, 60)}`);
    }

    return issues;
}
