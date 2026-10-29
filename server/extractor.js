/**
 * extractor.js — Rich page snapshot with stable selectors (v2)
 *
 * Returns:
 *  - url, title, headings (h1-h3 text)
 *  - fullText: first 2000 chars of visible page text
 *  - elements[]: up to 80 interactive elements with stable CSS selectors
 *  - numbered: compact text list of elements for AI prompts
 *  - prices[]: all currency values found on the page
 *  - cartTotal: detected "total" line with price (if any)
 *  - currency: first currency symbol detected
 */

export async function extractPageState(page) {
    try {
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => { });
        await page.waitForSelector('button, a[href], input:not([type=hidden]), textarea, select, [role="button"]', { timeout: 3000 }).catch(() => { });
        // Step 1: Stamp interactive elements with stable indices + generate selectors
        await page.evaluate(() => {
            // Clean previous stamps
            document.querySelectorAll('[data-sentra-idx]')
                .forEach(el => el.removeAttribute('data-sentra-idx'));

            function isVisible(el) {
                const r = el.getBoundingClientRect();
                const s = window.getComputedStyle(el);
                return r.width > 0 && r.height > 0 &&
                    s.display !== 'none' && s.visibility !== 'hidden' &&
                    parseFloat(s.opacity) > 0 && r.top < window.innerHeight + 1200;
            }

            function getLabel(el) {
                const rawVal = (el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(el.type)) ? el.value : '';
                return (
                    el.getAttribute('aria-label')?.trim() ||
                    rawVal?.trim() ||
                    el.getAttribute('value')?.trim() ||
                    el.getAttribute('placeholder')?.trim() ||
                    el.getAttribute('title')?.trim() ||
                    (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent.trim()) ||
                    el.closest('label')?.textContent.trim() ||
                    el.textContent.trim().replace(/\s+/g, ' ').slice(0, 50) || ''
                ).slice(0, 50);
            }

            function getSection(el) {
                let node = el.parentElement;
                for (let i = 0; i < 8 && node && node !== document.body; i++) {
                    // Check for modal/dialog containers
                    if (node.getAttribute('role') === 'dialog' ||
                        node.getAttribute('role') === 'alertdialog' ||
                        (node.className && typeof node.className === 'string' &&
                            (node.className.includes('modal') || node.className.includes('dialog') || node.className.includes('popup')))) {
                        return 'Modal';
                    }
                    const h = node.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > legend');
                    if (h) return h.textContent.trim().slice(0, 40);
                    if (node.tagName === 'FORM') return 'Form';
                    if (node.tagName === 'NAV') return 'Navigation';
                    if (node.tagName === 'HEADER') return 'Header';
                    if (node.tagName === 'FOOTER') return 'Footer';
                    node = node.parentElement;
                }
                return '';
            }

            // Build a stable CSS selector for an element (inside browser context)
            function buildSelector(el) {
                // 1. data-testid
                const testId = el.getAttribute('data-testid');
                if (testId) return `[data-testid="${testId}"]`;

                // 2. id (skip dynamic-looking IDs)
                if (el.id && !/^\d|^:/.test(el.id) && el.id.length < 60) {
                    return `#${CSS.escape(el.id)}`;
                }

                // 3. name attribute
                const name = el.getAttribute('name');
                if (name) {
                    const tag = el.tagName.toLowerCase();
                    const matches = document.querySelectorAll(`${tag}[name="${name}"]`);
                    if (matches.length === 1) return `${tag}[name="${name}"]`;
                }

                // 4. aria-label
                const ariaLabel = el.getAttribute('aria-label');
                if (ariaLabel && ariaLabel.length < 60) {
                    const tag = el.tagName.toLowerCase();
                    const matches = document.querySelectorAll(`${tag}[aria-label="${ariaLabel}"]`);
                    if (matches.length === 1) return `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;
                }

                // 5. Fallback: data-sentra-idx (always works since we stamp it)
                return null; // will use data-sentra-idx
            }

            const TYPEABLE = new Set(['input', 'textarea', 'select']);
            const seen = new Set();
            const chosen = [];

            document.querySelectorAll([
                'input:not([type=hidden])',
                'textarea',
                'select',
                'button',
                'a[href]',
                '[role="button"]',
                '[role="option"]',
                '[role="tab"]',
                '[role="menuitem"]',
            ].join(',')).forEach(el => {
                if (!isVisible(el)) return;
                if (el.disabled && el.tagName !== 'A') return; // skip disabled except links

                const tag = el.tagName.toLowerCase();
                const label = getLabel(el);
                if (tag === 'a' && label.length < 2) return;

                const section = getSection(el);
                const isDisabled = el.disabled || el.hasAttribute('disabled');
                const isReadonly = el.hasAttribute('readonly');
                const inputType = (el.getAttribute('type') || '').toLowerCase();
                const isClickableInput = tag === 'input' && ['submit', 'button', 'reset', 'checkbox', 'radio', 'image'].includes(inputType);
                const kind = (TYPEABLE.has(tag) && tag !== 'select' && !isReadonly && !isClickableInput) ? 'TYPEABLE'
                    : tag === 'select' ? 'SELECT' : 'CLICKABLE';

                // Scoring for priority selection
                let score = (tag === 'input' && !isClickableInput) || tag === 'textarea' ? 100
                    : tag === 'select' ? 90
                    : tag === 'button' || el.getAttribute('role') === 'button' || isClickableInput ? 75
                    : tag === 'a' ? 25 : 10;

                // High-value action buttons (Cart, Checkout, Buy, Seat, Search, Pay, Continue, Login)
                if (/cart|checkout|buy\s*now|add\s*to|seat|proceed|continue|search|deliver|pay|sign\s*in|login/i.test(label + ' ' + (el.id || '') + ' ' + (el.className || ''))) {
                    score += 65;
                }
                if (/^\d+$/.test(label.trim())) score += 40; // calendar day numbers / seat numbers
                if (label) score += 10;
                if (isDisabled || isReadonly) score -= 30;

                const key = `${section}:${tag}:${label.slice(0, 30)}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    chosen.push({
                        el, score, tag, label, section, isDisabled, isReadonly,
                        inputType, kind
                    });
                }
            });

            // Sort by priority and take top 80
            chosen.sort((a, b) => b.score - a.score)
                .slice(0, 80)
                .forEach((c, i) => {
                    c.el.setAttribute('data-sentra-idx', String(i));
                });
        });

        // Step 2: Read back metadata + full page text + prices + cart info
        return await page.evaluate(() => {
            function getLabel(el) {
                const rawVal = (el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(el.type)) ? el.value : '';
                return (
                    el.getAttribute('aria-label')?.trim() ||
                    rawVal?.trim() ||
                    el.getAttribute('value')?.trim() ||
                    el.getAttribute('placeholder')?.trim() ||
                    el.getAttribute('title')?.trim() ||
                    (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent.trim()) ||
                    el.closest('label')?.textContent.trim() ||
                    el.textContent.trim().replace(/\s+/g, ' ').slice(0, 50) || ''
                ).slice(0, 50);
            }

            function getSection(el) {
                let node = el.parentElement;
                for (let i = 0; i < 8 && node && node !== document.body; i++) {
                    if (node.getAttribute('role') === 'dialog' ||
                        node.getAttribute('role') === 'alertdialog' ||
                        (node.className && typeof node.className === 'string' &&
                            (node.className.includes('modal') || node.className.includes('dialog') || node.className.includes('popup')))) {
                        return 'Modal';
                    }
                    const h = node.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > legend');
                    if (h) return h.textContent.trim().slice(0, 40);
                    if (node.tagName === 'FORM') return 'Form';
                    if (node.tagName === 'NAV') return 'Navigation';
                    if (node.tagName === 'HEADER') return 'Header';
                    if (node.tagName === 'FOOTER') return 'Footer';
                    node = node.parentElement;
                }
                return '';
            }

            function buildSelector(el) {
                const testId = el.getAttribute('data-testid');
                if (testId) return `[data-testid="${testId}"]`;
                if (el.id && !/^\d|^:/.test(el.id) && el.id.length < 60) {
                    return `#${CSS.escape(el.id)}`;
                }
                const name = el.getAttribute('name');
                if (name) {
                    const tag = el.tagName.toLowerCase();
                    const matches = document.querySelectorAll(`${tag}[name="${name}"]`);
                    if (matches.length === 1) return `${tag}[name="${name}"]`;
                }
                const ariaLabel = el.getAttribute('aria-label');
                if (ariaLabel && ariaLabel.length < 60) {
                    const tag = el.tagName.toLowerCase();
                    try {
                        const matches = document.querySelectorAll(`${tag}[aria-label="${CSS.escape(ariaLabel)}"]`);
                        if (matches.length === 1) return `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;
                    } catch { }
                }
                return null;
            }

            const TYPEABLE = new Set(['input', 'textarea']);
            const elements = [];
            let maxIdx = -1;

            document.querySelectorAll('[data-sentra-idx]').forEach(el => {
                const i = parseInt(el.getAttribute('data-sentra-idx'));
                if (i > maxIdx) maxIdx = i;
            });

            for (let i = 0; i <= maxIdx; i++) {
                const el = document.querySelector(`[data-sentra-idx="${i}"]`);
                if (!el) { elements.push(null); continue; }
                const tag = el.tagName.toLowerCase();
                const label = getLabel(el);
                const section = getSection(el);
                const val = (el.value || '').slice(0, 60);
                const isDisabled = el.disabled || el.hasAttribute('disabled');
                const isReadonly = el.hasAttribute('readonly');
                const inputType = (el.getAttribute('type') || '').toLowerCase();
                const isClickableInput = tag === 'input' && ['submit', 'button', 'reset', 'checkbox', 'radio', 'image'].includes(inputType);
                const kind = (TYPEABLE.has(tag) && !isReadonly && !isClickableInput) ? 'TYPEABLE'
                    : tag === 'select' ? 'SELECT' : 'CLICKABLE';
                const stableSelector = buildSelector(el);

                elements.push({
                    idx: i, tag, inputType, label, section, val, kind,
                    disabled: isDisabled, readonly: isReadonly,
                    selector: stableSelector || `[data-sentra-idx="${i}"]`,
                });
            }

            // Build compact numbered list grouped by section (for AI prompt)
            const secMap = new Map();
            elements.forEach((e, i) => {
                if (!e) return;
                const s = e.section || 'Page';
                if (!secMap.has(s)) secMap.set(s, []);
                secMap.get(s).push({ ...e, i });
            });
            let numbered = '';
            for (const [sec, els] of secMap.entries()) {
                if (secMap.size > 1) numbered += `\n[${sec}]\n`;
                els.forEach(e => {
                    let line = `  [${e.i}] [${e.kind}] ${e.tag.toUpperCase()}`;
                    if (e.inputType && !['text', 'button', 'submit', '', 'password', 'email', 'tel', 'number'].includes(e.inputType))
                        line += `[${e.inputType}]`;
                    if (e.readonly) line += '[readonly]';
                    if (e.disabled) line += '[disabled]';
                    if (e.label) line += ` "${e.label}"`;
                    if (e.val) line += ` (value: "${e.val}")`;
                    numbered += line + '\n';
                });
            }

            // Full visible page text
            const fullText = document.body.innerText
                .replace(/\s*\n\s*/g, '\n')
                .replace(/[ \t]{2,}/g, ' ')
                .trim()
                .slice(0, 2000);

            // Extract all currency values (prices) from the page text
            const priceRegex = /(?:₹|Rs\.?|\$|€|£)\s*[\d,]+(?:\.\d{1,2})?/g;
            const priceMatches = fullText.match(priceRegex) || [];
            const prices = [...new Set(priceMatches)].slice(0, 20);

            // Detect cart total — look for line containing "total" and a price
            let cartTotal = null;
            const lines = fullText.split('\n');
            for (const line of lines) {
                if (/total/i.test(line) && priceRegex.test(line)) {
                    const match = line.match(priceRegex);
                    if (match) { cartTotal = match[0]; break; }
                }
            }

            // First currency symbol detected
            const currencyMatch = fullText.match(/₹|Rs\.?|\$|€|£/);
            const currency = currencyMatch ? currencyMatch[0] : null;

            // Headings (h1-h3)
            const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
                .filter(h => { const r = h.getBoundingClientRect(); return r.width > 0 && r.top < innerHeight + 400; })
                .map(h => h.textContent.trim().slice(0, 80))
                .filter(t => t.length > 1).slice(0, 6).join(' | ');

            // ── NEW: Search result titles (for Bug #1) — BROAD selectors ──────
            const searchResultTitles = (() => {
                const items = new Set();
                // Ordered from most specific to most generic
                const selectors = [
                    '[class*="product-card"] h2', '[class*="product-card"] h3',
                    '[class*="product-card"] [class*="title"]', '[class*="product-card"] [class*="name"]',
                    '[class*="product-title"]', '[class*="product-name"]',
                    '[class*="item-title"]', '[class*="item-name"]',
                    '[class*="card-title"]', '[class*="card-name"]',
                    '[class*="result"] h2', '[class*="result"] h3',
                    '[class*="result"] [class*="title"]',
                    'article h2', 'article h3', 'article [class*="title"]',
                    'li[class*="product"] h2', 'li[class*="product"] h3',
                    'li[class*="item"] h2', 'li[class*="item"] h3',
                    '[class*="bus-name"]', '[class*="operator-name"]', '[class*="bus-title"]',
                    '.product h3', '.product h2', '.item h3', '.item h2',
                ];
                for (const sel of selectors) {
                    try {
                        const els = document.querySelectorAll(sel);
                        for (const el of els) {
                            const r = el.getBoundingClientRect();
                            if (r.width > 0 && r.height > 0 && r.top < window.innerHeight + 800) {
                                const t = el.textContent?.trim();
                                if (t && t.length > 1 && t.length < 120) items.add(t);
                            }
                        }
                    } catch { }
                    if (items.size >= 15) break;
                }
                return [...items].slice(0, 20);
            })();

            // ── NEW: Product cards count (wider check for banner/card contradiction) ──
            const visibleCardCount = (() => {
                const cardSels = [
                    '[class*="product-card"]', '[class*="product-item"]',
                    '[class*="card"][class*="product"]', '[class*="bus-card"]',
                    '[class*="result-card"]', '[class*="item-card"]',
                    'article.product', 'li.product', 'li.item',
                    '.product', '.item', 'article',
                ];
                for (const sel of cardSels) {
                    const els = document.querySelectorAll(sel);
                    let cnt = 0;
                    for (const el of els) {
                        const r = el.getBoundingClientRect();
                        if (r.width > 40 && r.height > 40) cnt++;
                    }
                    if (cnt > 0) return cnt;
                }
                return searchResultTitles.length; // fallback
            })();

            // ── NEW: Contradictory banner detection (for Bugs #2, #7) ──────────
            const noResultPatterns = [/no products? found/i, /no items? found/i, /no results? found/i, /no buses? found/i, /no buses? available/i, /0 products?/i, /products? not found/i];
            const allTextEls = document.querySelectorAll('p, span, div, h2, h3, h4, [class*="message"], [class*="alert"], [class*="notice"]');
            let contradictoryBanner = false;
            let contradictoryBannerText = '';
            for (const el of allTextEls) {
                const s = window.getComputedStyle(el);
                const r = el.getBoundingClientRect();
                if (s.display === 'none' || s.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;
                const text = (el.textContent?.trim() || '');
                // Must be leaf-ish text (not a container with tons of children)
                if (text.length < 3 || text.length > 200) continue;
                const childText = [...el.children].reduce((acc, c) => acc + (c.textContent?.length || 0), 0);
                if (childText > text.length * 0.8) continue; // skip containers
                const hasPattern = noResultPatterns.some(p => p.test(text));
                if (hasPattern && visibleCardCount > 0) {
                    contradictoryBanner = true;
                    contradictoryBannerText = text.slice(0, 100);
                    break;
                }
            }

            // ── NEW: Cart breakdown (for Bug #6 cart total miscalculation) ──
            let cartBreakdown = null;
            try {
                const subtotalEl = document.querySelector('[class*="subtotal"], [class*="sub-total"]');
                const taxEl = document.querySelector('[class*="tax"], [class*="gst"]');
                const totalEl = document.querySelector('[class*="grand-total"], [class*="order-total"], [class*="cart-total"]');
                if (subtotalEl && totalEl) {
                    const parseAmt = el => parseFloat((el?.textContent || '').replace(/[^0-9.]/g, '')) || 0;
                    cartBreakdown = {
                        subtotal: parseAmt(subtotalEl),
                        tax: parseAmt(taxEl),
                        total: parseAmt(totalEl),
                    };
                }
            } catch { }

            // ── Selected seat detection (supports CSS classes, inline styles, and summary text) ──
            const seatState = (() => {
                const selectedList = [];

                // 1. Scan seat buttons in seat maps/grids
                const seatButtons = Array.from(document.querySelectorAll('button, [role="button"], div[class*="seat"], [data-seat]')).filter(e => {
                    const text = e.innerText?.trim();
                    return /^\d{1,2}$/.test(text) && e.offsetWidth > 0 && e.offsetHeight > 0;
                });

                seatButtons.forEach(btn => {
                    const text = btn.innerText?.trim();
                    const cls = (btn.className || '').toLowerCase();
                    const style = btn.getAttribute('style') || '';
                    const color = window.getComputedStyle(btn).color;
                    const bg = window.getComputedStyle(btn).backgroundColor;

                    const isSelectedClass = cls.includes('selected') || cls.includes('active') ||
                        btn.getAttribute('data-selected') === 'true' || btn.getAttribute('aria-selected') === 'true';
                    const isWhiteText = (color === 'rgb(255, 255, 255)' || color === 'white') && !btn.disabled;
                    const isPrimaryBg = style.includes('var(--primary)') || cls.includes('primary') || bg.includes('124, 58, 237') || bg.includes('99, 102, 241');

                    if (isSelectedClass || isWhiteText || isPrimaryBg) {
                        selectedList.push(text);
                    }
                });

                // 2. Scan Booking Summary text (e.g. "Seats\n1, 2" or "Seats: 1, 2")
                const fullPageText = document.body.innerText || '';
                const summaryMatch = fullPageText.match(/Seats?\s*[:\n]\s*([0-9,\s]+)/i);
                if (summaryMatch) {
                    const parsed = summaryMatch[1].split(',').map(s => s.trim()).filter(s => /^\d{1,2}$/.test(s));
                    parsed.forEach(s => selectedList.push(s));
                }

                // 3. Scan seat count text like "2 × ₹699" or "2 seats selected"
                const countMatch = fullPageText.match(/(\d+)\s*×\s*(?:₹|Rs\.?|\$)\s*\d+/i) || fullPageText.match(/(\d+)\s*seats?\s*selected/i);
                const summaryCount = countMatch ? parseInt(countMatch[1], 10) : 0;

                const uniqueSeats = [...new Set(selectedList)].sort((a, b) => Number(a) - Number(b));
                const finalCount = Math.max(uniqueSeats.length, summaryCount);

                return {
                    seats: uniqueSeats,
                    count: finalCount,
                };
            })();
            const selectedSeatCount = seatState.count;
            const selectedSeats = seatState.seats;

            // ── NEW: Selected date (for Bug #10 date off by one) ──
            let selectedDate = null;
            try {
                const dateInputs = document.querySelectorAll('input[type="date"], input[name*="date" i], [class*="date-picker"] input, [class*="datepicker"] input');
                for (const di of dateInputs) {
                    if (di.value) { selectedDate = di.value; break; }
                }
                if (!selectedDate) {
                    // Try to find selected date in calendar or text
                    const dateEl = document.querySelector('[class*="selected-date"], [class*="chosen-date"], [aria-selected="true"]');
                    if (dateEl) selectedDate = dateEl.textContent?.trim();
                }
            } catch { }

            // ── NEW: Cart quantities (for quantity doubling bug) ──────────────
            const cartQuantities = (() => {
                const quantities = [];
                // Look for quantity inputs in cart
                document.querySelectorAll('[class*="quantity"] input, [class*="qty"] input, input[name*="quantity" i], input[name*="qty" i], .cart-item input[type="number"]').forEach(el => {
                    const val = parseInt(el.value);
                    if (!isNaN(val) && val > 0) quantities.push(val);
                });
                // Look for quantity text like "×2", "Qty: 2", "x 2"
                if (quantities.length === 0) {
                    const text = document.body?.innerText || '';
                    const qtyPatterns = text.match(/(?:×|x|qty[:\s]*|quantity[:\s]*)(\d+)/gi);
                    if (qtyPatterns) {
                        qtyPatterns.forEach(m => {
                            const q = parseInt(m.replace(/[^\d]/g, ''));
                            if (!isNaN(q) && q > 0 && q < 100) quantities.push(q);
                        });
                    }
                }
                // Look for quantity display elements
                if (quantities.length === 0) {
                    document.querySelectorAll('[class*="quantity"], [class*="qty"], [class*="count"]').forEach(el => {
                        const text = el.textContent?.trim();
                        const n = parseInt(text);
                        if (!isNaN(n) && n > 0 && n < 100 && text.length < 5) quantities.push(n);
                    });
                }
                return quantities;
            })();

            // Count cart items
            const cartItemCount = (() => {
                const cartSelectors = [
                    '[class*="cart-item"]', '[class*="cart_item"]',
                    '[class*="basket-item"]', '[class*="line-item"]',
                    'tr[class*="item"]', '.cart .item', '.cart-items > *',
                ];
                for (const sel of cartSelectors) {
                    try {
                        const els = document.querySelectorAll(sel);
                        let cnt = 0;
                        for (const el of els) {
                            const r = el.getBoundingClientRect();
                            if (r.width > 20 && r.height > 20) cnt++;
                        }
                        if (cnt > 0) return cnt;
                    } catch { }
                }
                return 0;
            })();

            // Header/nav cart badge count (works on any page before entering /cart)
            const cartBadgeCount = (() => {
                const badgeSelectors = [
                    '#nav-cart-count', '[id*="cart-count"]', '[id*="cart_count"]',
                    '[class*="cart-count"]', '[class*="cart_count"]', '[class*="cartCount"]',
                    '[data-cart-count]', '[class*="cart-badge"]', '[class*="cart-quantity"]',
                    '.cart-icon span', 'a[href*="cart"] [class*="count"]', 'a[href*="cart"] [class*="badge"]',
                    'button[class*="cart"] [class*="count"]', 'button[class*="cart"] [class*="badge"]',
                ];
                for (const sel of badgeSelectors) {
                    try {
                        const el = document.querySelector(sel);
                        if (el) {
                            const txt = (el.textContent || '').trim();
                            const m = txt.match(/\d+/);
                            if (m) return parseInt(m[0], 10);
                        }
                    } catch {}
                }
                return null;
            })();

            const buttons = [];
            document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach(el => {
                const rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;
                buttons.push({ text: (el.textContent || el.value || '').trim().slice(0, 40) });
            });

            const links = [];
            document.querySelectorAll('a[href]').forEach(a => {
                const href = a.href || '';
                if (!href || href.startsWith('javascript:')) return;
                links.push({ text: (a.textContent || '').trim().slice(0, 40), href });
            });

            const nav_items = [];
            document.querySelectorAll('nav a[href]').forEach(a => {
                nav_items.push({ text: (a.textContent || '').trim().slice(0, 30), href: a.href });
            });

            const inputs = [];
            document.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach(el => {
                inputs.push({
                    type: (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase(),
                    name: el.getAttribute('name') || '',
                    required: el.hasAttribute('required'),
                });
            });

            const forms_count = document.querySelectorAll('form').length;

            return {
                url: location.href,
                title: document.title.slice(0, 80),
                headings,
                fullText,
                prices,
                cartTotal,
                currency,
                elements: elements.filter(Boolean),
                numbered: numbered.trim(),
                elementCount: elements.filter(Boolean).length,
                buttons,
                links,
                nav_items,
                inputs,
                forms_count,
                // New multi-agent fields
                searchResultTitles,
                visibleCardCount,
                contradictoryBanner,
                contradictoryBannerText,
                cartBreakdown,
                selectedSeatCount,
                selectedSeats,
                selectedDate,
                cartQuantities,
                cartItemCount,
                cartBadgeCount,
            };
        });
    } catch (e) {
        console.error('[extractor] error:', e.message);
        return {
            url: '', title: '', headings: '', fullText: '', prices: [],
            cartTotal: null, currency: null,
            elements: [], numbered: '', elementCount: 0,
            buttons: [], links: [], nav_items: [], inputs: [], forms_count: 0,
            cartBadgeCount: null, cartItemCount: 0,
        };
    }
}
