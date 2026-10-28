import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const arrowCursorB64 = readFileSync(join(__dirname, 'cursors', 'mac-cursor-6.png')).toString('base64');
const handCursorB64 = readFileSync(join(__dirname, 'cursors', 'pointinghand.png')).toString('base64');

// Inject cursor HTML into the page
async function injectCursorDOM(page) {
    await page.evaluate(({ arrow, hand }) => {
        // Remove stale cursors
        document.getElementById('sentra-cursor')?.remove();
        document.getElementById('sentra-ripple')?.remove();

        const cursor = document.createElement('img');
        cursor.id = 'sentra-cursor';
        cursor.src = `data:image/png;base64,${arrow}`;
        cursor.dataset.arrow = `data:image/png;base64,${arrow}`;
        cursor.dataset.hand = `data:image/png;base64,${hand}`;
        cursor.style.cssText = `
            position: fixed !important;
            top: 100px; left: 100px;
            width: 32px; height: 32px;
            z-index: 2147483647 !important;
            pointer-events: none !important;
            transform: translate(-5px, -2px);
            transition: left 0.12s ease-out, top 0.12s ease-out;
            filter: drop-shadow(1px 2px 3px rgba(0,0,0,0.35));
            opacity: 1 !important;
        `;
        document.body.appendChild(cursor);

        const ripple = document.createElement('div');
        ripple.id = 'sentra-ripple';
        ripple.style.cssText = `
            position: fixed !important;
            width: 28px; height: 28px;
            border-radius: 50%;
            background: rgba(124, 58, 237, 0.25);
            border: 2px solid rgba(124, 58, 237, 0.6);
            z-index: 2147483646 !important;
            pointer-events: none !important;
            opacity: 0;
            transform: scale(0);
            transition: transform 0.25s ease-out, opacity 0.25s ease-out;
        `;
        document.body.appendChild(ripple);
    }, { arrow: arrowCursorB64, hand: handCursorB64 });
}

/**
/**
 * Init cursor AND register navigation listeners so it re-injects
 * on every navigation automatically. This is the fix for cursor disappearing.
 */
export async function initCursor(page) {
    try {
        await injectCursorDOM(page);

        const safeReinject = async () => {
            try {
                await page.waitForTimeout(200);
                await injectCursorDOM(page);
            } catch { }
        };

        page.on('load', safeReinject);
        page.on('domcontentloaded', safeReinject);
        page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame()) safeReinject();
        });
    } catch { }
}

/**
 * Re-inject cursor (call this after navigate action in worker).
 */
export async function reinitCursor(page) {
    try {
        await page.waitForTimeout(300);
        await injectCursorDOM(page);
    } catch { }
}

/**
 * Move cursor overlay to VIEWPORT-relative x,y.
 * Uses getBoundingClientRect (not boundingBox) to avoid scroll jitter.
 * Self-heals if the cursor DOM element was cleared by SPA re-render.
 */
export async function moveCursorTo(page, x, y, isClickable = false) {
    try {
        await page.evaluate(({ x, y, clickable, arrow, hand }) => {
            let cursor = document.getElementById('sentra-cursor');
            if (!cursor) {
                cursor = document.createElement('img');
                cursor.id = 'sentra-cursor';
                cursor.src = clickable ? `data:image/png;base64,${hand}` : `data:image/png;base64,${arrow}`;
                cursor.dataset.arrow = `data:image/png;base64,${arrow}`;
                cursor.dataset.hand = `data:image/png;base64,${hand}`;
                cursor.style.cssText = `
                    position: fixed !important;
                    top: ${y}px; left: ${x}px;
                    width: ${clickable ? '26px' : '32px'}; height: ${clickable ? '26px' : '32px'};
                    z-index: 2147483647 !important;
                    pointer-events: none !important;
                    transform: translate(-5px, -2px);
                    transition: left 0.12s ease-out, top 0.12s ease-out;
                    filter: drop-shadow(1px 2px 3px rgba(0,0,0,0.35));
                    opacity: 1 !important;
                `;
                document.body.appendChild(cursor);
                return;
            }
            cursor.style.left = x + 'px';
            cursor.style.top = y + 'px';
            cursor.src = clickable ? cursor.dataset.hand : cursor.dataset.arrow;
            cursor.style.width = clickable ? '26px' : '32px';
            cursor.style.height = clickable ? '26px' : '32px';
        }, { x, y, clickable: isClickable, arrow: arrowCursorB64, hand: handCursorB64 });
        await page.waitForTimeout(120); // just enough for CSS transition
    } catch { }
}

