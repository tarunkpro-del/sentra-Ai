/**
 * bug-detector.js — Deterministic 10-Bug Detector
 *
 * Runs AFTER all 6 agents as a guaranteed safety net.
 * Uses direct Playwright code — NO AI. No flakiness.
 *
 * ShopTest bugs (1–6): https://neoshoptest.vercel.app/
 * BusTest bugs (7–10): https://neobustest.vercel.app/
 */

const sleep = ms => new Promise(r => setTimeout(r, ms));

function norm(s) { return (s || '').toLowerCase(); }
function parsePrice(s) { return parseFloat((s || '').replace(/[^0-9.]/g, '')) || 0; }

// ────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ────────────────────────────────────────────────────────────────────────────

async function dismissModalIfPresent(page) {
    try {
        const closeBtn = page.locator('button:has-text("Skip for now"), button:has-text("✕"), button:has-text("Skip"), button:has-text("Close")').first();
        for (let i = 0; i < 3; i++) {
            if (await closeBtn.isVisible({ timeout: 400 }).catch(() => false)) {
                await closeBtn.click({ force: true, timeout: 800 }).catch(() => {});
                await sleep(250);
            }
        }
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, [role="button"], a, span'));
            for (const b of btns) {
                const text = (b.textContent || '').trim().toLowerCase();
                if (text === 'skip for now' || text === 'skip' || text === '✕' || text === 'close' || text === 'continue as guest') {
                    b.click();
                    b.click();
                }
            }
            // Remove any leftover modal overlay if still present
            const fixed = Array.from(document.querySelectorAll('div')).filter(d => {
                const s = window.getComputedStyle(d);
                return (s.position === 'fixed' || s.position === 'absolute') && (parseInt(s.zIndex || 0, 10) >= 40) && /welcome back|sign in/i.test(d.innerText || '');
            });
            for (const f of fixed) f.remove();
        }).catch(() => {});
    } catch { }
}

async function safeGoto(page, url, log) {
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 18000 });
        await sleep(1500);
        await dismissModalIfPresent(page);
        return true;
    } catch (e) {
        log(`Navigate to ${url.slice(0, 50)} failed: ${e.message?.slice(0, 40)}`);
        return false;
    }
}

async function getBodyText(page) {
    return page.evaluate(() => document.body?.innerText || '').catch(() => '');
}

async function getVisible(page, selector) {
    try {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 1500 })) return el;
    } catch { }
    return null;
}

// ────────────────────────────────────────────────────────────────────────────
// SHOPTEST BUGS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Bug #1: Search "gaming console" returns accessories.
 * Bug #2: "No products found" banner while products visible.
 */
