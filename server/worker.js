/**
 * worker.js — Fully Autonomous Browser Agent (v2 rewrite)
 *
 * Features:
 *  - Pre-flight modal/popup dismissal before each action
 *  - Smart action execution with robust fallbacks
 *  - Worker-level automatic bug detection (prices, currency, cart totals)
 *  - Advanced stuck detection with forced recovery
 *  - 50-step limit with forced report generation
 *  - Comprehensive error handling (5-consecutive-failure recovery)
 */

import { getNextAction, isAIBudgetExhausted } from './gemini.js';
import { extractPageState } from './extractor.js';
import { runAgentValidations } from './validator.js';
import { initCursor, reinitCursor, cursorClick, cursorType } from './cursor.js';
import { safeNavigate } from './safe-navigate.js';

const AGENT_MAX_STEPS = {
    C: 8,  // Agent 1: Navigation & Page Exploration
    D: 8,  // Agent 2: UI & Interactive Controls
    E: 8,  // Agent 3: Forms & Input Validation
    F: 10, // Agent 4: Core Workflow & E-commerce Testing (2+ products, cart, checkout)
    G: 10, // Agent 5: Business Logic & Domain-Specific Testing (routes, buses, seat selection)
    H: 8,  // Agent 6: Defect Verification, Evidence & Reporting
};
const DEFAULT_MAX_STEPS = 8;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const AGENT_DOMAIN = {
    C: 'navigation_exploration',
    D: 'ui_controls',
    E: 'forms_validation',
    F: 'core_workflow',
    G: 'business_logic',
    H: 'defect_verification',
};

function validationIssueToBug(issue, workerId, pageUrl) {
    const sev = issue.severity || 'medium';
    return {
        type: issue.type || 'validation',
        severity: sev === 'high' ? 'high' : sev === 'low' ? 'low' : 'medium',
        title: (issue.message || issue.type || 'Validation issue').slice(0, 80),
        description: issue.message || '',
        page: pageUrl,
        expected: 'Expected compliant behavior per QA standards',
        actual: issue.message || '',
        businessImpact: 'May affect usability, trust, or correctness for end users.',
        source: `validator-${workerId}`,
        agentDomain: AGENT_DOMAIN[workerId] || 'functional',
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRE-FLIGHT CHECK — dismiss popups/modals before each action
// ─────────────────────────────────────────────────────────────────────────────
async function preFlightCheck(page, log) {
    let dismissed = false;

    // Only press Escape if a modal dialog overlay is actively present
    try {
        const hasOverlay = await page.evaluate(() => {
            return Boolean(document.querySelector('[role="dialog"], [role="alertdialog"], .modal.show, .modal-backdrop'));
        });
        if (hasOverlay) {
            await page.keyboard.press('Escape');
            await sleep(150);
        }
    } catch { }

    // Try common modal/popup close selectors (do NOT include "Continue" which belongs to checkout forms)
    const CLOSE_SELECTORS = [
        'button:has-text("Accept all")', 'button:has-text("Accept")',
        'button:has-text("Got it")', 'button:has-text("OK")',
        'button:has-text("Skip")', 'button:has-text("Skip for now")',
        'button:has-text("Not now")', 'button:has-text("No thanks")',
        'button:has-text("No Thanks")', 'input[aria-labelledby*="NoCoverage" i]',
        'button:has-text("Close")', 'button:has-text("Dismiss")',
        'button:has-text("✕")', 'button:has-text("×")',
        'button:has-text("I understand")', 'button:has-text("Allow")',
        'button:has-text("Agree")',
        '[aria-label*="close" i]', '[aria-label*="dismiss" i]',
        '[class*="modal"] button[class*="close"]',
        '[class*="dialog"] button[class*="close"]',
        '[class*="popup"] button[class*="close"]',
        '[class*="overlay"] button[class*="close"]',
        '[class*="cookie"] button',
        '[class*="consent"] button',
    ];

    for (const sel of CLOSE_SELECTORS) {
        try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 200 })) {
                await el.click({ force: true, timeout: 500 });
                await sleep(250);
                if (await el.isVisible({ timeout: 200 })) {
                    await el.click({ force: true, timeout: 500 }).catch(() => {});
                    await sleep(250);
                }
                log(`[preflight] closed popup: ${sel.slice(0, 40)}`);
                dismissed = true;
            }
        } catch { }
    }

    try {
        await page.evaluate(() => {
            const fixed = Array.from(document.querySelectorAll('div')).filter(d => {
                const s = window.getComputedStyle(d);
                return (s.position === 'fixed' || s.position === 'absolute') && (parseInt(s.zIndex || 0, 10) >= 40) && /welcome back|sign in/i.test(d.innerText || '');
            });
            for (const f of fixed) f.remove();
        });
    } catch { }

    return dismissed;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION: CLICK — with 3 fallbacks