/**
 * Show ripple at viewport-relative coordinates.
 */
export async function showClickRipple(page, x, y) {
    try {
        await page.evaluate(({ x, y }) => {
            let ripple = document.getElementById('sentra-ripple');
            if (!ripple) {
                ripple = document.createElement('div');
                ripple.id = 'sentra-ripple';
                ripple.style.cssText = `
                    position: fixed !important;
                    width: 28px; height: 28px;
                    border-radius: 50%;
                    background: rgba(124, 58, 237, 0.25);
                    border: 2px solid rgba(124, 58, 237, 0.6);
                    z-index: 2147483646 !important;
                    pointer-events: none !important;
                    opacity: 0;
                    transform: scale(0);
                    transition: transform 0.25s ease-out, opacity 0.25s ease-out;
                `;
                document.body.appendChild(ripple);
            }
            ripple.style.transition = 'none';
            ripple.style.opacity = '0';
            ripple.style.transform = 'scale(0)';
            ripple.style.left = (x - 14) + 'px';
            ripple.style.top = (y - 14) + 'px';
            ripple.offsetHeight;
            ripple.style.transition = 'transform 0.25s ease-out, opacity 0.25s ease-out';
            ripple.style.opacity = '1';
            ripple.style.transform = 'scale(2.5)';
            setTimeout(() => { ripple.style.opacity = '0'; }, 180);
        }, { x, y });
        await page.waitForTimeout(150);
    } catch { }
}

/**
 * Get VIEWPORT-relative center of element using getBoundingClientRect.
 */
export async function moveCursorToElement(page, element) {
    try {
        const coords = await element.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
                isClickable: ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)
                    || el.getAttribute('role') === 'button'
                    || el.getAttribute('role') === 'link'
            };
        });
        await moveCursorTo(page, coords.x, coords.y, coords.isClickable);
        return { x: coords.x, y: coords.y };
    } catch {
        return null;
    }
}

/**
 * Full click: scroll element into view (no jitter) → move cursor → ripple → click.
 */
export async function cursorClick(page, element) {
    try {
        const pos = await moveCursorToElement(page, element);
        if (pos) await showClickRipple(page, pos.x, pos.y);
        await element.click({ timeout: 5000 });
    } catch {
        try { await element.evaluate(el => el.click()); } catch { }
    }
}

/**
 * Full type: scroll into view → cursor → click to focus → clear → type.
 */
export async function cursorType(page, element, text) {
    try {
        const pos = await moveCursorToElement(page, element);
        if (pos) await showClickRipple(page, pos.x, pos.y);
        await element.click({ timeout: 3000 });
        await page.waitForTimeout(150);
        await element.evaluate(el => {
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }).catch(() => { });
        await element.type(text, { delay: 50 });
    } catch { }
}

/**
 * Hover.
 */
export async function cursorHover(page, element) {
    try {
        await moveCursorToElement(page, element);
        await page.waitForTimeout(300);
    } catch { }
}

/**
 * Drag and drop.
 */
export async function cursorDrag(page, sourceElement, targetX, targetY) {
    try {
        const pos = await moveCursorToElement(page, sourceElement);
        if (!pos) return;
        await page.mouse.move(pos.x, pos.y);
        await page.mouse.down();
        await page.waitForTimeout(100);
        await moveCursorTo(page, targetX, targetY, true);
        await page.mouse.move(targetX, targetY);
        await page.mouse.up();
        await page.waitForTimeout(150);
    } catch { }
}

/**
 * Scroll, keeping cursor fixed in viewport center.
 */
export async function cursorScroll(page, direction = 'down', amount = 400) {
    try {
        const viewport = page.viewportSize();
        const cx = viewport ? viewport.width / 2 : 683;
        const cy = viewport ? viewport.height / 2 : 384;
        await moveCursorTo(page, cx, cy, false);
        await page.evaluate(({ dir, px }) =>
            window.scrollBy({ top: dir === 'down' ? px : -px, behavior: 'smooth' }),
            { dir: direction, px: amount }
        );
        await page.waitForTimeout(500);
    } catch { }
}