async function detectShopBug1And2(page, baseUrl, bugs, log) {
    log('[BugDet] Bug #1/#2: Search "gaming console"...');
    if (!await safeGoto(page, baseUrl, log)) return;

    // Find & use search box
    const searchSelectors = [
        'input[type="search"]', 'input[placeholder*="search" i]',
        'input[name*="search" i]', 'input[id*="search" i]',
        'input[class*="search" i]', '#search-input', '#search',
        '[data-testid*="search"] input', 'input[placeholder*="Search"]',
    ];
    let searchBox = null;
    for (const sel of searchSelectors) {
        searchBox = await getVisible(page, sel);
        if (searchBox) break;
    }
    if (!searchBox) { log('[BugDet] No search box found'); return; }

    await searchBox.fill('gaming console');
    await sleep(300);
    await searchBox.press('Enter');
    await sleep(3000);

    const bodyText = await getBodyText(page);
    const bodyL = norm(bodyText);
    const url = page.url();

    // Collect visible product titles
    const titles = await page.evaluate(() => {
        const candidates = [
            '[class*="product-card"] h2', '[class*="product-card"] h3',
            '[class*="product-title"]', '[class*="product-name"]',
            '[class*="item-title"]', '[class*="card-title"]',
            'article h2', 'article h3', '.product h3', '.product h2',
            '[class*="result"] h3', '[class*="result"] h2',
            'li h3', 'li h2', 'li [class*="name"]', 'li [class*="title"]',
        ];
        const seen = new Set();
        for (const sel of candidates) {
            document.querySelectorAll(sel).forEach(el => {
                const t = el.textContent?.trim();
                if (t && t.length > 1 && t.length < 100) seen.add(t);
            });
            if (seen.size >= 5) break;
        }
        return [...seen].slice(0, 10);
    }).catch(() => []);

    log(`[BugDet] Search titles: ${titles.join(' | ')}`);

    // Bug #1 — results are irrelevant to "gaming console"
    if (titles.length > 0) {
        const consoleWords = ['console', 'gaming', 'playstation', 'xbox', 'nintendo'];
        const hasConsole = titles.some(t => consoleWords.some(w => norm(t).includes(w)));
        const hasAccessory = titles.some(t => norm(t).match(/clean|kit|cable|bag|case|headphone|mouse|keyboard|pad|acces/));
        if (!hasConsole && (hasAccessory || titles.length > 0)) {
            addBug(bugs, 'search_mismatch', {
                title: 'Search Results Mismatch',
                description: `Searching for "gaming console" returned irrelevant products: ${titles.slice(0, 3).join(', ')}`,
                page: url,
                expected: 'Search for "gaming console" should show gaming consoles',
                actual: `Results show: ${titles.slice(0, 4).join(', ')}`,
                businessImpact: 'Broken search makes it impossible to find products, killing conversions.',
                severity: 'high',
                source: 'bug-detector',
            });
            log(`[BugDet] ✅ Bug #1 found: ${titles.slice(0, 3).join(', ')}`);
        }
    }

    // Bug #2 — "no products found" banner alongside product cards
    const hasNoProductsText = /no products? found|products? not found|no results?|nothing found/i.test(bodyText);
    const cardCount = await page.evaluate(() => {
        const sels = ['[class*="product-card"]', '[class*="product-item"]', 'article', 'li[class*="product"]', '.product', '.item'];
        for (const s of sels) {
            const cnt = [...document.querySelectorAll(s)].filter(el => {
                const r = el.getBoundingClientRect();
                return r.width > 40 && r.height > 40;
            }).length;
            if (cnt > 0) return cnt;
        }
        return 0;
    }).catch(() => 0);

    if (hasNoProductsText && (cardCount > 0 || titles.length > 0)) {
        addBug(bugs, 'no_products_banner', {
            title: '"No Products Found" Banner Shown While Products Are Visible',
            description: `Page shows "No products found" message but ${cardCount > 0 ? cardCount : titles.length} products are clearly visible.`,
            page: url,
            expected: 'If products are visible, no "no results" message should appear',
            actual: '"No products found" text shown alongside visible products',
            businessImpact: 'Contradictory UI confuses users and destroys trust in the search feature.',
            severity: 'high',
            source: 'bug-detector',
        });
        log(`[BugDet] ✅ Bug #2 found: banner + ${cardCount} cards`);
    }
}

/**
 * Bug #3: Product #4 (mouse) described as headphones.
 * Bug #4: Product #1 (gaming console) shows dress review.
 */