// ─────────────────────────────────────────────────────────────────────────────
async function doClick(page, el, log) {
    if (!el) { log('click: null element'); return false; }
    const sel = el.selector || `[data-sentra-idx="${el.idx}"]`;
    const lbl = el.label || `[${el.idx}]`;

    // 0. Ensure target="_blank" is stripped so clicks navigate within the current tab
    try {
        await page.evaluate((idx) => {
            const node = document.querySelector(`[data-sentra-idx="${idx}"]`);
            const anchor = node ? (node.tagName === 'A' ? node : node.closest('a')) : null;
            if (anchor) {
                anchor.removeAttribute('target');
                anchor.setAttribute('target', '_self');
            }
        }, el.idx).catch(() => {});
    } catch {}

    // Listen for any popup that might be triggered by this click
    const popupPromise = page.waitForEvent('popup', { timeout: 1200 }).catch(() => null);

    let clicked = false;

    // 1. Normal visible click via data-sentra-idx (most reliable)
    try {
        const loc = page.locator(`[data-sentra-idx="${el.idx}"]`);
        if (await loc.isVisible({ timeout: 3000 })) {
            try { await cursorClick(page, loc); }
            catch { await loc.click({ timeout: 3000 }); }
            await sleep(800);
            log(`✓ click: "${lbl}"`);
            clicked = true;
        }
    } catch { }

    // 2. Try stable selector
    if (!clicked && sel !== `[data-sentra-idx="${el.idx}"]`) {
        try {
            const loc = page.locator(sel).first();
            if (await loc.isVisible({ timeout: 2000 })) {
                await loc.click({ timeout: 3000 });
                await sleep(800);
                log(`✓ click (selector): "${lbl}"`);
                clicked = true;
            }
        } catch { }
    }

    // 3. Force click (through overlays)
    if (!clicked) {
        try {
            await page.locator(`[data-sentra-idx="${el.idx}"]`).click({ force: true, timeout: 3000 });
            await sleep(800);
            log(`✓ force-click: "${lbl}"`);
            clicked = true;
        } catch { }
    }

    // 4. JS click
    if (!clicked) {
        try {
            await page.evaluate(s => document.querySelector(s)?.click(), `[data-sentra-idx="${el.idx}"]`);
            await sleep(800);
            log(`✓ js-click: "${lbl}"`);
            clicked = true;
        } catch (e) {
            log(`✗ click failed: "${lbl}"`);
            return false;
        }
    }

    // If click spawned a popup window, close the popup and navigate current tab to that URL
    try {
        const popup = await popupPromise;
        if (popup) {
            const popupUrl = popup.url();
            log(`🔀 Popup intercepted (${popupUrl.slice(0, 50)}) — closing extra tab, navigating current tab`);
            await popup.close().catch(() => {});
            if (popupUrl && !popupUrl.startsWith('about:blank') && !popupUrl.startsWith('chrome:')) {
                await page.goto(popupUrl, { timeout: 25000, waitUntil: 'domcontentloaded' }).catch(() => {});
                await sleep(1200);
            }
        }
    } catch {}

    return clicked;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION: TYPE — with auto-Enter for search, suggestion picking, readonly handling
// ─────────────────────────────────────────────────────────────────────────────
async function doType(page, el, value, opts, log) {
    if (!el) { log('type: null element'); return false; }
    const sel = `[data-sentra-idx="${el.idx}"]`;
    const lbl = el.label || `[${el.idx}]`;
    const { pressEnterAfter = false, pickSuggestion = false } = opts || {};

    try {
        const loc = page.locator(sel);

        // If readonly → click instead (opens calendar, date picker, etc.)
        const readonly = await loc.evaluate(e =>
            e.hasAttribute('readonly') || e.getAttribute('readOnly') === 'true' || e.tagName === 'DIV'
        ).catch(() => false);
        if (readonly || el.readonly) {
            log(`"${lbl}" is readonly → clicking to open picker`);
            return doClick(page, el, log);
        }

        // Focus, clear, type
        await loc.click({ force: true, timeout: 2000 }).catch(() => { });
        await sleep(150);
        await loc.fill('').catch(() => { });
        await sleep(80);

        // Type character by character for autocomplete compatibility
        try { await cursorType(page, loc, value); }
        catch { await loc.pressSequentially(value, { delay: 50 }); }
        await sleep(700);

        log(`✓ type: "${value}" → "${lbl}"`);

        // Auto-detect search fields
        const isSearch = await loc.evaluate(e =>
            e.type === 'search' ||
            (e.placeholder || '').toLowerCase().includes('search') ||
            (e.name || '').toLowerCase().includes('search') ||
            (e.getAttribute('aria-label') || '').toLowerCase().includes('search') ||
            (e.className || '').toLowerCase().includes('search')
        ).catch(() => false);

        // Pick autocomplete suggestion if visible
        if (pickSuggestion || isSearch) {
            const DROPDOWNS = [
                '[role="option"]', '[role="listbox"] > *',
                'ul[class*="suggest"] li', 'ul[class*="auto"] li',
                'div[class*="suggest"] > div', 'div[class*="dropdown"] > div',
                'div[class*="autocomplete"] > div', '.search-suggestion',
                '[class*="suggestion"] li', '[class*="result"] li',
            ];
            let picked = false;
            for (const d of DROPDOWNS) {
                try {
                    const item = page.locator(d).first();
                    if (await item.isVisible({ timeout: 1800 })) {
                        const txt = (await item.textContent().catch(() => '')).trim();
                        await item.click({ force: true });
                        await sleep(700);
                        log(`✓ suggestion picked: "${txt.slice(0, 40)}"`);
                        picked = true;
                        break;
                    }
                } catch { }
            }

            // For search fields: press Enter if no suggestion was picked
            if (!picked && (isSearch || pressEnterAfter)) {
                const urlBefore = page.url();
                await loc.press('Enter').catch(() => page.keyboard.press('Enter'));
                await sleep(1500);
                const urlAfter = page.url();
                if (urlAfter !== urlBefore) {
                    log(`✓ Enter → navigated: ${urlAfter.slice(0, 60)}`);
                } else {
                    log(`✓ Enter pressed (same page)`);
                }
            }
        } else if (pressEnterAfter) {
            await loc.press('Enter').catch(() => page.keyboard.press('Enter'));
            await sleep(1000);
            log(`✓ Enter pressed after type`);
        }

        return true;
    } catch (e) {
        log(`✗ type failed: "${lbl}" — ${e.message?.slice(0, 50)}`);
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION: PRESS KEY
// ─────────────────────────────────────────────────────────────────────────────
async function doPress(page, key, log) {
    try {
        await page.keyboard.press(key);
        await sleep(600);
        log(`✓ key: ${key}`);
        return true;
    } catch (e) {
        log(`✗ key failed: ${key}`);
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION: SELECT — pick from <select> element
// ─────────────────────────────────────────────────────────────────────────────
async function doSelect(page, el, value, log) {
    if (!el) { log('select: null element'); return false; }
    const sel = `[data-sentra-idx="${el.idx}"]`;
    try {
        await page.locator(sel).selectOption({ label: value }).catch(
            () => page.locator(sel).selectOption({ value })
        );
        await sleep(500);
        log(`✓ select: "${value}" in "${el.label}"`);
        return true;
    } catch (e) {
        log(`✗ select failed: ${e.message?.slice(0, 50)}`);
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// STUCK DETECTION — detect if AI is repeating actions
// ─────────────────────────────────────────────────────────────────────────────
function getStuckReason(history, consecutiveScrolls) {
    if (history.length < 3) return null;

    // Check for exact same action 3 times in a row
    const last3 = history.slice(-3);
    const allSame = last3.every(h =>
        h.action === last3[0].action &&
        h.value === last3[0].value &&
        h.index === last3[0].index
    );
    if (allSame) {
        return `Same action "${last3[0].action}" on element ${last3[0].index} repeated 3 times`;
    }

    // Too many consecutive scrolls
    if (consecutiveScrolls > 3) {
        return `Scrolled ${consecutiveScrolls} times in a row without meaningful interaction`;
    }

    // Check for alternating pattern (A-B-A-B)
    if (history.length >= 4) {
        const l4 = history.slice(-4);
        if (l4[0].action === l4[2].action && l4[0].index === l4[2].index &&
            l4[1].action === l4[3].action && l4[1].index === l4[3].index) {
            return 'Alternating between two actions without progress';
        }
    }

    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIRMATION DETECTION — know when test is done
// ─────────────────────────────────────────────────────────────────────────────
function isConfirmation(title, text) {
    return /booking confirmed|order confirmed|order placed|payment success|thank you|booking success|placed successfully|ticket confirmed|payment done|confirmed!/i.test(`${title} ${text}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKER-LEVEL BUG DETECTION — no AI needed
// ─────────────────────────────────────────────────────────────────────────────
function detectWorkerBugs(ps, memory, log) {
    const bugs = [];

    // 1. Price mismatch between pages (product → cart)
    if (memory.product_price && ps.prices.length > 0) {
        const productPrice = parseFloat(String(memory.product_price).replace(/[^0-9.]/g, ''));
        for (const p of ps.prices) {
            const pagePrice = parseFloat(p.replace(/[^0-9.]/g, ''));
            if (productPrice > 0 && pagePrice > 0 &&
                Math.abs(productPrice - pagePrice) > 0.01 &&
                pagePrice !== productPrice) {
                const onCartPage = /cart|checkout|bag|basket|order/i.test(ps.url + ' ' + ps.title + ' ' + ps.fullText.slice(0, 200));
                if (onCartPage) {
                    bugs.push({
                        type: 'price_mismatch',
                        severity: 'critical',
                        title: 'Price Changed Between Product and Cart',
                        description: `Product price was ${memory.product_price} on the product page but appears as ${p} on the cart/checkout page`,
                        page: ps.url,
                        expected: String(memory.product_price),
                        actual: p,
                        businessImpact: 'Users see a different price at checkout than on the product page, causing distrust and cart abandonment.',
                        source: 'flow-agent',
                    });
                    log(`🐛 [FLOW] Price mismatch: ${memory.product_price} vs ${p}`);
                    break;
                }
            }
        }
    }

    // 2. Currency consistency check across pages
    if (memory.currency && ps.currency && memory.currency !== ps.currency) {
        bugs.push({
            type: 'currency_page_mismatch',
            severity: 'high',
            title: 'Currency Symbol Inconsistency Across Pages',
            description: `Currency changed from "${memory.currency}" to "${ps.currency}" between pages — prices may appear confusingly different`,
            page: ps.url,
            expected: memory.currency,
            actual: ps.currency,
            businessImpact: 'Inconsistent currency symbols confuse international users and undermine pricing trust.',
            source: 'flow-agent',
        });
        log(`🐛 [FLOW] Currency mismatch: ${memory.currency} → ${ps.currency}`);
    }

    // 3. Bug #6 — Cart total miscalculation (total = subtotal + tax - $50)
    if (ps.cartBreakdown) {
        const { subtotal, tax, total } = ps.cartBreakdown;
        if (subtotal > 0 && total > 0) {
            const expectedTotal = subtotal + tax;
            const diff = Math.abs(total - expectedTotal);
            if (diff > 1) {
                bugs.push({
                    type: 'cart_total_error',
                    severity: 'critical',
                    title: 'Cart Total Miscalculated',
                    description: `Cart total is ${total.toFixed(2)} but subtotal (${subtotal.toFixed(2)}) + tax (${tax.toFixed(2)}) = ${expectedTotal.toFixed(2)}. Difference: ${(total - expectedTotal).toFixed(2)}.`,
                    page: ps.url,
                    expected: `Total should be ${expectedTotal.toFixed(2)} (subtotal + tax)`,
                    actual: `Total shows ${total.toFixed(2)} — off by ${(total - expectedTotal).toFixed(2)}`,
                    businessImpact: 'Users are charged the wrong amount. A $50 undercharge is a direct financial loss; an overcharge causes refund requests and lost trust.',
                    source: 'flow-agent',
                });
                log(`🐛 [FLOW] Bug #6: Cart total ${total} vs expected ${expectedTotal} (diff: ${(total - expectedTotal).toFixed(2)})`);
            }
        }
    } else if (ps.cartTotal) {
        // Fallback: parse from text
        const totalVal = parseFloat(ps.cartTotal.replace(/[^0-9.]/g, ''));
        const subtotalMatch = ps.fullText.match(/sub\s*total[:\s]*(?:₹|Rs\.?|\$|€|£)\s*([\d,]+(?:\.\d{1,2})?)/i);
        const taxMatch = ps.fullText.match(/tax[:\s]*(?:₹|Rs\.?|\$|€|£)\s*([\d,]+(?:\.\d{1,2})?)/i);
        if (subtotalMatch && taxMatch) {
            const subtotal = parseFloat(subtotalMatch[1].replace(/,/g, ''));
            const tax = parseFloat(taxMatch[1].replace(/,/g, ''));
            const expectedTotal = subtotal + tax;
            if (totalVal > 0 && Math.abs(totalVal - expectedTotal) > 1) {
                bugs.push({
                    type: 'cart_total_error',
                    severity: 'critical',
                    title: 'Cart Total Miscalculated',
                    description: `Cart total is ${ps.cartTotal} but subtotal + tax = ${ps.currency || '$'}${expectedTotal.toFixed(2)}. Difference: ${(totalVal - expectedTotal).toFixed(2)}.`,
                    page: ps.url,
                    expected: `${ps.currency || '$'}${expectedTotal.toFixed(2)}`,
                    actual: ps.cartTotal,
                    businessImpact: 'Users are charged the wrong amount, causing financial loss or customer complaints.',
                    source: 'flow-agent',
                });
                log(`🐛 [FLOW] Bug #6 (text): Cart total mismatch: ${totalVal} vs ${expectedTotal}`);
            }
        }
    }

    // 4. Bug #10 — Confirmation date off by one day
    if (ps.selectedDate && memory.booking_date) {
        const selectedMs = new Date(ps.selectedDate).getTime();
        const bookedMs = new Date(memory.booking_date).getTime();
        const dayDiff = Math.round(Math.abs(selectedMs - bookedMs) / (1000 * 60 * 60 * 24));
        const onConfirmPage = /confirm|success|ticket|thank/i.test(ps.title + ' ' + ps.fullText.slice(0, 300));
        if (dayDiff === 1 && onConfirmPage) {
            bugs.push({
                type: 'date_offset_error',
                severity: 'critical',
                title: 'Travel Date Wrong on Confirmation (Off by 1 Day)',
                description: `User selected travel date ${memory.booking_date} but the booking confirmation shows ${ps.selectedDate} — one day off.`,
                page: ps.url,
                expected: `Confirmation should show the selected date: ${memory.booking_date}`,
                actual: `Confirmation shows: ${ps.selectedDate}`,
                businessImpact: 'Users travel on the wrong day. This causes missed buses, refund requests, and severe trust damage.',
                source: 'flow-agent',
            });
            log(`🐛 [FLOW] Bug #10: Date off by ${dayDiff} day — selected ${memory.booking_date} vs confirmed ${ps.selectedDate}`);
        }
    }

    // 5. Cart quantity doubling — expected 1 but got 2+
    const onCartPage = /(\/|^)(cart|checkout|basket|bag|viewcart)(\/|$|\?)/i.test(new URL(ps.url, 'http://localhost').pathname) ||
        /^(shopping\s*cart|your\s*cart|cart|basket)$/i.test((ps.title || '').trim()) ||
        /\/gp\/cart|\/cart\.html/i.test(ps.url);
    if (onCartPage && memory.added_to_cart) {
        const expectedQty = memory.expected_cart_quantity || 1;
        // Check quantities from extractor
        if (ps.cartQuantities && ps.cartQuantities.length > 0) {
            for (const qty of ps.cartQuantities) {
                if (qty > expectedQty) {
                    bugs.push({
                        type: 'quantity_mismatch',
                        severity: 'critical',
                        title: 'Cart Quantity Doubling: Added 1 Item but Cart Shows More',
                        description: `Added ${expectedQty} item(s) to cart but the cart displays quantity ${qty}. Expected ${expectedQty}, got ${qty}.`,
                        page: ps.url,
                        expected: `Cart quantity should be ${expectedQty}`,
                        actual: `Cart shows quantity ${qty} — ${qty - expectedQty} extra item(s) added`,
                        businessImpact: 'Users are charged for items they did not intend to buy, causing overcharges, refund requests, and loss of trust.',
                        source: 'flow-agent',
                    });
                    log(`🐛 [FLOW] Quantity mismatch: expected ${expectedQty}, got ${qty}`);
                    break;
                }
            }
        }
        // Also check cartItemCount — if we added 1 product but see 2+ cart items
        if (ps.cartItemCount && ps.cartItemCount > expectedQty && !bugs.some(b => b.type === 'quantity_mismatch')) {
            bugs.push({
                type: 'quantity_mismatch',
                severity: 'high',
                title: 'Cart Shows Extra Items After Adding One Product',
                description: `Added ${expectedQty} product but cart contains ${ps.cartItemCount} items.`,
                page: ps.url,
                expected: `${expectedQty} item in cart`,
                actual: `${ps.cartItemCount} items in cart`,
                businessImpact: 'Extra items in cart leads to overcharging and customer complaints.',
                source: 'flow-agent',
            });
            log(`🐛 [FLOW] Cart item count mismatch: expected ${expectedQty}, got ${ps.cartItemCount}`);
        }
    }

    // 6. Contradictory "No buses found" banner while bus results or routes are visible
    const hasNoResultsBanner = /no\s*(?:buses?|results?|trips?|products?)\s*(?:found|available)/i.test(ps.fullText);
    const hasVisibleCards = (ps.numbered && /(?:bus|route|departure|seats?|ac|sleeper|fare|₹)/i.test(ps.numbered)) || (ps.prices && ps.prices.length > 0);
    if (hasNoResultsBanner && hasVisibleCards && !bugs.some(b => b.type === 'contradiction_banner')) {
        bugs.push({
            type: 'contradiction_banner',
            severity: 'high',
            title: 'Contradictory "No Results Found" Banner Displayed Above Valid Results',
            description: `The page displays a "No results / buses found" notice, yet active listings and fares are clearly visible to the user below.`,
            page: ps.url,
            expected: 'If search yields results, the "no results found" alert must be hidden.',
            actual: 'Page renders both "no results" alert and active listing cards simultaneously.',
            businessImpact: 'Users believe the route is unavailable and abandon the purchase, causing severe conversion drop.',
            source: 'validator',
        });
        log('🐛 [FLOW] Contradictory banner detected');
    }

    // 7. Bus listing vs seat selection price discrepancy
    if (memory.listing_bus_price && ps.prices.length > 0) {
        const listPrice = parseFloat(String(memory.listing_bus_price).replace(/[^0-9.]/g, ''));
        const isSeatPage = /seat|select|layout|berth|bus/i.test(ps.url + ' ' + ps.title);
        if (isSeatPage && listPrice > 0) {
            for (const p of ps.prices) {
                const currentPrice = parseFloat(p.replace(/[^0-9.]/g, ''));
                if (currentPrice > 10 && Math.abs(currentPrice - listPrice) > 1 && !bugs.some(b => b.type === 'price_inconsistency')) {
                    bugs.push({
                        type: 'price_inconsistency',
                        severity: 'critical',
                        title: 'Price Inconsistency: Listing Price Differs from Selection Price',
                        description: `Bus was listed at ₹${listPrice} on the search results, but the seat selection page displays ₹${currentPrice}.`,
                        page: ps.url,
                        expected: `Fare on seat selection should match listing fare of ₹${listPrice}`,
                        actual: `Seat selection shows ₹${currentPrice} (difference of ₹${Math.abs(currentPrice - listPrice).toFixed(0)})`,
                        businessImpact: 'Price discrepancy during checkout is deceptive and damages user trust, resulting in abandoned bookings.',
                        source: 'validator',
                    });
                    log(`🐛 [FLOW] Price discrepancy: listing ₹${listPrice} vs page ₹${currentPrice}`);
                    break;
                }
            }
        }
    }

    // 8. Bus seat selection doubling (clicking 1 seat selects 2+ seats)
    const currentSeatCount = ps.selectedSeatCount || (ps.selectedSeats ? ps.selectedSeats.length : 0);
    if (currentSeatCount > 0) {
        const expectedSeats = memory.expected_selected_seats || (memory.seat_clicked ? 1 : 0);
        if (expectedSeats === 1 && currentSeatCount >= 2 && !bugs.some(b => b.type === 'seat_selection_doubling')) {
            const seatsList = (ps.selectedSeats && ps.selectedSeats.length > 0)
                ? ps.selectedSeats.join(', ')
                : `${currentSeatCount} seats`;
            bugs.push({
                type: 'seat_selection_doubling',
                severity: 'critical',
                title: `Seat Selection Defect: Clicking 1 Seat Automatically Selected ${currentSeatCount} Seats`,
                description: `When the user clicked single available seat "${memory.seat_clicked || '1'}", the application automatically registered ${currentSeatCount} seats as selected (${seatsList}). The booking summary charges for ${currentSeatCount} seats instead of 1, inflating the fare total.`,
                page: ps.url,
                expected: `Selecting seat "${memory.seat_clicked || '1'}" should only select 1 seat.`,
                actual: `Application automatically selected ${currentSeatCount} seats: ${seatsList}.`,
                businessImpact: 'Severe billing error: users are charged for multiple tickets when attempting to book a single seat, leading to checkout abandonment and disputes.',
                source: 'seat-validator',
            });
            log(`🐛 [SEAT] Seat selection doubling detected: expected 1 seat, got ${currentSeatCount} (${seatsList})`);
        }
    }

    // 9. Payment page passenger doubling (1 seat requested, but passenger 2 form displayed)
    const onPaymentPage = /payment|passenger|checkout/i.test(ps.url + ' ' + ps.title);
    if (onPaymentPage && memory.expected_selected_seats === 1 && !bugs.some(b => b.type === 'seat_selection_doubling')) {
        const hasPassenger2 = /Passenger\s*2/i.test(ps.fullText);
        if (hasPassenger2) {
            bugs.push({
                type: 'seat_selection_doubling',
                severity: 'critical',
                title: 'Checkout Form Requires 2 Passengers for 1 Selected Seat',
                description: `A single seat was selected during seat selection, but the payment page presents a form requiring details for "Passenger 2", confirming unintended seat doubling.`,
                page: ps.url,
                expected: 'Payment page should only require details for 1 passenger.',
                actual: 'Payment page requires details for Passenger 1 and Passenger 2.',
                businessImpact: 'Users cannot complete single-ticket checkout without entering dummy details for an unintended second passenger.',
                source: 'seat-validator',
            });
            log('🐛 [SEAT] Payment page passenger doubling detected');
        }
    }

    return bugs;
}


// ─────────────────────────────────────────────────────────────────────────────
// TASK BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function buildTask(mission, ctx) {
    if (mission?.task) return mission.task;
    if (mission?.testPlan?.length > 0) {
        return mission.testPlan.map(s => s.step || s).join(' → ');
    }
    if (ctx.site_type === 'booking')
        return 'Complete full bus booking: fill From city, To city, and Date → search → pick a bus → select a seat → fill passenger form → pay → reach confirmation.';
    if (ctx.site_type === 'ecommerce')
        return 'Complete full shopping: search a product → open product page → add to cart → go to cart → checkout → fill address + payment → place order.';
    return `Test the complete user journey on ${ctx.site_name}: navigate all major flows and reach a final confirmation page.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN WORKER LOOP
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// AUTONOMOUS HEURISTIC ACTION PICKER (Zero-AI fallback)
// ─────────────────────────────────────────────────────────────────────────────
function pickAutonomousAction(elements, history, siteContext, workerId = 'D', mission = {}) {
    if (!elements || elements.length === 0) return null;
    const clickedIndices = new Set(history.filter(h => h.action === 'click').map(h => h.index));
    const typedIndices = new Set(history.filter(h => h.action === 'type').map(h => h.index));

    // ─────────────────────────────────────────────────────────────────────────
    // AGENT 1 (Worker C): Navigation & Page Exploration
    // Discover accessible pages, links, menus, routes, scroll through pages
    // ─────────────────────────────────────────────────────────────────────────
    if (workerId === 'C') {
        const navLink = elements.find(e =>
            e.tag === 'a' &&
            (e.label || '').length > 3 &&
            /(?:category|deals|electronics|mobiles|fashion|home|menu|explore|all|next|page|shop|bestsellers|new)/i.test(e.label || '') &&
            !clickedIndices.has(e.idx) &&
            !/(?:privacy|terms|cookie|legal|copyright)/i.test(e.label || '')
        );
        if (navLink) {
            return { action: 'click', index: navLink.idx, description: `[Nav] Explore route: "${navLink.label.slice(0, 40)}"` };
        }
        const anyNav = elements.find(e =>
            e.tag === 'a' && (e.label || '').length > 4 &&
            !clickedIndices.has(e.idx) &&
            !/(?:privacy|terms|cookie|legal|copyright)/i.test(e.label || '')
        );
        if (anyNav) {
            return { action: 'click', index: anyNav.idx, description: `[Nav] Follow page link: "${anyNav.label.slice(0, 40)}"` };
        }
        return { action: 'scroll', value: 'down', description: '[Nav] Scroll down to discover more page links' };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AGENT 2 (Worker D): UI & Interactive Controls
    // Buttons, tabs, dropdowns, dialogs, filters, toggles, interactive elements
    // ─────────────────────────────────────────────────────────────────────────
    if (workerId === 'D') {
        const tabControl = elements.find(e =>
            (e.role === 'tab' || /(?:tab|specs|specifications|reviews|overview|details|features)/i.test(e.label || e.selector || '')) &&
            !clickedIndices.has(e.idx)
        );
        if (tabControl) {
            return { action: 'click', index: tabControl.idx, description: `[UI] Click tab control: "${tabControl.label || tabControl.idx}"` };
        }
        const filterControl = elements.find(e =>
            (e.type === 'checkbox' || e.tag === 'select' || /(?:filter|brand|rating|prime|sort|view)/i.test(e.label || e.name || '')) &&
            !clickedIndices.has(e.idx)
        );
        if (filterControl) {
            return { action: 'click', index: filterControl.idx, description: `[UI] Toggle filter control: "${filterControl.label || filterControl.idx}"` };
        }
        const uiBtn = elements.find(e =>
            (e.tag === 'button' || e.role === 'button') &&
            (e.label || '').length > 2 &&
            !clickedIndices.has(e.idx) &&
            !/(?:home|logo|privacy|terms|cookie)/i.test(e.label || '')
        );
        if (uiBtn) {
            return { action: 'click', index: uiBtn.idx, description: `[UI] Test button: "${uiBtn.label}"` };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AGENT 3 (Worker E): Forms & Input Validation
    // Forms, text fields, search boxes, selectors, auth & boundary inputs
    // ─────────────────────────────────────────────────────────────────────────
    if (workerId === 'E') {
        const authLink = elements.find(e =>
            (e.tag === 'a' || e.tag === 'button') &&
            /(?:sign in|login|log in|register|my account|account|auth)/i.test(e.label || '') &&
            !clickedIndices.has(e.idx)
        );
        if (authLink) {
            return { action: 'click', index: authLink.idx, description: `[Forms] Test auth link: "${authLink.label || 'Sign In'}"` };
        }
        const emailInput = elements.find(e =>
            e.tag === 'input' &&
            /(?:email|mobile|phone|username|login|user_id|identifier)/i.test(e.label || e.placeholder || e.name || e.id || e.type || '') &&
            !typedIndices.has(e.idx)
        );
        if (emailInput) {
            const isPhone = /(?:phone|mobile|tel)/i.test(emailInput.label || emailInput.placeholder || emailInput.name || '');
            const cred = isPhone ? '9876543210' : 'testuser.sentra@gmail.com';
            return { action: 'type', index: emailInput.idx, value: cred, pressEnter: false, description: `[Forms] Enter test credential: ${cred}` };
        }
        const pwdInput = elements.find(e =>
            e.tag === 'input' && (e.type === 'password' || /(?:password|pass|pwd)/i.test(e.label || e.placeholder || e.name || '')) &&
            !typedIndices.has(e.idx)
        );
        if (pwdInput) {
            return { action: 'type', index: pwdInput.idx, value: 'TestPass123!', pressEnter: true, description: `[Forms] Enter test password` };
        }
        const searchInput = elements.find(e =>
            (e.tag === 'input' || e.type === 'search') &&
            /(?:search|query|q|find)/i.test(e.label || e.placeholder || e.name || '') &&
            !typedIndices.has(e.idx)
        );
        if (searchInput) {
            return { action: 'type', index: searchInput.idx, value: '<script>alert(1)</script>', pressEnter: true, description: `[Forms] Test boundary search input with sanitization probe` };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AGENT 4 (Worker F): Core Workflow & E-commerce Testing
    // Select MULTIPLE products, Add to Cart, view cart, checkout, safe payment
    // ─────────────────────────────────────────────────────────────────────────
    if (workerId === 'F') {
        // 1. Delivery & Address Form Fields (Checkout stage)
        const fullNameInput = elements.find(e =>
            (e.tag === 'input' || e.tag === 'textarea') &&
            /(?:full.?name|recipient|contact.?name|first.?name|name)/i.test(e.label || e.placeholder || e.name || '') &&
            !/(?:search|user|login|email|card)/i.test(e.label || e.placeholder || e.name || '') &&
            !typedIndices.has(e.idx)
        );
        if (fullNameInput) {
            return { action: 'type', index: fullNameInput.idx, value: 'Tarun Kumar', pressEnter: false, description: `[Checkout] Fill synthetic recipient name: Tarun Kumar` };
        }

        const addressInput = elements.find(e =>
            (e.tag === 'input' || e.tag === 'textarea') &&
            /(?:address|street|line.?1|address.?1|house|flat)/i.test(e.label || e.placeholder || e.name || '') &&
            !typedIndices.has(e.idx)
        );
        if (addressInput) {
            return { action: 'type', index: addressInput.idx, value: '123 MG Road, Sector 4', pressEnter: false, description: `[Checkout] Fill synthetic street address: 123 MG Road, Sector 4` };
        }

        const cityInput = elements.find(e =>
            e.tag === 'input' &&
            /(?:city|town|district)/i.test(e.label || e.placeholder || e.name || '') &&
            !typedIndices.has(e.idx)
        );
        if (cityInput) {
            return { action: 'type', index: cityInput.idx, value: 'Mumbai', pressEnter: false, description: `[Checkout] Fill synthetic delivery city: Mumbai` };
        }

        const pinInput = elements.find(e =>
            e.tag === 'input' &&
            /(?:pincode|postal|zip|pin)/i.test(e.label || e.placeholder || e.name || '') &&
            !typedIndices.has(e.idx)
        );
        if (pinInput) {
            return { action: 'type', index: pinInput.idx, value: '400001', pressEnter: false, description: `[Checkout] Fill synthetic pincode: 400001` };
        }

        const phoneInput = elements.find(e =>
            e.tag === 'input' &&
            /(?:phone|mobile|contact|tel)/i.test(e.label || e.placeholder || e.name || '') &&
            !typedIndices.has(e.idx)
        );
        if (phoneInput) {
            return { action: 'type', index: phoneInput.idx, value: '9876543210', pressEnter: false, description: `[Checkout] Fill synthetic mobile: 9876543210` };
        }

        // 2. Deliver / Continue / Use Address button
        const deliverBtn = elements.find(e =>
            (e.tag === 'button' || e.tag === 'a' || e.role === 'button' || e.type === 'submit') &&
            /(?:deliver to this address|use this address|ship to this address|continue to payment|save address|proceed to payment|continue)/i.test(e.label || '') &&
            !clickedIndices.has(e.idx)
        );
        if (deliverBtn) {
            return { action: 'click', index: deliverBtn.idx, description: `[Checkout] Click delivery progression: "${deliverBtn.label}"` };
        }

        // 3. Checkout Auth / Sign-in wall (guest vs user login required)
        const checkoutEmailInput = elements.find(e =>
            e.tag === 'input' &&
            /(?:email|ap_email|mobile|username|phone)/i.test(e.label || e.placeholder || e.name || e.selector || '') &&
            !/(?:search)/i.test(e.label || e.placeholder || '') &&
            !typedIndices.has(e.idx)
        );
        if (checkoutEmailInput && /(?:sign\s*in|login|checkout|buy)/i.test(document?.title || '')) {
            return { action: 'type', index: checkoutEmailInput.idx, value: 'testuser.sentra@gmail.com', pressEnter: true, description: `[Checkout Auth] Enter synthetic test email for checkout: testuser.sentra@gmail.com` };
        }

        // 4. Payment stage inspection (safe test / radio inspection, never real payment)
        const paymentOption = elements.find(e =>
            (e.tag === 'input' || e.tag === 'button' || e.tag === 'label') &&
            /(?:cash on delivery|cod|pay on delivery|upi|card|net\s*banking|credit)/i.test(e.label || '') &&
            !clickedIndices.has(e.idx)
        );
        if (paymentOption) {
            return { action: 'click', index: paymentOption.idx, description: `[Payment Inspection] Inspect payment method option: "${paymentOption.label}"` };
        }

        // 5. Cart Actions: Proceed to Checkout or View Cart
        const checkoutBtn = elements.find(e =>
            (e.tag === 'button' || e.tag === 'a' || e.role === 'button' || e.type === 'submit') &&
            /(?:proceed to checkout|proceed to buy|proceed to payment|checkout|place your order)/i.test(e.label || '') &&
            !clickedIndices.has(e.idx)
        );
        if (checkoutBtn) {
            return { action: 'click', index: checkoutBtn.idx, description: `[Workflow] Proceed to checkout: "${checkoutBtn.label}"` };
        }

        // Test quantity modification in cart (increase quantity)
        const qtyIncBtn = elements.find(e =>
            (e.tag === 'button' || e.tag === 'a' || e.role === 'button') &&
            /(?:increase|increment|qty\s*\+|add\s*one|\+)/i.test(e.label || e.selector || '') &&
            !clickedIndices.has(e.idx)
        );
        if (qtyIncBtn) {
            return { action: 'click', index: qtyIncBtn.idx, description: `[Cart Test] Test quantity increment: "${qtyIncBtn.label || '+'}"` };
        }

        // 6. Add to Cart button (Product Detail page)
        const addToCartBtn = elements.find(e =>
            (e.tag === 'button' || e.tag === 'a' || e.role === 'button' || e.type === 'submit' || e.tag === 'input') &&
            /(?:add to cart|add to bag|buy now|add to basket|add item)/i.test(e.label || e.selector || '') &&
            !clickedIndices.has(e.idx)
        );
        if (addToCartBtn) {
            return { action: 'click', index: addToCartBtn.idx, description: `[Workflow] Add product to cart: "${addToCartBtn.label || 'Add to Cart'}"` };
        }

        // 7. Cart link / Cart icon navigation
        const cartBtn = elements.find(e =>
            /(?:view cart|go to cart|cart|basket|shopping cart)/i.test(e.label || '') &&
            !/(?:add to cart|add to bag)/i.test(e.label || '') &&
            !clickedIndices.has(e.idx)
        );
        if (cartBtn) {
            return { action: 'click', index: cartBtn.idx, description: `[Workflow] Open shopping cart: "${cartBtn.label}"` };
        }

        // 8. Product Selection
        const productLinks = elements.filter(e =>
            e.tag === 'a' &&
            (e.label || '').length > 8 &&
            !clickedIndices.has(e.idx) &&
            !/(?:privacy|terms|cookie|legal|sitemap|copyright|sign in|account|help|customer service|returns)/i.test(e.label || '')
        );
        if (productLinks.length > 0) {
            const prodIdx = clickedIndices.size > 2 ? 1 : 0;
            const targetProd = productLinks[prodIdx % productLinks.length] || productLinks[0];
            return { action: 'click', index: targetProd.idx, description: `[Workflow] Open product for purchase: ${(targetProd.label || 'item').slice(0, 45)}` };
        }

        // 9. Search Bar
        const searchInput = elements.find(e =>
            (e.tag === 'input' || e.type === 'search') &&
            /(?:search|query|q|find|product)/i.test(e.label || e.placeholder || e.name || '') &&
            !typedIndices.has(e.idx)
        );
        if (searchInput) {
            return { action: 'type', index: searchInput.idx, value: 'wireless headphones', pressEnter: true, description: `[Workflow] Search for products to buy` };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AGENT 5 (Worker G): Business Logic & Domain-Specific Testing
    // Bus booking (route, date, bus, seat selection, passenger) / pricing rules
    // ─────────────────────────────────────────────────────────────────────────
    if (workerId === 'G') {
        const seatBtn = elements.find(e =>
            ((/^\d{1,2}$/.test((e.label || '').trim()) && !e.disabled) || /(?:seat|berth|available)/i.test(e.label || e.selector || '')) &&
            !clickedIndices.has(e.idx)
        );
        if (seatBtn) {
            return { action: 'click', index: seatBtn.idx, description: `[Logic] Select seat "${seatBtn.label || seatBtn.idx}" to verify single-selection behavior` };
        }
        const selectSeatsBtn = elements.find(e =>
            /(?:select seats?|view seats?|book|choose seats?)/i.test(e.label || '') &&
            !clickedIndices.has(e.idx)
        );
        if (selectSeatsBtn) {
            return { action: 'click', index: selectSeatsBtn.idx, description: `[Logic] Open seat map: "${selectSeatsBtn.label}"` };
        }
        const cityInput = elements.find(e =>
            (e.tag === 'input' || e.type === 'input') &&
            /(?:departure|from|origin|destination|to|source)/i.test(e.label || e.placeholder || '') &&
            !typedIndices.has(e.idx)
        );
        if (cityInput) {
            const isTo = /(?:destination|to)/i.test(cityInput.label || cityInput.placeholder || '');
            const cityName = isTo ? 'Pune' : 'Mumbai';
            return { action: 'type', index: cityInput.idx, value: cityName, pressEnter: true, description: `[Logic] Enter route ${cityName} in ${cityInput.label || 'city'}` };
        }
        const passengerNameInput = elements.find(e =>
            e.tag === 'input' && /(?:passenger|name|full.?name)/i.test(e.label || e.placeholder || e.name || '') &&
            !/(?:user|login|email)/i.test(e.label || e.placeholder || '') &&
            !typedIndices.has(e.idx)
        );
        if (passengerNameInput) {
            return { action: 'type', index: passengerNameInput.idx, value: 'Tarun Kumar', pressEnter: false, description: `[Logic] Enter synthetic passenger name: Tarun Kumar` };
        }
        const passengerAgeInput = elements.find(e =>
            e.tag === 'input' && /(?:age)/i.test(e.label || e.placeholder || e.name || '') &&
            !typedIndices.has(e.idx)
        );
        if (passengerAgeInput) {
            return { action: 'type', index: passengerAgeInput.idx, value: '28', pressEnter: false, description: `[Logic] Enter passenger age: 28` };
        }
        const searchBusBtn = elements.find(e =>
            /(?:search buses?|find buses?|search|find)/i.test(e.label || '') &&
            !clickedIndices.has(e.idx)
        );
        if (searchBusBtn) {
            return { action: 'click', index: searchBusBtn.idx, description: `[Logic] Search available buses` };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AGENT 6 (Worker H): Defect Verification, Evidence & Reporting
    // Deep inspection, verification of issues, price consistency, checkout totals
    // ─────────────────────────────────────────────────────────────────────────
    if (workerId === 'H') {
        const sortOption = elements.find(e =>
            /(?:sort|price: low to high|customer reviews|featured|rating)/i.test(e.label || '') &&
            !clickedIndices.has(e.idx)
        );
        if (sortOption) {
            return { action: 'click', index: sortOption.idx, description: `[Defect] Verify sorting filter: "${sortOption.label}"` };
        }
        const reviewEl = elements.find(e =>
            /(?:reviews?|ratings?|specification|details|warranty)/i.test(e.label || '') &&
            !clickedIndices.has(e.idx)
        );
        if (reviewEl) {
            return { action: 'click', index: reviewEl.idx, description: `[Defect] Inspect specifications/reviews for defects: "${reviewEl.label}"` };
        }
        const prodLinks = elements.filter(e =>
            e.tag === 'a' && (e.label || '').length > 8 &&
            !clickedIndices.has(e.idx) &&
            !/(?:privacy|terms|cookie|legal|sitemap|copyright|sign in)/i.test(e.label || '')
        );
        if (prodLinks.length > 1) {
            const secondProd = prodLinks[1];
            return { action: 'click', index: secondProd.idx, description: `[Defect] Inspect second product for price consistency: ${(secondProd.label || '').slice(0, 45)}` };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SHARED FORMS: Safe Checkout, Address & Payment Field Automation
    // ─────────────────────────────────────────────────────────────────────────
    const nameInput = elements.find(e =>
        e.tag === 'input' && /(?:fullname|full_name|first_name|firstname)/i.test(e.label || e.placeholder || e.name || '') &&
        !/(?:card|user|login|email)/i.test(e.label || e.placeholder || e.name || '') &&
        !typedIndices.has(e.idx)
    );
    if (nameInput) {
        return { action: 'type', index: nameInput.idx, value: 'Tarun Kumar', pressEnter: false, description: `Enter full name: Tarun Kumar` };
    }

    const streetInput = elements.find(e =>
        (e.tag === 'input' || e.tag === 'textarea') && /(?:address|street|address1|addr)/i.test(e.label || e.placeholder || e.name || '') &&
        !typedIndices.has(e.idx)
    );
    if (streetInput) {
        return { action: 'type', index: streetInput.idx, value: '123 MG Road, Sector 4', pressEnter: false, description: `Enter address: 123 MG Road` };
    }

    const cityInput = elements.find(e =>
        e.tag === 'input' && /(?:city|town|district)/i.test(e.label || e.placeholder || e.name || '') &&
        !/(?:departure|origin|destination)/i.test(e.label || e.placeholder || '') &&
        !typedIndices.has(e.idx)
    );
    if (cityInput) {
        return { action: 'type', index: cityInput.idx, value: 'Mumbai', pressEnter: false, description: `Enter city: Mumbai` };
    }

    const zipInput = elements.find(e =>
        e.tag === 'input' && /(?:zip|postal|pincode|pin)/i.test(e.label || e.placeholder || e.name || '') &&
        !typedIndices.has(e.idx)
    );
    if (zipInput) {
        return { action: 'type', index: zipInput.idx, value: '400001', pressEnter: false, description: `Enter postal code: 400001` };
    }

    const cardInput = elements.find(e =>
        e.tag === 'input' && /(?:card.?number|cardnum|cc.?number|credit.?card|debit.?card)/i.test(e.label || e.placeholder || e.name || '') &&
        !typedIndices.has(e.idx)
    );
    if (cardInput) {
        return { action: 'type', index: cardInput.idx, value: '4111111111111111', pressEnter: false, description: `Enter test payment card number (safe test)` };
    }

    const expiryInput = elements.find(e =>
        e.tag === 'input' && /(?:exp|expiry|expiration|valid.?thru|mmyy)/i.test(e.label || e.placeholder || e.name || '') &&
        !typedIndices.has(e.idx)
    );
    if (expiryInput) {
        return { action: 'type', index: expiryInput.idx, value: '12/28', pressEnter: false, description: `Enter test card expiry: 12/28` };
    }

    const cvvInput = elements.find(e =>
        e.tag === 'input' && /(?:cvv|cvc|security.?code)/i.test(e.label || e.placeholder || e.name || '') &&
        !typedIndices.has(e.idx)
    );
    if (cvvInput) {
        return { action: 'type', index: cvvInput.idx, value: '123', pressEnter: false, description: `Enter test CVV: 123` };
    }

    const paymentRadio = elements.find(e =>
        (e.type === 'radio' || e.tag === 'button') &&
        /(?:card|credit|debit|upi|cash on delivery|cod|net banking)/i.test(e.label || '') &&
        !clickedIndices.has(e.idx)
    );
    if (paymentRadio) {
        return { action: 'click', index: paymentRadio.idx, description: `Select payment method: "${paymentRadio.label || 'Payment Option'}"` };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fallback: Click unclicked buttons or navigate links
    // ─────────────────────────────────────────────────────────────────────────
    const anyBtn = elements.find(e =>
        (e.tag === 'button' || e.role === 'button') &&
        (e.label || '').length > 2 &&
        !clickedIndices.has(e.idx) &&
        !/(?:home|logo|privacy|terms|cookie)/i.test(e.label || '')
    );
    if (anyBtn) {
        return { action: 'click', index: anyBtn.idx, description: `Interact with button: "${anyBtn.label}"` };
    }

    const anyLink = elements.find(e =>
        e.tag === 'a' && (e.label || '').trim().length > 3 &&
        !clickedIndices.has(e.idx) &&
        !/(?:privacy|terms|cookie|legal|sitemap|copyright)/i.test(e.label || '')
    );
    if (anyLink) {
        return { action: 'click', index: anyLink.idx, description: `Navigate page: "${(anyLink.label || 'link').slice(0, 40)}"` };
    }

    return { action: 'scroll', value: 'down', description: 'Scroll to discover more interactive elements' };
}

export async function runWorker(page, browser, workerId, siteContext, mission, onStatusUpdate, onIssue, onLog, onScreenshot, sharedVisitedUrls) {
    const log = msg => { console.log(`[Agent ${workerId}] ${msg}`); onLog(workerId, msg); };
    const updateStatus = (status, msg) => onStatusUpdate(workerId, status, msg);

    const history = [];       // step history for AI
    const bugs = [];          // all bugs collected
    const memory = {};        // cross-page memory (prices, dates, etc.)
    const localVisited = new Set();  // URLs this agent has visited
    let step = 0;
    let nullStreak = 0;       // consecutive AI null responses
    let failStreak = 0;       // consecutive action failures
    let consecutiveScrolls = 0; // track scroll spam
    let lastUrl = '';
    let lastActionKey = '';   // for same-action detection
    let sameActionCount = 0;  // how many times the exact same action was attempted
    const validationFlags = {};
    const capturedScreenshotKeys = new Set();

    const task = buildTask(mission, siteContext);
    log(`Task: ${task}`);

    // Initialize cursor overlay
    try { await initCursor(page); } catch { }

    // Initial popup dismissal
    await preFlightCheck(page, log);

    const maxSteps = AGENT_MAX_STEPS[workerId] || DEFAULT_MAX_STEPS;
    while (step < maxSteps) {
        if (isAIBudgetExhausted()) { log('Budget exhausted — stopping'); break; }

        step++;
        updateStatus('executing', `Step ${step}/${maxSteps}`);

        // ── Pre-flight: dismiss any popups before extracting state ──
        const popupDismissed = await preFlightCheck(page, log);
        if (popupDismissed) {
            await sleep(500); // DOM may have changed
        }
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => { });

        // ── Extract current page state ──
        let ps;
        try {
            if (page.isClosed()) {
                log('Page is closed — worker stopping');
                break;
            }
            ps = await extractPageState(page);
        } catch (e) {
            if (page.isClosed() || e.message?.includes('closed') || e.message?.includes('Target page')) {
                log(`Page or browser closed (${e.message?.slice(0, 40)}) — worker stopping`);
                break;
            }
            log(`Extractor error: ${e.message} — waiting and retrying`);
            await sleep(1500);
            continue;
        }

        const { url, title, headings, fullText, prices, cartTotal, currency, numbered, elements, elementCount } = ps;
        const maxIndex = Math.max(0, elementCount - 1);

        // Track URL changes and save page-level data to memory
        if (url !== lastUrl) {
            memory[`visited_${step}`] = url;
            localVisited.add(url);
            if (sharedVisitedUrls) sharedVisitedUrls.add(url);
            if (prices.length > 0) memory[`prices_${url.split('/').pop() || 'page'}`] = prices.slice(0, 5);
            if (cartTotal) memory.cart_total = cartTotal;
            if (currency && !memory.currency) memory.currency = currency;
            lastUrl = url;
            consecutiveScrolls = 0; // reset scroll counter on navigation
            try { await reinitCursor(page); } catch { }
        }

        log(`[Step ${step}] ${url.slice(0, 60)} | ${elementCount} els | prices: ${prices.join(', ') || 'none'}`);

        // ── Agent-scoped rule-based validation (UI, perf, security, etc.) ──
        if (step === 1 || step % 10 === 0) {
            const validationIssues = await runAgentValidations(workerId, page, ps, validationFlags);
            for (const issue of validationIssues) {
                const bug = validationIssueToBug(issue, workerId, url);
                const isVisual = issue.isVisual !== false && !['broken-link', 'meta-tags', 'missing-meta', 'load-time', 'timing'].includes(issue.type);
                const screenKey = `${url}_${step}`;
                if (isVisual && onScreenshot && !capturedScreenshotKeys.has(screenKey)) {
                    try {
                        const ss = await onScreenshot(page, workerId, bug.title || bug.type, url);
                        if (ss) {
                            bug.screenshot = ss;
                            capturedScreenshotKeys.add(screenKey);
                        }
                    } catch { }
                }
                bugs.push({ ...bug, step, url });
                onIssue(workerId, {
                    type: 'bug', severity: bug.severity,
                    message: bug.description, page: bug.page || title,
                    expected: bug.expected, actual: bug.actual,
                    source: 'validator',
                    screenshot: bug.screenshot,
                });
            }
        }

        // ── Worker-level bug detection (no AI needed) ──
        const workerBugs = detectWorkerBugs(ps, memory, log);
        for (const bug of workerBugs) {
            const bugKey = `${url}_${bug.type}`;
            if (onScreenshot && !capturedScreenshotKeys.has(bugKey)) {
                try {
                    const ss = await onScreenshot(page, workerId, bug.title || bug.type, url);
                    if (ss) {
                        bug.screenshot = ss;
                        capturedScreenshotKeys.add(bugKey);
                    }
                } catch { }
            }
            bugs.push({ ...bug, step, url });
            onIssue(workerId, {
                type: 'bug', severity: bug.severity,
                message: bug.description, page: bug.page || title,
                expected: bug.expected, actual: bug.actual,
                source: 'worker-detected',
                screenshot: bug.screenshot,
            });
        }

        // ── Auto-detect confirmation page — stop cleanly ──
        if (isConfirmation(title, fullText)) {
            log('✅ Confirmation page reached');
            history.push({ action: 'done', description: `Confirmed: ${title}`, success: true });
            break;
        }

        // ── Stuck detection ──
        const stuckReason = getStuckReason(history, consecutiveScrolls);
        if (stuckReason) {
            log(`⚠ Stuck detected: ${stuckReason}`);
        }

        // ── Ask AI for next action (with autonomous heuristic fallback) ──
        let action = null;
        try {
            action = await getNextAction({
                task, workerId, url, title, headings,
                pageText: fullText, prices, cartTotal, currency, numbered,
                maxIndex, history: history.slice(-6), memory, mission,
                stuckReason: stuckReason || undefined,
                visitedUrls: sharedVisitedUrls || localVisited,
            });
        } catch (e) {
            log(`AI error: ${e.message} — using autonomous heuristic fallback`);
        }

        if (!action) {
            const fallbackAction = pickAutonomousAction(elements, history, siteContext, workerId, mission);
            if (fallbackAction) {
                log(`⚡ Fallback heuristic action: ${fallbackAction.description || fallbackAction.action}`);
                action = fallbackAction;
            } else {
                nullStreak++;
                log(`AI null response (${nullStreak}/3)`);
                await sleep(1000);
                if (nullStreak >= 3) {
                    if (isConfirmation(title, fullText)) { log('✅ Auto-done (confirmation page)'); break; }
                    log('Stopping worker after consecutive null actions');
                    break;
                }
                continue;
            }
        }
        nullStreak = 0;

        // ── Same-action repeat detection — force navigation to new page ──
        const actionKey = `${action.action}:${action.index}:${action.value}`;
        if (actionKey === lastActionKey) {
            sameActionCount++;
            if (sameActionCount >= 3) {
                log(`⚠ Same action repeated ${sameActionCount}× — forcing navigation to new page`);
                // Try navigating to an unvisited internal link
                const visitedUrls = new Set(Object.values(memory).filter(v => typeof v === 'string' && v.startsWith('http')));
                const internalLinks = await page.evaluate((base) => {
                    const links = [];
                    for (const a of document.querySelectorAll('a[href]')) {
                        try {
                            const u = new URL(a.href, location.href);
                            if (u.origin === new URL(base).origin && u.href !== location.href &&
                                !/\.(pdf|zip|png|jpg|gif|svg|mp4)$/i.test(u.pathname) &&
                                !/#/.test(u.href)) {
                                links.push(u.href.split('?')[0]);
                            }
                        } catch { }
                    }
                    return [...new Set(links)].slice(0, 10);
                }, siteContext.url).catch(() => []);

                const nextLink = internalLinks.find(l => !visitedUrls.has(l));
                if (nextLink) {
                    log(`🔀 Navigating to unvisited page: ${nextLink.slice(0, 60)}`);
                    await page.goto(nextLink, { timeout: 20000, waitUntil: 'domcontentloaded' }).catch(() => {});
                    await sleep(1500);
                    try { await reinitCursor(page); } catch { }
                } else {
                    await page.mouse.wheel(0, 600);
                    await sleep(700);
                }
                history.push({ action: 'navigate', description: '(forced recovery — explore new page)', index: null, value: nextLink || 'scroll', success: true });
                sameActionCount = 0;
                continue;
            }
        } else {
            sameActionCount = 0;
        }
        lastActionKey = actionKey;

        // ── Merge AI memory updates ──
        if (action.memory && typeof action.memory === 'object') {
            for (const [k, v] of Object.entries(action.memory)) {
                if (v !== null && v !== undefined) {
                    memory[k] = v;
                    log(`💾 ${k} = ${JSON.stringify(v).slice(0, 60)}`);
                }
            }
        }

        // ── Collect AI-detected bugs ──
        if (Array.isArray(action.bugs)) {
            for (const bug of action.bugs) {
                if (!bug?.description) continue;
                log(`🐛 [${(bug.severity || 'medium').toUpperCase()}] ${bug.description}`);
                if (onScreenshot) {
                    try {
                        const ss = await onScreenshot(page, workerId, bug.title || bug.description?.slice(0, 30) || 'ai-bug', url);
                        if (ss) bug.screenshot = ss;
                    } catch { }
                }
                bugs.push({ ...bug, step, url });
                onIssue(workerId, {
                    type: 'bug', severity: bug.severity || 'medium',
                    message: bug.description, page: bug.page || title,
                    expected: bug.expected, actual: bug.actual,
                    source: 'ai-detected',
                    screenshot: bug.screenshot,
                });
            }
        }

        log(`📋 ${action.description || action.action}`);

        // ── Done action ──
        if (action.done === true || action.action === 'done') {
            log('✅ AI says done');
            history.push({ action: 'done', description: action.description, success: true });
            break;
        }

        // ── Execute action ──
        const el = (typeof action.index === 'number' && elements[action.index])
            ? elements[action.index] : null;
        let success = false;

        try {
            switch (action.action) {
                case 'click':
                    success = await doClick(page, el, log);
                    // ── Track seat click and auto-navigate to cart/checkout ──
                    if (success && el) {
                        const label = (el.label || '').trim();
                        if (/^\d{1,2}$/.test(label) || /(?:seat|berth)\s*\d*/i.test(action.description || '')) {
                            const seatNum = label.match(/\d+/)?.[0] || '1';
                            memory.seat_clicked = seatNum;
                            memory.expected_selected_seats = (memory.expected_selected_seats || 0) + 1;
                            log(`💺 Clicked seat "${seatNum}" — expected selected seats: ${memory.expected_selected_seats}`);
                        }
                        const isAddToCart = /add.to.cart|add.to.bag|add.item|buy.now|add to cart/i.test(label) ||
                            /add to cart|add to bag|buy now/i.test(action.description || '');
                        if (isAddToCart) {
                            await sleep(1000);
                            // 1. Dismiss protection plan / warranty modal if present (e.g. AppleCare, warranties)
                            try {
                                const noThanks = page.locator('button:has-text("No thanks"), button:has-text("No Thanks"), button:has-text("Skip"), input[aria-labelledby*="NoCoverage" i]').first();
                                if (await noThanks.isVisible({ timeout: 1200 }).catch(() => false)) {
                                    await noThanks.click({ force: true }).catch(() => {});
                                    await sleep(600);
                                    log('✓ Dismissed protection plan modal (clicked No Thanks)');
                                }
                            } catch {}

                            // 2. Click cart button in confirmation drawer if visible
                            try {
                                const drawerCart = page.locator('#attach-sidesheet-view-cart-button, #attach-sidesheet-checkout-button, [data-action="view-cart"]').first();
                                if (await drawerCart.isVisible({ timeout: 1200 }).catch(() => false)) {
                                    await drawerCart.click({ force: true }).catch(() => {});
                                    await sleep(1000);
                                    log('✓ Clicked view cart in confirmation drawer');
                                }
                            } catch {}

                            // 3. Verify item was actually added to cart
                            const badgeCount = await page.evaluate(() => {
                                const el = document.querySelector('#nav-cart-count, [class*="cart-count"], [class*="cartCount"], [data-cart-count]');
                                return el ? parseInt(el.textContent, 10) : null;
                            }).catch(() => null);

                            const confirmed = await page.evaluate(() => {
                                return /added to cart|item added|in your cart|view cart/i.test(document.body.innerText || '');
                            }).catch(() => false);

                            memory.added_to_cart = true;
                            memory.cart_items_count = (badgeCount && badgeCount > 0) ? badgeCount : ((memory.cart_items_count || 0) + 1);
                            memory.expected_cart_quantity = memory.cart_items_count;
                            log(`🛒 Added to cart verified! Cart count: ${memory.cart_items_count} [confirmed=${confirmed}]`);

                            if (onScreenshot) {
                                await onScreenshot(page, workerId, 'cart_item_added', page.url());
                            }

                            // 4. Worker F multi-product flow: add product #2 or proceed to cart
                            if (workerId === 'F') {
                                if (memory.cart_items_count < 2) {
                                    log('🛒 [Workflow] Product #1 added! Navigating to search for Product #2...');
                                    await sleep(800);
                                    try {
                                        const secondSearchUrl = new URL(siteContext.url).origin + '/s?k=laptop';
                                        await page.goto(secondSearchUrl, { timeout: 20000, waitUntil: 'domcontentloaded' });
                                        await sleep(1000);
                                    } catch {
                                        await page.goBack({ timeout: 8000, waitUntil: 'domcontentloaded' }).catch(() => {});
                                    }
                                } else {
                                    log('🛒 [Workflow] Multiple products in cart! Navigating to Cart page...');
                                    await sleep(800);
                                    const cartSelectors = [
                                        '#nav-cart', 'a[href*="cart"]', 'a[href*="basket"]', 'a[href*="bag"]',
                                        'button:has-text("Cart")', 'button:has-text("View Cart")',
                                        'button:has-text("Go to Cart")', 'a:has-text("Cart")',
                                        'a:has-text("View Cart")', 'a:has-text("Go to Cart")',
                                        '[class*="cart-icon"]', '[class*="cart-btn"]',
                                    ];
                                    let navSuccess = false;
                                    for (const sel of cartSelectors) {
                                        try {
                                            const loc = page.locator(sel).first();
                                            if (await loc.isVisible({ timeout: 1200 })) {
                                                await loc.click({ timeout: 2500 });
                                                await sleep(1200);
                                                log(`✓ Clicked cart button: ${sel}`);
                                                navSuccess = true;
                                                break;
                                            }
                                        } catch { }
                                    }
                                    if (!navSuccess) {
                                        try {
                                            const directCartUrl = new URL(siteContext.url).origin + '/cart';
                                            await page.goto(directCartUrl, { timeout: 15000, waitUntil: 'domcontentloaded' });
                                            await sleep(1000);
                                        } catch {}
                                    }
                                    if (onScreenshot) {
                                        await onScreenshot(page, workerId, 'cart_overview_evidence', page.url());
                                    }
                                }
                            }
                        }
                    }
                    break;

                case 'type':
                    success = await doType(page, el, action.value || '', {
                        pressEnterAfter: action.pressEnter === true,
                        pickSuggestion: action.waitForSuggestion === true,
                    }, log);
                    break;

                case 'press':
                    success = await doPress(page, action.value || 'Enter', log);
                    break;

                case 'select':
                    success = await doSelect(page, el, action.value || '', log);
                    break;

                case 'scroll': {
                    const dist = action.value === 'up' ? -600 : 600;
                    await page.mouse.wheel(0, dist);
                    await sleep(500);
                    log(`↕ scroll ${action.value || 'down'}`);
                    success = true;
                    consecutiveScrolls++;

                    // Force stop scrolling after too many
                    if (consecutiveScrolls > 4) {
                        log('⚠ Too many scrolls — forcing different action');
                        consecutiveScrolls = 0;
                    }
                    break;
                }

                case 'wait': {
                    const ms = Math.min(5000, Math.max(500, parseInt(action.value) || 1500));
                    await sleep(ms);
                    log(`⏳ wait ${ms}ms`);
                    success = true;
                    break;
                }

                case 'navigate':
                    if (action.value?.startsWith('http')) {
                        try {
                            const navResult = await safeNavigate(page, action.value, {
                                timeout: 20000,
                                bugList: bugs,
                                log,
                                source: `worker-${workerId}`,
                            });
                            await sleep(1500);
                            try { await reinitCursor(page); } catch { }
                            log(`→ navigated to: ${action.value.slice(0, 60)}${!navResult.ok ? ' (404!)' : ''}`);
                            success = true;
                        } catch (e) { log(`navigate error: ${e.message?.slice(0, 50)}`); }
                    }
                    break;

                default:
                    log(`Unknown action: ${action.action}`);
            }
        } catch (e) {
            log(`Action error: ${e.message?.slice(0, 80)}`);
            if (page.isClosed() || e.message?.includes('closed') || e.message?.includes('Target page')) {
                log('Page or target closed during action — worker stopping');
                break;
            }
            success = false;
        }

        // Reset scroll counter on non-scroll actions
        if (action.action !== 'scroll') {
            consecutiveScrolls = 0;
        }

        // Track failures and capture checkpoint screenshots
        if (success) {
            failStreak = 0;
            const currentUrl = page.url();
            const isMeaningfulAction = ['click', 'navigate'].includes(action.action) || currentUrl !== lastUrl;
            const screenKey = `chk_${currentUrl}_${action.action}`;
            if (isMeaningfulAction && onScreenshot && !capturedScreenshotKeys.has(screenKey)) {
                try {
                    await sleep(400);
                    const actionLabel = (action.description || action.action).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 25);
                    await onScreenshot(page, workerId, actionLabel, currentUrl);
                    capturedScreenshotKeys.add(screenKey);
                } catch { }
            }
        } else {
            failStreak++;
            if (failStreak >= 5) {
                log('⚠ 5 consecutive failures — recovery: dismiss popups + scroll');
                await preFlightCheck(page, log);
                await page.mouse.wheel(0, 400);
                await sleep(500);
                failStreak = 0;
            }
        }

        log(success ? '✓ Done' : '✗ Failed');

        history.push({
            action: action.action,
            description: action.description || '',
            index: action.index,
            value: action.value,
            success,
        });

        if (onStatusUpdate) {
            onStatusUpdate(workerId, 'executing', `Step ${step}/${maxSteps}`, {
                partial: {
                    stepsCompleted: step,
                    actionsSucceeded: history.filter(h => h.success !== false).length,
                    actionsFailed: history.filter(h => h.success === false).length,
                    bugs: [...bugs],
                    history: [...history],
                }
            });
        }

        await sleep(350);
    }

    if (step >= maxSteps) {
        log(`⚠ Step limit (${maxSteps}) reached — stopping`);
    }

    // Normalize status: 'passed' → 'done' so orchestrator completedScenarios count works.
    // 'issues' stays 'issues' (bugs found); 'failed' stays 'failed' (many bugs).
    const rawStatus = bugs.length > 5 ? 'failed' : bugs.length > 0 ? 'issues' : 'passed';
    const status = rawStatus === 'passed' ? 'done' : rawStatus;

    // Summarize what the agent actually did
    const successCount = history.filter(h => h.success !== false).length;
    const failCount = history.filter(h => h.success === false).length;
    log(`🏁 Done — ${step} steps, ${successCount} passed, ${failCount} failed, ${bugs.length} bugs`);

    return {
        id: workerId,
        taskType: 'flow',
        taskName: task.slice(0, 80),
        status,
        stepsCompleted: step,
        actionsSucceeded: successCount,
        actionsFailed: failCount,
        issuesFound: bugs.length,
        bugs, history, memory,
    };
}
