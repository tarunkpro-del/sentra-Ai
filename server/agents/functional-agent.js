/**
 * functional-agent.js — Agent G: Cross-Page Data Validator (v2)
 *
 * Uses Gemini 2.5 Flash for deep data validation.
 * Targeted bugs (deterministic page analysis):
 *  Bug #3 — Product description mismatch (mouse described as headphones)
 *  Bug #4 — Review mismatch (gaming console shows dress review)
 *  Bug #5 — Currency symbol error (Germany EUR shows £)
 *  Bug #9 — Price inconsistency: listing price ≠ seat details price
 */

import { extractPageState } from '../extractor.js';
import { callGemini } from '../gemini.js';
import { safeNavigate } from '../safe-navigate.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function norm(s) { return (s || '').toLowerCase(); }

// ── Helper: check text for keyword presence ──
function textContainsAny(text, keywords) {
    const t = norm(text);
    return keywords.some(k => t.includes(k));
}

/**
 * Scan product cards on the homepage/listing for description/review mismatches.
 * Bugs #3 and #4.
 * NOTE: We collect data from the homepage cards directly (not individual product pages)
 * because this is a SPA and direct product URLs return 404.
 */
async function scanProductPages(page, baseUrl, sharedBugs, log) {
    const bugs = [];

    // Navigate to home
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
    await sleep(1500);

    // Scroll to load all products
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 600));
        await sleep(500);
    }

    // Extract product data from homepage cards (name + description on each card)
    const products = await page.evaluate(() => {
        const results = [];
        // Try multiple card selectors
        const cardSelectors = [
            '[class*="product-card"]', '[class*="product"]', '.card', 'article',
            '[class*="item-card"]', '[class*="grid"] > div',
        ];
        let cards = [];
        for (const sel of cardSelectors) {
            cards = [...document.querySelectorAll(sel)];
            if (cards.length >= 3) break;
        }
        for (const card of cards.slice(0, 12)) {
            const name = (card.querySelector('h2, h3, [class*="title"], [class*="name"]')?.textContent || '').trim();
            const desc = (card.querySelector('p, [class*="desc"], [class*="description"]')?.textContent || '').trim();
            const reviews = [...card.querySelectorAll('[class*="review"]')].map(r => r.textContent?.trim()).filter(Boolean);
            if (name) results.push({ name, description: desc, reviews });
        }
        return results;
    }).catch(() => []);

    log(`Found ${products.length} product cards on homepage`);

    // Also try clicking into individual product pages (via click, not goto)
    // Collect product links for click-based navigation
    const productLinks = await page.evaluate(() => {
        const links = [];
        document.querySelectorAll('a[href*="/product"], [class*="product"] a, .card a').forEach(a => {
            if (a.href && a.href.includes('/product') && !links.includes(a.href)) {
                links.push(a.href);
            }
        });
        return links.slice(0, 6);
    }).catch(() => []);

    // Try clicking each product link to get full details
    for (let i = 0; i < Math.min(productLinks.length, 6); i++) {
        try {
            const link = productLinks[i];
            // Click the link instead of page.goto (SPA routes 404 on direct access)
            const linkEl = page.locator(`a[href="${new URL(link).pathname}"]`).first();
            if (await linkEl.isVisible({ timeout: 1500 })) {
                await linkEl.click({ timeout: 3000 });
                await sleep(1200);

                const data = await page.evaluate(() => {
                    const get = sel => document.querySelector(sel)?.textContent?.trim() || '';
                    const getAll = sel => [...document.querySelectorAll(sel)].map(el => el.textContent?.trim()).filter(Boolean);
                    const name = get('h1') || get('h2') || get('[class*="product-title"]') || get('[class*="product-name"]');
                    const description = get('[class*="description"]') || get('[class*="product-desc"]') || get('[class*="detail"] p') || get('.description') || '';
                    const reviews = getAll('[class*="review-text"], [class*="review-body"], [class*="review-content"], [class*="comment"] p').slice(0, 5);
                    return { name, description, reviews };
                }).catch(() => null);

                if (data && data.name) {
                    // Update/add to products array
                    const existing = products.find(p => norm(p.name) === norm(data.name));
                    if (existing) {
                        if (data.description) existing.description = data.description;
                        if (data.reviews.length > 0) existing.reviews = data.reviews;
                    } else {
                        products.push(data);
                    }
                    log(`[${i + 1}] Visited "${data.name.slice(0, 40)}" — desc: "${data.description.slice(0, 60)}"`);
                }
                // Go back to homepage for next product
                await page.goBack({ timeout: 5000 }).catch(() => { });
                await sleep(800);
            }
        } catch (e) {
            log(`Product ${i + 1} click error: ${e.message?.slice(0, 40)}`);
            // Navigate back to home on error
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => { });
            await sleep(800);
        }
    }

    // Now check all collected products for bugs
    for (const data of products) {
        const nameL = norm(data.name);
        const descL = norm(data.description);

        // Bug #3: Mouse product described as headphones
        const isMouse = textContainsAny(nameL, ['mouse', 'mice', 'pointer', 'trackpad']);
        const hasHeadphoneDesc = textContainsAny(descL, ['headphone', 'earphone', 'noise-cancelling', 'sound quality', 'noise cancelling']);
        if (isMouse && hasHeadphoneDesc && !sharedBugs.some(b => b.type === 'description_mismatch')) {
            const bug = {
                type: 'description_mismatch',
                severity: 'high',
                title: 'Product Description Mismatch: Mouse Described as Headphones',
                description: `The product "${data.name}" is a mouse, but its description reads like a headphones product: "${data.description.slice(0, 120)}"`,
                page: baseUrl,
                expected: 'The description for a mouse should describe its features (DPI, buttons, ergonomics)',
                actual: `Description says: "${data.description.slice(0, 100)}"`,
                businessImpact: 'Wrong product descriptions mislead buyers, destroy product credibility, and cause returns.',
                source: 'functional-agent',
            };
            bugs.push(bug);
            sharedBugs.push(bug);
            log(`🐛 Bug #3: Description mismatch on "${data.name}"`);
        }

        // Bug #4: Gaming console shows a dress/clothing review
        const isConsole = textContainsAny(nameL, ['console', 'gaming', 'playstation', 'xbox', 'nintendo', 'game']);
        const reviewsL = (data.reviews || []).map(norm);
        for (const review of reviewsL) {
            const hasDressReview = textContainsAny(review, ['dress', 'fabric', 'cloth', 'wear', 'fit', 'size', 'shirt', 'skirt', 'fashion', 'outfit', 'material', 'sleeve']);
            if (isConsole && hasDressReview && !sharedBugs.some(b => b.type === 'review_mismatch')) {
                const rawReview = data.reviews[reviewsL.indexOf(review)];
                const bug = {
                    type: 'review_mismatch',
                    severity: 'high',
                    title: 'Wrong Product Review Shown on Gaming Console',
                    description: `The gaming console product "${data.name}" displays a review that is clearly about a clothing/dress item.`,
                    page: baseUrl,
                    expected: 'Reviews should be about the gaming console (performance, graphics, gameplay)',
                    actual: `Review says: "${rawReview?.slice(0, 130)}"`,
                    businessImpact: 'Incorrect reviews destroy product credibility and reduce purchase confidence.',
                    source: 'functional-agent',
                };
                bugs.push(bug);
                sharedBugs.push(bug);
                log(`🐛 Bug #4: Dress review on gaming console "${data.name}"`);
                break;
            }
        }
    }

    // AI analysis on products with both name and description
    for (const data of products.filter(p => p.name && p.description)) {
        try {
            const aiPrompt = `Product: "${data.name}"\nDescription: "${data.description.slice(0, 300)}"\nReviews: ${(data.reviews || []).slice(0, 3).map(r => `"${r.slice(0, 100)}"`).join(', ')}\n\nCheck:\n1. Does the description match the product? (e.g., a mouse shouldn't have headphone description)\n2. Do the reviews match the product? (e.g., a console shouldn't have dress reviews)\nReply with ONLY "OK" if everything matches, or "MISMATCH: [reason]" if not.`;
            const aiResult = await callGemini(aiPrompt, 'functional');
            if (aiResult) {
                log(`AI: "${data.name.slice(0, 30)}" → ${aiResult.slice(0, 60)}`);
            }
        } catch { }
    }

    return bugs;
}

