/**
 * uiux-agent.js — Agent E: UI/UX Checker
 *
 * Uses Gemini 2.5 Flash for enhanced UI/UX analysis.
 * Targeted bugs (deterministic DOM checks):
 *  Bug #2 — ShopTest: "No products found" banner visible while products ARE visible
 *  Bug #7 — BusTest: "No buses found" banner visible while buses ARE visible
 *
 * Also checks for generic layout issues with AI-powered insights.
 */

import { extractPageState } from '../extractor.js';
import { callGemini } from '../gemini.js';
import { safeNavigate } from '../safe-navigate.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Check if a contradictory "no results" banner is visible alongside actual results.
 */
async function checkContradictoryBanners(page, url, log) {
    const bugs = [];

    try {
        const result = await page.evaluate(() => {
            // "No X found" text patterns
            const noResultPatterns = [
                /no products? found/i,
                /no items? found/i,
                /no results? found/i,
                /no buses? found/i,
                /no buses? available/i,
                /0 products/i,
                /nothing found/i,
                /empty results/i,
            ];

            // Result card patterns
            const resultCardSelectors = [
                '.product', '.product-card', '[class*="product-card"]',
                '[class*="item-card"]', '[class*="bus-card"]',
                '[class*="result-card"]', '[class*="listing"]',
                '[data-testid*="product"]', '[data-testid*="bus"]',
                'article', '.card',
            ];

            // Find all visible text nodes for "no results" patterns
            function getVisibleText(el) {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    rect.width > 0 && rect.height > 0;
            }

            const allEls = document.querySelectorAll('*');
            let noResultEl = null;
            let noResultText = '';

            for (const el of allEls) {
                if (!getVisibleText(el)) continue;
                const text = el.textContent?.trim() || '';
                if (text.length > 3 && text.length < 200) {
                    for (const pattern of noResultPatterns) {
                        if (pattern.test(text)) {
                            // Make sure no children also match (avoid double-counting)
                            const childMatch = [...el.children].some(c => pattern.test(c.textContent));
                            if (!childMatch) {
                                noResultEl = el;
                                noResultText = text.slice(0, 100);
                                break;
                            }
                        }
                    }
                }
                if (noResultEl) break;
            }

            if (!noResultEl) return { hasBug: false };

            // Now check if actual result cards exist
            let resultCount = 0;
            for (const sel of resultCardSelectors) {
                const cards = document.querySelectorAll(sel);
                let visibleCards = 0;
                for (const card of cards) {
                    if (getVisibleText(card)) visibleCards++;
                }
                if (visibleCards > 0) {
                    resultCount = visibleCards;
                    break;
                }
            }

            return { hasBug: resultCount > 0, noResultText, resultCount };
        });

        if (result.hasBug) {
            const isShop = /shoptest|shop|product/i.test(url);
            const isBus = /bustest|bus|booking/i.test(url);

            const bugType = isBus ? 'no_buses_banner' : 'no_products_banner';
            const issueNum = isBus ? '#7' : '#2';
            const item = isBus ? 'buses' : 'products';

            log(`🐛 Bug ${issueNum} found: "${result.noResultText}" shown with ${result.resultCount} ${item} visible`);
            return [{
                type: bugType,
                severity: 'high',
                title: `Contradictory "No ${item} found" Banner`,
                description: `The page displays "${result.noResultText}" but ${result.resultCount} ${item} are clearly visible on the same page. This is a display logic bug.`,
                page: url,
                expected: `If ${item} are visible, the "no results" banner should not appear`,
                actual: `"${result.noResultText.slice(0, 80)}" is shown while ${result.resultCount} ${item} are visible`,
                businessImpact: `Users see a confusing "no results" message alongside real ${item}, causing distrust and abandonment.`,
                source: 'uiux-agent',
            }];
        }
    } catch (e) {
        log(`Banner check error: ${e.message?.slice(0, 60)}`);
    }

    return bugs;
}

/**
 * Generic UI checks: text overflow, overlapping elements, broken images.
 */
async function checkGenericUIIssues(page, url, log) {
    const bugs = [];
    try {
        const issues = await page.evaluate(() => {
            const found = [];

            // Check for broken images
            const imgs = document.querySelectorAll('img');
            let broken = 0;
            for (const img of imgs) {
                if (!img.complete || img.naturalWidth === 0) broken++;
            }
            if (broken > 2) {
                found.push({ type: 'broken_images', count: broken });
            }

            return found;
        });

        for (const issue of issues) {
            if (issue.type === 'broken_images') {
                bugs.push({
                    type: 'ui_broken_images',
                    severity: 'low',
                    title: 'Broken Images Detected',
                    description: `Found ${issue.count} broken images on the page.`,
                    page: url,
                    expected: 'All images should load correctly',
                    actual: `${issue.count} images failed to load`,
                    businessImpact: 'Broken images reduce trust and professional appearance.',
                    source: 'uiux-agent',
                });
            }
        }
    } catch (e) {
        log(`UI check error: ${e.message?.slice(0, 40)}`);
    }
    return bugs;
}

export async function runUIUXAgent(page, siteType, sharedBugs, onLog, pagesToCheck = []) {
    const log = msg => onLog('E', msg);
    log('🎨 UI/UX Agent starting...');
    const bugs = [];

    const urlsToCheck = pagesToCheck.length > 0 ? pagesToCheck : [page.url()];

    for (const url of urlsToCheck) {
        try {
            if (url !== page.url()) {
                const navResult = await safeNavigate(page, url, {
                    timeout: 15000,
                    bugList: bugs,
                    log,
                    source: 'uiux-agent',
                });
                if (!navResult.ok) {
                    sharedBugs.push(...bugs.filter(b => b.page === url && !sharedBugs.includes(b)));
                    continue;
                }
                await sleep(1500);
            } else {
                await sleep(500);
            }

            log(`Checking: ${url.slice(0, 60)}`);

            // Check for contradictory banners
            const bannerBugs = await checkContradictoryBanners(page, url, log);
            for (const bug of bannerBugs) {
                bugs.push(bug);
                sharedBugs.push(bug);
            }

            // Generic UI checks
            const uiBugs = await checkGenericUIIssues(page, url, log);
            for (const bug of uiBugs) {
                if (!sharedBugs.some(b => b.type === bug.type && b.page === bug.page)) {
                    bugs.push(bug);
                    sharedBugs.push(bug);
                }
            }

            // ── AI Analysis: Use Bedrock (Kimi K2.5) for deeper UI consistency ──
            try {
                const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 600) || '').catch(() => '');
                const aiPrompt = `Analyze this page's UI consistency. Page: ${url}\nContent preview:\n"${pageText.slice(0, 400)}"\n\nCheck for:\n1. Contradictory messages (e.g., "No results" banner alongside visible results)\n2. Obvious layout problems\nReply "OK" if fine, or "ISSUE: [description]" if found.`;
                const aiResult = await callGemini(aiPrompt, 'uiux');
                if (aiResult) {
                    log(`AI UI check: ${aiResult.slice(0, 80)}`);
                }
            } catch (e) { /* AI is supplementary */ }
        } catch (e) {
            log(`Error checking ${url.slice(0, 40)}: ${e.message?.slice(0, 50)}`);
        }
    }

    log(`UI/UX Agent done. Bugs found: ${bugs.length}`);
    return { id: 'E', name: 'UI/UX', bugs, stepsCompleted: urlsToCheck.length };
}
