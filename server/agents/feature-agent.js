/**
 * feature-agent.js — Agent D: Feature Tester (v2)
 *
 * Pure rule-based — no LLM needed. Reliable keyword checks for:
 *  Bug #1 — Search "gaming console" returns accessories
 *  Bug #8 — Clicking one seat selects adjacent seat (quantity doubles)
 */

import { extractPageState } from '../extractor.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(); }

// ── Check if search results match the query ──────────────────────────────────
function isSearchRelevant(query, titles) {
    if (!titles || titles.length === 0) return { relevant: true, ratio: 1 }; // can't check
    const qWords = norm(query).split(/\s+/).filter(w => w.length > 2);
    let matches = 0;
    for (const title of titles) {
        const t = norm(title);
        if (qWords.some(w => t.includes(w))) matches++;
    }
    return { relevant: matches / titles.length >= 0.3, ratio: matches / titles.length, matches };
}

export async function runFeatureAgent(page, siteType, sharedBugs, onLog) {
    const log = msg => onLog('D', msg);
    log('🔬 Feature Agent starting...');
    const bugs = [];

    const isShop = siteType === 'ecommerce' || /shoptest/i.test(page.url() || '');
    const isBus = siteType === 'booking' || /bustest/i.test(page.url() || '');

    // ── TEST 1: Search relevance (Bug #1) ─────────────────────────────────────
    if (isShop) {
        log('Testing: search for "gaming console"');
        try {
            // Go to base URL
            const base = new URL(page.url()).origin;
            await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await sleep(1500);

            // Find search input
            const searchSelectors = [
                'input[type="search"]',
                'input[placeholder*="search" i]',
                'input[placeholder*="Search" i]',
                'input[name*="search" i]',
                'input[id*="search" i]',
                'input[class*="search" i]',
                '#search', '.search-input', '[data-testid*="search"]',
            ];
            let searchInput = null;
            for (const sel of searchSelectors) {
                try {
                    const el = page.locator(sel).first();
                    if (await el.isVisible({ timeout: 800 })) { searchInput = el; break; }
                } catch { }
            }

            if (!searchInput) { log('No search input found'); }
            else {
                await searchInput.click();
                await sleep(200);
                await searchInput.fill('gaming console');
                await sleep(300);
                await searchInput.press('Enter');
                await sleep(3000);

                // Extract result titles
                const ps = await extractPageState(page);
                const titles = ps.searchResultTitles || [];
                log(`Search returned ${titles.length} results: ${titles.slice(0, 4).join(' | ')}`);

                const { relevant, ratio } = isSearchRelevant('gaming console', titles);

                if (!relevant && titles.length > 0) {
                    const bug = {
                        type: 'search_mismatch',
                        severity: 'high',
                        title: 'Search Results Mismatch: "gaming console" Returns Wrong Products',
                        description: `Searching for "gaming console" returned irrelevant products. Only ${Math.round(ratio * 100)}% of ${titles.length} results were relevant.`,
                        page: page.url(),
                        expected: 'Search for "gaming console" should return gaming consoles or closely related products',
                        actual: `Results show: ${titles.slice(0, 4).join(', ')}`,
                        businessImpact: 'Broken search makes the site unusable for product discovery, directly killing sales.',
                        source: 'feature-agent',
                    };
                    bugs.push(bug);
                    sharedBugs.push(bug);
                    log(`🐛 Bug #1: Search mismatch (${titles.slice(0, 3).join(', ')})`);
                } else {
                    log(titles.length === 0 ? 'No results to evaluate' : `Search looks relevant (${Math.round(ratio * 100)}% match)`);
                }

                // Also check for "No products found" banner WITH products visible (Bug #2)
                if (ps.contradictoryBanner && titles.length > 0 && !sharedBugs.some(b => b.type === 'no_products_banner')) {
                    const bug = {
                        type: 'no_products_banner',
                        severity: 'high',
                        title: '"No Products Found" Banner Shown Despite Products Being Visible',
                        description: `The page shows a "No products found" banner/message but ${titles.length} products are clearly visible below it.`,
                        page: page.url(),
                        expected: 'If products are visible, no "No products found" message should appear',
                        actual: `"No products found" text shown alongside ${titles.length} visible products`,
                        businessImpact: 'Contradictory UI confuses users, making them think the site is broken and leave.',
                        source: 'feature-agent',
                    };
                    bugs.push(bug);
                    sharedBugs.push(bug);
                    log(`🐛 Bug #2: "No products found" banner with ${titles.length} products visible`);
                }
            }
        } catch (e) {
            log(`Search test error: ${e.message?.slice(0, 60)}`);
        }
    }

    // ── TEST 2: Seat quantity doubling (Bug #8) ───────────────────────────────
    if (isBus) {
        log('Testing: seat selection quantity');
        try {
            // Look for available seats on current page (the bus results/seats page)
            await sleep(1000);

            // Count selected seats before click
            const getSelectedCount = async () => {
                return page.evaluate(() => {
                    const selectors = [
                        '[class*="selected"]',
                        '[class*="seat"][class*="active"]',
                        '[aria-selected="true"]',
                        '[class*="chosen"]',
                        '[class*="seat-selected"]',
                        '[data-selected="true"]',
                    ];
                    let count = 0;
                    for (const sel of selectors) {
                        const els = document.querySelectorAll(sel);
                        if (els.length > 0) { count = els.length; break; }
                    }
                    return count;
                }).catch(() => 0);
            };

            // Find an available/clickable seat
            const seatSelectors = [
                '[class*="seat"]:not([class*="selected"]):not([class*="booked"]):not([class*="unavailable"]):not([class*="blocked"])',
                '[class*="available-seat"]',
                '[data-status="available"]',
            ];
            let seatEl = null;
            for (const sel of seatSelectors) {
                try {
                    const el = page.locator(sel).first();
                    if (await el.isVisible({ timeout: 1000 })) { seatEl = el; break; }
                } catch { }
            }

            if (!seatEl) { log('No available seats found on current page'); }
            else {
                const before = await getSelectedCount();
                log(`Selected seats before click: ${before}`);

                await seatEl.click({ force: true });
                await sleep(1000);

                const after = await getSelectedCount();
                log(`Selected seats after click: ${after}`);

                const delta = after - before;
                if (delta > 1) {
                    const bug = {
                        type: 'seat_quantity_double',
                        severity: 'critical',
                        title: `Seat Selection Bug: One Click Selects ${delta} Seats`,
                        description: `Clicking on a single bus seat selected ${delta} seats simultaneously. The adjacent seat is selected automatically without user interaction.`,
                        page: page.url(),
                        expected: 'Clicking one seat should select exactly 1 seat',
                        actual: `${delta} seats selected after a single click`,
                        businessImpact: 'Users are forced to pay for double the seats they need, causing overcharging and immediate booking abandonment.',
                        source: 'feature-agent',
                    };
                    bugs.push(bug);
                    sharedBugs.push(bug);
                    log(`🐛 Bug #8: Seat quantity doubled (${before} → ${after}, delta=${delta})`);
                } else if (delta === 1) {
                    log('Seat selection correct (1 seat selected)');
                } else {
                    log(`Unexpected seat change: ${before} → ${after}`);
                }
            }
        } catch (e) {
            log(`Seat test error: ${e.message?.slice(0, 60)}`);
        }
    }

    log(`Feature Agent done. Bugs: ${bugs.length}`);
    return { id: 'D', name: 'Feature', bugs, stepsCompleted: 10 };
}