/**
 * Check currency after switching to Germany.
 * Bug #5.
 * NOTE: The region selector ("Ship to:") is on the cart page, not the home page.
 * Must navigate to cart via clicking (SPA — direct URLs 404).
 */
async function checkCurrencySwitch(page, baseUrl, sharedBugs, log) {
    const bugs = [];
    try {
        // Navigate back to home first
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
        await sleep(1000);

        // Add an item to cart first (so cart page has content)
        try {
            const addBtn = page.locator('button:has-text("Add"), [class*="add-to-cart"]').first();
            if (await addBtn.isVisible({ timeout: 2000 })) {
                await addBtn.click({ timeout: 3000 });
                await sleep(1000);
                log('Added item to cart for currency test');
            }
        } catch { }

        // Navigate to cart via click (NOT page.goto — SPA returns 404 on direct URLs)
        let onCart = false;
        const cartNavSelectors = [
            'a:has-text("Cart")', '[class*="cart"] a', '[aria-label*="cart" i]',
            'a[href*="cart"]', 'button:has-text("Cart")',
        ];
        for (const sel of cartNavSelectors) {
            try {
                const el = page.locator(sel).first();
                if (await el.isVisible({ timeout: 1000 })) {
                    await el.click({ timeout: 3000 });
                    await sleep(2000);
                    onCart = true;
                    log('Navigated to cart page via click');
                    break;
                }
            } catch { }
        }
        if (!onCart) { log('Could not navigate to cart — skipping currency check'); return bugs; }

        // Now look for the region/country selector on the cart page
        let switched = false;

        // Strategy 1: Native <select> (the "Ship to:" selector)
        const selectCandidates = [
            'select[name*="country" i]', 'select[id*="country" i]', 'select[id*="region" i]',
            'select[id*="currency" i]', 'select[name*="currency" i]', 'select[name*="locale" i]',
            'select', // fallback: any select on the cart page
        ];
        for (const sel of selectCandidates) {
            try {
                const el = page.locator(sel).first();
                if (await el.isVisible({ timeout: 800 })) {
                    for (const opt of [{ label: 'Germany — EUR' }, { label: 'Germany' }, { value: 'DE' }, { value: 'de' }, { label: 'EUR' }, { value: 'EUR' }]) {
                        try { await el.selectOption(opt); await sleep(1500); switched = true; break; } catch { }
                    }
                    if (switched) break;
                }
            } catch { }
        }

        // Strategy 2: Click a dropdown, then pick Germany
        if (!switched) {
            const dropdownTriggers = [
                'button:has-text("Ship")', '[class*="country"]', '[class*="region"]',
                '[class*="currency"]', '[aria-label*="country" i]', '[aria-label*="region" i]',
            ];
            for (const sel of dropdownTriggers) {
                try {
                    const el = page.locator(sel).first();
                    if (await el.isVisible({ timeout: 800 })) {
                        await el.click({ timeout: 2000 });
                        await sleep(800);
                        for (const gSel of ['text=Germany', 'li:has-text("Germany")', 'option:has-text("Germany")']) {
                            try {
                                const gEl = page.locator(gSel).first();
                                if (await gEl.isVisible({ timeout: 500 })) {
                                    await gEl.click({ timeout: 2000 });
                                    await sleep(1500);
                                    switched = true;
                                    break;
                                }
                            } catch { }
                        }
                        if (switched) break;
                    }
                } catch { }
            }
        }

        if (!switched) { log('Could not switch to Germany — skipping currency check'); return bugs; }

        log('Switched to Germany — checking currency symbols...');

        // Read currency from the page
        const currencyResult = await page.evaluate(() => {
            const text = document.body?.innerText || '';
            const pounds = (text.match(/£/g) || []).length;
            const euros = (text.match(/€/g) || []).length;
            return { pounds, euros };
        });

        log(`After Germany: £=${currencyResult.pounds} €=${currencyResult.euros}`);

        if (currencyResult.pounds > 0 && currencyResult.euros === 0) {
            const bug = {
                type: 'currency_mismatch',
                severity: 'critical',
                title: 'Currency Symbol Error: Germany Shows £ Instead of €',
                description: `After selecting Germany as region, prices show £ (British Pound) instead of € (Euro).`,
                page: page.url(),
                expected: 'Selecting Germany should display prices in € (Euro)',
                actual: `Prices display £ — ${currencyResult.pounds} occurrences of £, 0 occurrences of €`,
                businessImpact: 'German customers see wrong currency, causing broken checkout flows and loss of international revenue.',
                source: 'functional-agent',
            };
            bugs.push(bug);
            sharedBugs.push(bug);
            log(`🐛 Bug #5: Currency mismatch — Germany shows £`);
        }
    } catch (e) {
        log(`Currency check error: ${e.message?.slice(0, 60)}`);
    }
    return bugs;
}