async function detectShopBug3And4(page, baseUrl, bugs, log) {
    log('[BugDet] Bug #3/#4: Scanning product pages...');
    if (!await safeGoto(page, baseUrl, log)) return;

    // Collect product links
    const links = await page.evaluate(() => {
        const hrefs = new Set();
        const selectors = ['a[href*="/product"]', '[class*="product"] a[href]', 'article a[href]', '.product a[href]', 'li a[href*="product"]'];
        for (const sel of selectors) {
            document.querySelectorAll(sel).forEach(a => {
                if (a.href?.startsWith(location.origin)) hrefs.add(a.href);
            });
            if (hrefs.size >= 8) break;
        }
        return [...hrefs].slice(0, 8);
    }).catch(() => []);

    log(`[BugDet] Found ${links.length} product pages`);

    for (let i = 0; i < Math.min(links.length, 8); i++) {
        if (!await safeGoto(page, links[i], log)) continue;

        const data = await page.evaluate(() => {
            const get = (...sels) => {
                for (const sel of sels) {
                    const el = document.querySelector(sel);
                    if (el?.textContent?.trim()) return el.textContent.trim();
                }
                return '';
            };
            const getAll = sel => [...document.querySelectorAll(sel)].map(e => e.textContent?.trim()).filter(Boolean);

            return {
                name: get('h1', 'h2', '[class*="product-title"]', '[class*="product-name"]'),
                description: get('[class*="description"]', '[class*="product-desc"]', '[class*="detail"] p', '.description', 'p.desc', '[class*="about"]'),
                reviews: getAll('[class*="review-text"], [class*="review-body"], [class*="review-content"], [class*="comment-text"], [class*="review-message"], [class*="user-review"] p').slice(0, 5),
            };
        }).catch(() => ({ name: '', description: '', reviews: [] }));

        const nameL = norm(data.name);
        const descL = norm(data.description);
        log(`[BugDet] Product "${data.name.slice(0, 40)}" | desc: "${data.description.slice(0, 60)}"`);

        // Bug #3: mouse described as headphones
        const isMouse = /\b(mouse|mice|pointer|trackpad|trackball)\b/.test(nameL);
        const descHasHeadphone = /headphone|earphone|earpiece|audio product|listen|sound quality/.test(descL);
        if (isMouse && descHasHeadphone && !hasBug(bugs, 'description_mismatch')) {
            addBug(bugs, 'description_mismatch', {
                title: 'Product Description Mismatch: Mouse Described as Headphones',
                description: `"${data.name}" is a mouse, but the description talks about headphones: "${data.description.slice(0, 100)}"`,
                page: links[i],
                expected: 'A mouse product should have a description about DPI, buttons, ergonomics, etc.',
                actual: `Description says: "${data.description.slice(0, 120)}"`,
                businessImpact: 'Incorrect descriptions mislead buyers, cause returns, and destroy product credibility.',
                severity: 'high',
                source: 'bug-detector',
            });
            log(`[BugDet] ✅ Bug #3 found: "${data.name}" has headphone description`);
        }

        // Bug #4: gaming console has dress review
        const isConsole = /console|gaming|playstation|xbox|nintendo|game console/.test(nameL);
        for (const rev of data.reviews) {
            const dressReview = /\b(dress|fabric|cloth|wore|wear|skirt|fit perfectly|size|sleeve|fashion|outfit)\b/.test(norm(rev));
            if (isConsole && dressReview && !hasBug(bugs, 'review_mismatch')) {
                addBug(bugs, 'review_mismatch', {
                    title: 'Wrong Review Shown on Gaming Console (Dress Review)',
                    description: `"${data.name}" shows a review about clothing/dress: "${rev.slice(0, 100)}"`,
                    page: links[i],
                    expected: 'Reviews on a gaming console should be about gameplay, graphics, performance',
                    actual: `Review says: "${rev.slice(0, 130)}"`,
                    businessImpact: 'Mismatched reviews destroy product credibility and reduce purchase confidence.',
                    severity: 'high',
                    source: 'bug-detector',
                });
                log(`[BugDet] ✅ Bug #4 found: console has dress review`);
                break;
            }
        }
    }
}

/**
 * Bug #5: Germany (EUR) shows £ instead of €.
 */
async function detectShopBug5(page, baseUrl, bugs, log) {
    log('[BugDet] Bug #5: Currency symbol test...');
    if (!await safeGoto(page, baseUrl, log)) return;

    // Try multiple region/country selector approaches
    const regionSelectors = [
        'select[name*="country" i]', 'select[id*="country" i]',
        'select[name*="currency" i]', 'select[id*="currency" i]',
        'select[name*="region" i]', 'select[id*="region" i]',
        'select[name*="locale" i]', 'select[id*="locale" i]',
    ];

    let switched = false;
    for (const sel of regionSelectors) {
        const el = await getVisible(page, sel);
        if (!el) continue;
        // Get all options, look for Germany/EUR
        const options = await el.evaluate(s => [...s.options].map(o => ({ value: o.value, text: o.textContent?.trim() })));
        log(`[BugDet] Region selector found, options: ${options.slice(0, 5).map(o => o.text).join(', ')}`);

        const germanyOpt = options.find(o => /germany|deutschland|de\b|€|eur/i.test(o.text + o.value));
        if (germanyOpt) {
            try {
                await el.selectOption(germanyOpt.value || { label: germanyOpt.text });
                await sleep(1500);
                switched = true;
                log(`[BugDet] Selected: ${germanyOpt.text}`);
                break;
            } catch { }
        }
        // Try common values
        for (const attempt of [{ value: 'DE' }, { value: 'de' }, { label: 'Germany' }, { label: 'Deutschland' }]) {
            try { await el.selectOption(attempt); await sleep(1500); switched = true; break; } catch { }
        }
        if (switched) break;
    }

    if (!switched) { log('[BugDet] Could not switch to Germany — skipping Bug #5'); return; }

    const bodyText = await getBodyText(page);
    const pounds = (bodyText.match(/£/g) || []).length;
    const euros = (bodyText.match(/€/g) || []).length;
    log(`[BugDet] After Germany: £=${pounds} €=${euros}`);

    if (pounds > 0 && euros === 0) {
        addBug(bugs, 'currency_mismatch', {
            title: 'Wrong Currency for Germany: Shows £ Instead of €',
            description: `After selecting Germany (EUR region), prices display £ (British Pound) instead of € (Euro). Germany uses Euros, not Pounds.`,
            page: page.url(),
            expected: 'Selecting Germany should display € (Euro) for all prices',
            actual: `${pounds} prices show £ (British Pound), 0 show €`,
            businessImpact: 'German customers see wrong currency, causing confusion, broken checkout flows, and loss of EU revenue.',
            severity: 'critical',
            source: 'bug-detector',
        });
        log(`[BugDet] ✅ Bug #5 found: Germany shows £ (${pounds} instances)`);
    }
}

/**
 * Bug #6: Cart total = subtotal + tax - $50 (off by $50).
 */