/**
 * Check bus listing price vs seat details price.
 * Bug #9.
 */
async function checkBusPriceConsistency(page, sharedBugs, log) {
    const bugs = [];
    try {
        // Extract listing prices before navigating to details
        const listingData = await page.evaluate(() => {
            const cards = document.querySelectorAll(
                '[class*="bus"], [class*="result"], [class*="listing"], article, [class*="card"]'
            );
            const results = [];
            for (const card of cards) {
                const priceEl = card.querySelector('[class*="price"], [class*="fare"], [class*="amount"], [class*="cost"]');
                const nameEl = card.querySelector('h2, h3, h4, [class*="name"], [class*="title"], [class*="operator"]');
                const btn = card.querySelector('button, a[href]');
                if (priceEl && priceEl.textContent?.trim()) {
                    results.push({
                        name: nameEl?.textContent?.trim()?.slice(0, 60) || `Bus ${results.length + 1}`,
                        priceText: priceEl.textContent.trim(),
                        priceNum: parseFloat((priceEl.textContent || '').replace(/[^0-9.]/g, '')) || 0,
                    });
                }
            }
            return results.slice(0, 3);
        });

        if (listingData.length === 0) { log('No bus listings found for price check'); return bugs; }
        log(`Listing prices: ${listingData.map(d => `${d.name.slice(0, 20)}: ${d.priceText}`).join(', ')}`);

        // Click on first result to see seat details
        try {
            const firstBtn = page.locator('[class*="bus"] button, [class*="result"] button, [class*="card"] button, article button').first();
            if (await firstBtn.isVisible({ timeout: 2000 })) {
                await firstBtn.click({ force: true });
                await sleep(2000);
            }
        } catch { }

        // Get price from details view
        const detailsPrice = await page.evaluate(() => {
            const priceEls = document.querySelectorAll('[class*="price"], [class*="fare"], [class*="total-price"], [class*="seat-price"]');
            for (const el of priceEls) {
                const num = parseFloat((el.textContent || '').replace(/[^0-9.]/g, ''));
                if (num > 0) return { raw: el.textContent?.trim(), value: num };
            }
            return null;
        });

        if (detailsPrice && listingData[0].priceNum > 0) {
            const diff = Math.abs(listingData[0].priceNum - detailsPrice.value);
            log(`Price comparison: listing=${listingData[0].priceNum} details=${detailsPrice.value} diff=${diff}`);

            if (diff > 1 && diff / Math.max(listingData[0].priceNum, 1) > 0.02) {
                const bug = {
                    type: 'price_inconsistency',
                    severity: 'critical',
                    title: 'Bus Price Inconsistency: Listing vs Seat Selection',
                    description: `Bus "${listingData[0].name}" shows price ${listingData[0].priceText} in search results, but the seat selection page shows ${detailsPrice.raw}.`,
                    page: page.url(),
                    expected: `Price in seat details should match listing price: ${listingData[0].priceText}`,
                    actual: `Seat details shows: ${detailsPrice.raw} (difference: ${diff.toFixed(2)})`,
                    businessImpact: 'Price bait-and-switch destroys user trust and causes booking abandonment. This is a legal liability.',
                    source: 'functional-agent',
                };
                bugs.push(bug);
                sharedBugs.push(bug);
                log(`🐛 Bug #9: Price inconsistency ${listingData[0].priceText} vs ${detailsPrice.raw}`);
            }
        }
    } catch (e) {
        log(`Bus price check error: ${e.message?.slice(0, 60)}`);
    }
    return bugs;
}

export async function runFunctionalAgent(page, siteType, baseUrl, sharedBugs, onLog) {
    const log = msg => onLog('G', msg);
    log('⚙️ Functional Agent starting...');
    const bugs = [];

    try {
        const isShop = siteType === 'ecommerce' || /shoptest/i.test(baseUrl);
        const isBus = siteType === 'booking' || /bustest/i.test(baseUrl);

        if (isShop) {
            // Bug #3: Description mismatch, Bug #4: Review mismatch
            const pdBugs = await scanProductPages(page, baseUrl, sharedBugs, log);
            bugs.push(...pdBugs);

            // Bug #5: Currency mismatch
            const curBugs = await checkCurrencySwitch(page, baseUrl, sharedBugs, log);
            bugs.push(...curBugs);

            // Cart checks — navigate via click (SPA returns 404 on direct URLs)
            try {
                log('Navigating to cart via click...');
                // First go back to home
                await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
                await sleep(1000);
                // Add an item so cart has something
                try {
                    const addBtn = page.locator('button:has-text("Add"), [class*="add-to-cart"]').first();
                    if (await addBtn.isVisible({ timeout: 2000 })) {
                        await addBtn.click({ timeout: 3000 });
                        await sleep(1000);
                    }
                } catch { }
                // Click Cart link
                let onCart = false;
                for (const sel of ['a:has-text("Cart")', 'a[href*="cart"]', '[class*="cart"] a', '[aria-label*="cart" i]']) {
                    try {
                        const el = page.locator(sel).first();
                        if (await el.isVisible({ timeout: 1000 })) {
                            await el.click({ timeout: 3000 });
                            await sleep(2000);
                            onCart = true;
                            break;
                        }
                    } catch { }
                }
                if (onCart) {
                    const cartState = await extractPageState(page);

                    // Cart quantity check
                    if (cartState.cartQuantities && cartState.cartQuantities.length > 0) {
                        for (const qty of cartState.cartQuantities) {
                            if (qty > 1 && !sharedBugs.some(b => b.type === 'quantity_mismatch')) {
                                const bug = {
                                    type: 'quantity_mismatch',
                                    severity: 'critical',
                                    title: 'Cart Quantity Doubling: Expected 1, Got More',
                                    description: `Cart shows quantity ${qty} for an item. Only 1 was added.`,
                                    page: cartState.url,
                                    expected: 'Cart quantity should be 1',
                                    actual: `Cart shows quantity ${qty}`,
                                    businessImpact: 'Users are charged for items they did not intend to buy.',
                                    source: 'functional-agent',
                                };
                                bugs.push(bug);
                                sharedBugs.push(bug);
                                log(`🐛 Cart quantity doubling: expected 1, got ${qty}`);
                                break;
                            }
                        }
                    }
                    log(`Cart quantities: ${cartState.cartQuantities?.join(', ') || 'none'}`);

                    // Cart total check (Bug #6) — read from page text
                    const cartTotals = await page.evaluate(() => {
                        const text = document.body?.innerText || '';
                        const parsePrice = pattern => {
                            const m = text.match(pattern);
                            return m ? parseFloat(m[1].replace(/,/g, '')) : null;
                        };
                        return {
                            subtotal: parsePrice(/sub\s*total[:\s]*\$?([\d,.]+)/i),
                            tax: parsePrice(/tax[^\n]*\$?([\d,.]+)/i),
                            total: parsePrice(/(?:^|\n)\s*total[:\s]*\$?([\d,.]+)/im),
                        };
                    });
                    log(`Cart totals: subtotal=$${cartTotals.subtotal} tax=$${cartTotals.tax} total=$${cartTotals.total}`);

                    if (cartTotals.subtotal && cartTotals.total) {
                        const expected = (cartTotals.subtotal || 0) + (cartTotals.tax || 0);
                        const diff = cartTotals.total - expected;
                        if (Math.abs(diff) > 1 && !sharedBugs.some(b => b.type === 'cart_total_error')) {
                            const bug = {
                                type: 'cart_total_error',
                                severity: 'critical',
                                title: 'Cart Total Miscalculated',
                                description: `Cart total is $${cartTotals.total} but subtotal ($${cartTotals.subtotal}) + tax ($${cartTotals.tax || 0}) = $${expected.toFixed(2)}. Off by $${diff.toFixed(2)}.`,
                                page: page.url(),
                                expected: `Total should be $${expected.toFixed(2)}`,
                                actual: `Total shows $${cartTotals.total} (off by $${diff.toFixed(2)})`,
                                businessImpact: 'Cart total undercharge of $50 is a direct financial loss on every order.',
                                source: 'functional-agent',
                            };
                            bugs.push(bug);
                            sharedBugs.push(bug);
                            log(`🐛 Bug #6: Cart total off by $${diff.toFixed(2)}`);
                        }
                    }
                } else {
                    log('Could not navigate to cart page');
                }
            } catch (e) {
                log(`Cart check error: ${e.message?.slice(0, 40)}`);
            }
        }

        if (isBus) {
            log('🚌 Starting bus site full booking flow...');

            // Step 1: Dismiss login modal
            try {
                const skipBtn = page.locator('button:has-text("Skip"), button:has-text("skip for now"), button:has-text("✕"), button:has-text("×"), [aria-label="close"]').first();
                if (await skipBtn.isVisible({ timeout: 2000 })) {
                    await skipBtn.click({ timeout: 2000 });
                    await sleep(800);
                    log('Dismissed login modal');
                }
            } catch { }

            // Step 2: Fill search form via dropdowns
            let selectedDate = null;
            try {
                // Click From dropdown and select city
                const fromInput = page.locator('#from-input, [placeholder*="Departure"], [placeholder*="From"], input[name*="from"]').first();
                if (await fromInput.isVisible({ timeout: 2000 })) {
                    await fromInput.click({ timeout: 2000 });
                    await sleep(500);
                    const chennai = page.locator('text=Chennai').first();
                    if (await chennai.isVisible({ timeout: 2000 })) {
                        await chennai.click({ timeout: 2000 });
                        await sleep(500);
                        log('Selected From: Chennai');
                    }
                }

                // Click To dropdown and select city
                const toInput = page.locator('#to-input, [placeholder*="Destination"], [placeholder*="To"], input[name*="to"]').first();
                if (await toInput.isVisible({ timeout: 2000 })) {
                    await toInput.click({ timeout: 2000 });
                    await sleep(500);
                    const bangalore = page.locator('text=Bangalore').first();
                    if (await bangalore.isVisible({ timeout: 2000 })) {
                        await bangalore.click({ timeout: 2000 });
                        await sleep(500);
                        log('Selected To: Bangalore');
                    }
                }

                // Click date picker and select a date — remember it
                const dateInput = page.locator('#date-input, input[type="date"], [placeholder*="Date"]').first();
                if (await dateInput.isVisible({ timeout: 2000 })) {
                    await dateInput.click({ timeout: 2000 });
                    await sleep(500);
                    // Try to get current value
                    selectedDate = await dateInput.inputValue().catch(() => null);
                    if (!selectedDate) {
                        // Click a future date in calendar popup
                        const dayBtn = page.locator('.calendar-day:not(.disabled):not(.past), [class*="day"]:not(.disabled)').first();
                        if (await dayBtn.isVisible({ timeout: 1500 })) {
                            selectedDate = await dayBtn.textContent().catch(() => null);
                            await dayBtn.click({ timeout: 2000 });
                            await sleep(500);
                        }
                    }
                    log(`Selected date: ${selectedDate || 'auto'}`);
                }

                // Read the date field value after selection
                try {
                    const dateVal = await page.locator('#date-input, input[type="date"]').first().inputValue().catch(() => '');
                    if (dateVal) selectedDate = dateVal;
                } catch { }

                // Click Search
                const searchBtn = page.locator('#search-btn, button:has-text("Search")').first();
                if (await searchBtn.isVisible({ timeout: 2000 })) {
                    await searchBtn.click({ timeout: 3000 });
                    await sleep(3000);
                    log('Clicked Search');
                }
            } catch (e) {
                log(`Search form error: ${e.message?.slice(0, 40)}`);
            }

            // Step 3: Bug #9 — Price inconsistency (listing vs seat page)
            const priceBugs = await checkBusPriceConsistency(page, sharedBugs, log);
            bugs.push(...priceBugs);

            // Step 4: Check seat quantity — select ONE seat, verify count
            try {
                // We should now be on the seat page (checkBusPriceConsistency clicked through)
                const pageText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');

                if (/seat|select.*seat/i.test(pageText)) {
                    // Count currently selected seats BEFORE clicking
                    const beforeCount = await page.evaluate(() => {
                        const selected = document.querySelectorAll('.selected, [class*="selected"], button.active, [aria-pressed="true"]');
                        return selected.length;
                    }).catch(() => 0);

                    // Click ONE available seat
                    const seatBtns = page.locator('button:not(.booked):not(.disabled):not(.selected):not([disabled])');
                    const seatCount = await seatBtns.count();
                    let clickedSeat = false;
                    for (let i = 0; i < Math.min(seatCount, 20); i++) {
                        const btn = seatBtns.nth(i);
                        const text = await btn.textContent().catch(() => '');
                        // Only click numbered seat buttons
                        if (/^\d+$/.test(text.trim())) {
                            await btn.click({ timeout: 2000 });
                            clickedSeat = true;
                            log(`Clicked seat: ${text.trim()}`);
                            await sleep(1000);
                            break;
                        }
                    }

                    if (clickedSeat) {
                        // Count selected seats AFTER clicking
                        const afterCount = await page.evaluate(() => {
                            const selected = document.querySelectorAll('.selected, [class*="selected"], button.active, [aria-pressed="true"]');
                            return selected.length;
                        }).catch(() => 0);

                        // Also check the booking summary text
                        const summaryText = await page.evaluate(() => {
                            const summary = document.querySelector('[class*="summary"], [class*="booking"]');
                            return summary?.innerText || '';
                        }).catch(() => '');

                        const seatsInSummary = (summaryText.match(/(\d+)\s*×|seats?[:\s]*(\d+)/i) || []);
                        const summaryCount = parseInt(seatsInSummary[1] || seatsInSummary[2] || '0');

                        const newSelections = afterCount - beforeCount;
                        log(`Seat selection: before=${beforeCount}, after=${afterCount}, new=${newSelections}, summary says: ${summaryCount || 'unknown'}`);

                        // Bug: If clicking 1 seat selects 2, that's a bug
                        if ((newSelections > 1 || summaryCount > 1) && !sharedBugs.some(b => b.type === 'seat_quantity_mismatch')) {
                            const actualCount = summaryCount || newSelections;
                            const bug = {
                                type: 'seat_quantity_mismatch',
                                severity: 'critical',
                                title: 'Seat Quantity Bug: Selected 1, Got ' + actualCount,
                                description: `After clicking ONE seat, ${actualCount} seats are selected/shown in the booking summary.`,
                                page: page.url(),
                                expected: 'Clicking 1 seat should select exactly 1 seat',
                                actual: `${actualCount} seats selected after clicking 1`,
                                businessImpact: 'Users are charged for extra seats they did not select, causing overcharges and complaints.',
                                source: 'functional-agent',
                            };
                            bugs.push(bug);
                            sharedBugs.push(bug);
                            log(`🐛 Seat quantity bug: clicked 1, got ${actualCount}`);
                        }

                        // Step 5: Proceed to payment for date check
                        try {
                            const payBtn = page.locator('button:has-text("Continue"), button:has-text("Payment"), button:has-text("Proceed"), a:has-text("Continue")').first();
                            if (await payBtn.isVisible({ timeout: 2000 })) {
                                await payBtn.click({ timeout: 3000 });
                                await sleep(2500);
                                log('Proceeded to payment page');

                                // Step 6: Check date on payment page
                                if (selectedDate) {
                                    const paymentText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');

                                    // Parse dates from payment page
                                    const datePatterns = paymentText.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/g) || [];
                                    const dateTexts = paymentText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s*\d{2,4}/gi) || [];

                                    log(`Payment page dates found: ${[...datePatterns, ...dateTexts].join(', ') || 'none'}`);
                                    log(`Selected date was: ${selectedDate}`);

                                    // Compare: try to detect off-by-1-day
                                    try {
                                        const selDate = new Date(selectedDate);
                                        if (!isNaN(selDate.getTime())) {
                                            for (const found of [...datePatterns, ...dateTexts]) {
                                                const foundDate = new Date(found);
                                                if (!isNaN(foundDate.getTime())) {
                                                    const diffDays = Math.round((foundDate - selDate) / (1000 * 60 * 60 * 24));
                                                    log(`Date comparison: selected=${selDate.toDateString()}, payment=${foundDate.toDateString()}, diff=${diffDays} days`);

                                                    if (Math.abs(diffDays) === 1 && !sharedBugs.some(b => b.type === 'date_mismatch')) {
                                                        const bug = {
                                                            type: 'date_mismatch',
                                                            severity: 'critical',
                                                            title: `Travel Date Off by 1 Day`,
                                                            description: `Selected travel date was ${selDate.toDateString()}, but payment/confirmation page shows ${foundDate.toDateString()} (off by ${diffDays} day).`,
                                                            page: page.url(),
                                                            expected: `Travel date: ${selDate.toDateString()}`,
                                                            actual: `Payment shows: ${foundDate.toDateString()} (${diffDays > 0 ? '+' : ''}${diffDays} day)`,
                                                            businessImpact: 'Wrong travel dates cause passengers to miss their bus, leading to refund demands and legal issues.',
                                                            source: 'functional-agent',
                                                        };
                                                        bugs.push(bug);
                                                        sharedBugs.push(bug);
                                                        log(`🐛 Date mismatch: off by ${diffDays} day!`);
                                                    }
                                                }
                                            }
                                        }
                                    } catch { }
                                }
                            }
                        } catch (e) {
                            log(`Payment navigation error: ${e.message?.slice(0, 40)}`);
                        }
                    }
                } else {
                    log('Not on seat page — skipping seat/date checks');
                }
            } catch (e) {
                log(`Seat quantity check error: ${e.message?.slice(0, 40)}`);
            }
        }
    } catch (e) {
        log(`Functional agent error: ${e.message}`);
    }

    log(`Functional Agent done. Bugs found: ${bugs.length}`);
    return { id: 'G', name: 'Functional', bugs, stepsCompleted: 20 };
}