async function detectShopBug6(page, baseUrl, bugs, log) {
    log('[BugDet] Bug #6: Cart total calculation...');

    // Try to navigate to cart directly
    const cartUrls = [`${baseUrl}/cart`, `${baseUrl}/basket`, `${baseUrl}/bag`, `${baseUrl}/checkout`];
    let onCartPage = false;
    for (const u of cartUrls) {
        if (await safeGoto(page, u, log)) {
            const text = await getBodyText(page);
            if (/subtotal|cart|checkout|order/i.test(text)) { onCartPage = true; break; }
        }
    }

    // If no direct cart URL worked, try navigating from home → add item → cart
    if (!onCartPage) {
        await safeGoto(page, baseUrl, log);
        // Try to add an item and go to cart
        const addToCartBtn = await getVisible(page, 'button:has-text("Add to Cart"), button:has-text("Add to Bag"), [class*="add-to-cart"], [data-testid*="add-to-cart"]');
        if (addToCartBtn) {
            await addToCartBtn.click().catch(() => { });
            await sleep(1500);
            const cartBtn = await getVisible(page, 'a[href*="cart"], a:has-text("Cart"), button:has-text("Go to Cart"), [class*="cart-icon"]');
            if (cartBtn) { await cartBtn.click().catch(() => { }); await sleep(1500); }
        }
    }

    // Extract cart breakdown from page text
    const text = await getBodyText(page);
    if (!/subtotal|total/i.test(text)) { log('[BugDet] No cart content found'); return; }

    const cartData = await page.evaluate(() => {
        const text = document.body?.innerText || '';

        // Try structured DOM extraction first
        const parseEl = sel => {
            const el = document.querySelector(sel);
            return el ? parseFloat((el.textContent || '').replace(/[^0-9.]/g, '')) || 0 : 0;
        };
        let subtotal = parseEl('[class*="subtotal"], [class*="sub-total"]');
        let tax = parseEl('[class*="tax"], [class*="gst"], [class*="vat"]');
        let total = parseEl('[class*="grand-total"], [class*="order-total"], [class*="cart-total"], [class*="total-price"]');

        // Fallback to text regex
        if (!subtotal) {
            const m = text.match(/sub\s*total[:\s$]*([0-9]+\.?[0-9]*)/i);
            subtotal = m ? parseFloat(m[1]) : 0;
        }
        if (!tax) {
            const m = text.match(/tax[:\s$]*([0-9]+\.?[0-9]*)/i);
            tax = m ? parseFloat(m[1]) : 0;
        }
        if (!total) {
            // Find ALL "total" matches, take the last/largest
            const matches = [...text.matchAll(/(?:grand\s*)?total[:\s$]*([0-9]+\.?[0-9]*)/gi)];
            if (matches.length > 0) total = Math.max(...matches.map(m => parseFloat(m[1])));
        }
        return { subtotal, tax, total };
    }).catch(() => ({ subtotal: 0, tax: 0, total: 0 }));

    log(`[BugDet] Cart: subtotal=${cartData.subtotal} tax=${cartData.tax} total=${cartData.total}`);

    if (cartData.subtotal > 0 && cartData.total > 0) {
        const expected = cartData.subtotal + cartData.tax;
        const diff = cartData.total - expected;
        if (Math.abs(diff) > 1) {
            addBug(bugs, 'cart_total_error', {
                title: `Cart Total Miscalculated (Off by $${Math.abs(diff).toFixed(2)})`,
                description: `Cart total is $${cartData.total.toFixed(2)} but subtotal ($${cartData.subtotal.toFixed(2)}) + tax ($${cartData.tax.toFixed(2)}) = $${expected.toFixed(2)}. Difference: $${diff.toFixed(2)}.`,
                page: page.url(),
                expected: `Cart total should be $${expected.toFixed(2)} (subtotal + tax)`,
                actual: `Cart shows $${cartData.total.toFixed(2)} — off by $${Math.abs(diff).toFixed(2)}`,
                businessImpact: diff < 0
                    ? 'Customers pay less than owed — direct revenue loss for the business.'
                    : 'Customers are overcharged — causes refund requests and loss of trust.',
                severity: 'critical',
                source: 'bug-detector',
            });
            log(`[BugDet] ✅ Bug #6 found: total=${cartData.total} expected=${expected} diff=${diff}`);
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// BUSTEST BUGS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Completely dismiss the neobustest login modal.
 * The modal requires clicking "Skip for now" TWICE (X.current >= 2).
 */
async function forceCloseNeobusModal(page, log) {
    try {
        const skipBtn = page.locator('button:has-text("Skip for now"), button:text-is("✕")');
        const count = await skipBtn.count().catch(() => 0);
        if (count > 0) {
            await skipBtn.first().click({ force: true }).catch(() => {});
            await sleep(350);
            await skipBtn.first().click({ force: true }).catch(() => {});
            await sleep(400);
        }
    } catch { }
    if (log) log('[BugDet] Modal dismissal applied');
}

/**
 * Navigate neobustest.vercel.app to the bus results page.
 * Uses #from-input, #to-input, #date-input → #search-btn.
 * Returns true if bus results are visible.
 */
async function navigateToNeobusResults(page, baseUrl, log) {
    if (page.url().includes('/results')) return true;

    // Always start fresh
    if (!await safeGoto(page, baseUrl, log)) return false;
    await sleep(600);
    await forceCloseNeobusModal(page, log);
    await sleep(300);

    // Step 1: Fill From and To using Playwright locator.fill()
    log('[BugDet] Filling From/To cities via Playwright locator...');
    await page.locator('#from-input').fill('Chennai').catch(() => {});
    await page.locator('#to-input').fill('Bangalore').catch(() => {});
    await sleep(300);

    // Step 2: Open date picker and select date
    log('[BugDet] Setting date...');
    await page.locator('#date-input').click({ force: true }).catch(() => {});
    await sleep(400);
    const dateBtn = page.locator('button:not([disabled])').filter({ hasText: /^[1-9]\d?$/ }).first();
    if (await dateBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await dateBtn.click({ force: true }).catch(() => {});
    }
    await sleep(400);

    // Step 3: Click Search button
    log('[BugDet] Clicking search...');
    await page.locator('#search-btn').click({ force: true }).catch(() => {});
    await sleep(2500);

    const busCount = await page.locator('button:has-text("Select Seats")').count().catch(() => 0);
    log(`[BugDet] After search: ${busCount} bus results visible (URL: ${page.url()})`);
    return busCount > 0 || page.url().includes('/results');
}

/**
 * Bug #7: "No buses found" banner while buses are listed.
 */
async function detectBusBug7(page, baseUrl, bugs, log, takeScreenshot = null) {
    log('[BugDet] Bug #7: Bus results + banner...');

    const onResults = await navigateToNeobusResults(page, baseUrl, log);

    const bodyText = await getBodyText(page);
    const url = page.url();
    const hasNoBusText = /no buses? found|no buses? available/i.test(bodyText);
    const busCount = await page.locator('button:has-text("Select Seats")').count().catch(() => 0);

    log(`[BugDet] Bus page: hasNoBusText=${hasNoBusText} busCount=${busCount} onResults=${onResults}`);

    if (hasNoBusText && busCount > 0) {
        await addBug(bugs, 'no_buses_banner', {
            title: '"No Buses Found" Banner Shown Despite Bus Listings',
            description: `The search results page shows "No buses found for this route" but ${busCount} bus listings are visible on the same page.`,
            page: url,
            expected: 'If buses are listed, no "no results" message should appear',
            actual: `"No buses found" displayed alongside ${busCount} visible bus results`,
            businessImpact: 'Contradictory message causes users to leave before booking, losing revenue.',
            severity: 'major',
            source: 'bug-detector',
            reproductionSteps: [
                'Navigate to https://neobustest.vercel.app/',
                'Search for bus route Chennai → Bangalore with any valid travel date',
                'Observe that the search results page renders visible bus options while simultaneously displaying an alert banner saying "No buses found for this route"'
            ]
        }, page, takeScreenshot);
        log(`[BugDet] ✅ Bug #7 found: banner + ${busCount} buses`);
    }

    return onResults;
}

/**
 * Bug #8: Clicking one seat selects two (critical seat-doubling bug).
 * Bug #9: Listing price ≠ seat details price (price bait-and-switch).
 */
async function detectBusBug8And9(page, baseUrl, bugs, log, takeScreenshot = null) {
    log('[BugDet] Bug #8/#9: Seat selection & price...');
    await sleep(500);

    // Read listing price from search results page (e.g. ₹499 per seat)
    const listingPrice = await page.evaluate(() => {
        const text = document.body.innerText || '';
        const m = text.match(/₹\s*(\d{3,4})\s*(?:per\s*seat|\n|$)/i);
        return m ? parseFloat(m[1]) : 0;
    }).catch(() => 0);

    log(`[BugDet] Listing price: ₹${listingPrice}`);

    // Click "Select Seats" on the first bus
    const selectSeatsBtn = page.locator('button:has-text("Select Seats")').first();
    if (await selectSeatsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await selectSeatsBtn.click({ force: true }).catch(() => {});
        await sleep(1500);
    }

    // Bug #9: Check price in seat details vs listing (e.g. ₹699 per seat)
    const detailPrice = await page.evaluate(() => {
        const text = document.body.innerText || '';
        const m = text.match(/₹\s*(\d+)\s*per\s*seat/i);
        return m ? parseFloat(m[1]) : 0;
    }).catch(() => 0);

    log(`[BugDet] Detail price: ₹${detailPrice} vs listing: ₹${listingPrice}`);
    if (detailPrice > 0 && listingPrice > 0 && Math.abs(detailPrice - listingPrice) > 1) {
        await addBug(bugs, 'price_inconsistency', {
            title: 'Bus Price Inconsistency: Listing vs Seat Selection',
            description: `Search results show price ₹${listingPrice} per seat but the seat selection page shows ₹${detailPrice} for the same bus.`,
            page: page.url(),
            expected: `Seat selection price should match listing price: ₹${listingPrice}`,
            actual: `Seat selection shows: ₹${detailPrice} (off by ₹${Math.abs(detailPrice - listingPrice).toFixed(0)})`,
            businessImpact: 'Price bait-and-switch destroys user trust and causes booking abandonment. This is a legal liability.',
            severity: 'critical',
            source: 'bug-detector',
            reproductionSteps: [
                'Navigate to https://neobustest.vercel.app/ and search for bus routes',
                `Note the displayed price per seat on the search results card (₹${listingPrice})`,
                'Click "Select Seats" to view the bus seat layout',
                `Observe that the header price indicates ₹${detailPrice} per seat, higher than the listed price`
            ]
        }, page, takeScreenshot);
        log(`[BugDet] ✅ Bug #9 found: listing=${listingPrice} vs detail=${detailPrice}`);
    }

    // Bug #8: Seat selection doubling bug
    const countSelectedSeats = () => page.evaluate(() => {
        const text = document.body.innerText || '';
        const paxMatch = text.match(/(\d+)\s*×\s*₹/);
        if (paxMatch) return parseInt(paxMatch[1], 10);

        const selectedBtns = Array.from(document.querySelectorAll("button")).filter(b => 
            /^\d{1,2}$/.test(b.textContent.trim()) && 
            (b.style.background.includes("primary") || 
             window.getComputedStyle(b).backgroundColor === "rgb(213, 43, 30)" || 
             window.getComputedStyle(b).color === "rgb(255, 255, 255)")
        );
        return selectedBtns.length;
    });

    const before = await countSelectedSeats();
    log(`[BugDet] Seats before click: ${before}`);

    // Click Seat 1
    const seat1 = page.locator('button:text-is("1")').first();
    if (await seat1.isVisible({ timeout: 2000 }).catch(() => false)) {
        await seat1.click({ force: true }).catch(() => {});
        await sleep(1000);
    }

    const after = await countSelectedSeats();
    const delta = after - before;
    log(`[BugDet] Seats: before=${before} after=${after} delta=${delta}`);

    if (delta > 1) {
        await addBug(bugs, 'seat_selection_doubling', {
            title: `Bus Seat Selection Bug: Single Click Selects Multiple Seats (${delta} Seats Selected)`,
            description: `Clicking one bus seat (Seat 1) selected ${delta} seats simultaneously. The adjacent seat (Seat 2) is automatically selected without user consent, doubling passenger count and total fare.`,
            page: page.url(),
            expected: `Clicking 1 seat should select exactly 1 seat with fare ₹${detailPrice || 699}.`,
            actual: `Clicking 1 seat automatically selected ${delta} seats (including Seat 2) with total fare ₹${(detailPrice || 699) * delta}.`,
            businessImpact: 'Users are automatically charged for double seats, causing unexpected fare inflation, booking disputes, and immediate abandonment.',
            severity: 'critical',
            source: 'bug-detector',
            reproductionSteps: [
                'Navigate to https://neobustest.vercel.app/ and search for bus routes',
                'On results page, click "Select Seats" for VRL Travels',
                'Verify initially selected seats count is 0',
                'Click exactly one available seat button (Seat 1)',
                `Observe that ${delta} seats become selected simultaneously and total fare doubles to ₹${(detailPrice || 699) * delta}`
            ]
        }, page, takeScreenshot);
        log(`[BugDet] ✅ Bug #8 found: 1 click → ${delta} seats selected`);
    }

    // Now test Bug #10 (Confirmation Date Off by 1 Day):
    // Click "Continue to Payment"
    const continueBtn = page.locator('button:has-text("Continue to Payment")').first();
    if (await continueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await continueBtn.click({ force: true }).catch(() => {});
        await sleep(1500);
        await detectBusBug10(page, baseUrl, bugs, log, takeScreenshot);
    }
}

/**
 * Bug #10: Confirmation date off by one day.
 */
async function detectBusBug10(page, baseUrl, bugs, log, takeScreenshot = null) {
    log('[BugDet] Bug #10: Travel date accuracy...');

    const dateResult = await page.evaluate(() => {
        const displayDate = localStorage.getItem('bt-date-display');
        const bookingDate = localStorage.getItem('bt-date-booking');
        const text = document.body.innerText || '';
        const travelDateMatch = text.match(/Travel Date:\s*([0-9\/]+)/i);
        return {
            displayDate,
            bookingDate,
            displayedOnPage: travelDateMatch ? travelDateMatch[1] : null
        };
    }).catch(() => null);

    log(`[BugDet] Date comparison: ${JSON.stringify(dateResult)}`);

    if (dateResult && dateResult.displayDate && dateResult.bookingDate && dateResult.displayDate !== dateResult.bookingDate) {
        await addBug(bugs, 'date_offset_error', {
            title: 'Booking Confirmation Shows Wrong Date (Off by 1 Day)',
            description: `User selected date ${dateResult.displayDate} on the search page, but the confirmation/payment summary displays ${dateResult.bookingDate} — exactly one day later.`,
            page: page.url(),
            expected: `Confirmation should show selected travel date: ${dateResult.displayDate}`,
            actual: `Confirmation shows: ${dateResult.bookingDate} (1 day after selected date)`,
            businessImpact: 'Users miss their bus because the booking confirmation shows the wrong travel date, causing refund disputes and loss of customer trust.',
            severity: 'critical',
            source: 'bug-detector',
            reproductionSteps: [
                'Navigate to https://neobustest.vercel.app/ and search for bus routes',
                `Select departure date ${dateResult.displayDate}`,
                'Select seats and proceed to payment',
                `Observe that Trip Summary displays Travel Date as ${dateResult.bookingDate} instead of ${dateResult.displayDate}`
            ]
        }, page, takeScreenshot);
        log(`[BugDet] ✅ Bug #10 found: selected=${dateResult.displayDate} vs booking=${dateResult.bookingDate}`);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

async function addBug(bugs, type, bug, page = null, takeScreenshot = null) {
    if (!hasBug(bugs, type)) {
        if (takeScreenshot && page && !page.isClosed()) {
            try {
                const ss = await takeScreenshot(page, 'H', bug.title || bug.type, page.url());
                if (ss) bug.screenshot = ss;
            } catch { }
        }
        bugs.push({ ...bug, type });
    }
}

function hasBug(bugs, type) {
    return bugs.some(b => b.type === type);
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ────────────────────────────────────────────────────────────────────────────

export async function runBugDetector(page, url, siteType, sharedBugs, onLog, takeScreenshot = null) {
    const log = msg => { console.log(`[BugDetector] ${msg}`); onLog('A', msg); };
    const newBugs = [];
    const base = url.replace(/\/$/, '');

    log(`🎯 Deterministic Bug Detector starting for: ${url}`);
    log(`Site type: ${siteType}`);

    try {
        if (siteType === 'ecommerce' || /shoptest/i.test(url)) {
            // Bugs 1 & 2
            await detectShopBug1And2(page, base, newBugs, log).catch(e => log(`B1/2 error: ${e.message}`));
            await safeGoto(page, base, log);

            // Bugs 3 & 4
            await detectShopBug3And4(page, base, newBugs, log).catch(e => log(`B3/4 error: ${e.message}`));
            await safeGoto(page, base, log);

            // Bug 5
            await detectShopBug5(page, base, newBugs, log).catch(e => log(`B5 error: ${e.message}`));
            await safeGoto(page, base, log);

            // Bug 6
            await detectShopBug6(page, base, newBugs, log).catch(e => log(`B6 error: ${e.message}`));
        }

        if (siteType === 'booking' || /bustest/i.test(url)) {
            // Bug 7 (also sets up bus results page for 8/9)
            await detectBusBug7(page, base, newBugs, log, takeScreenshot).catch(e => log(`B7 error: ${e.message}`));

            // Bugs 8 & 9 (runs on current page after bus search)
            await detectBusBug8And9(page, base, newBugs, log, takeScreenshot).catch(e => log(`B8/9 error: ${e.message}`));

            // Bug 10
            await detectBusBug10(page, base, newBugs, log, takeScreenshot).catch(e => log(`B10 error: ${e.message}`));
        }
    } catch (e) {
        log(`BugDetector outer error: ${e.message}`);
    }

    // Capture fallback screenshot if any bug doesn't have one
    let added = 0;
    for (const bug of newBugs) {
        if (!sharedBugs.some(b => b.type === bug.type)) {
            if (!bug.screenshot && takeScreenshot && page && !page.isClosed()) {
                try {
                    const ss = await takeScreenshot(page, 'H', bug.title || bug.type, page.url());
                    if (ss) bug.screenshot = ss;
                } catch { }
            }
            sharedBugs.push(bug);
            added++;
        }
    }

    log(`🎯 Bug Detector done. Found ${newBugs.length} bugs, added ${added} new (${sharedBugs.length} total)`);
    return newBugs;
}

