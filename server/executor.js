import { switchViewport } from './browser.js';
import { extractPageState } from './extractor.js';
import {
    initCursor, moveCursorTo, moveCursorToElement,
    cursorClick, cursorType, cursorScroll,
    showClickRipple, showScrollIndicator
} from './cursor.js';

const MAX_ACTIONS = 40;
const ACTION_PAUSE = 1500; // 1.5s between actions
const PAGE_SETTLE_TIME = 2000; // 2s after navigation

/**
 * Execute all goals using the multi-step agent loop.
 * The AI decides actions step-by-step per goal.
 */
export async function executeAllGoals(page, goals, testData, session, screenshotDir, addEvent, observeAndDecideFn) {
    const result = {
        totalGoals: goals.length,
        goalsCompleted: 0,
        totalActions: 0,
        successfulActions: 0,
        failedActions: 0,
        pagesVisited: [],
        aiBugsFound: 0,
        aiBugs: [],
        goalResults: [],
        timeline: [],
    };

    // Loop detection: track (url, action, target) tuples
    const actionHistory = []; // { type, target, describe, success }
    const seenActions = new Map(); // key → count

    // Initialize cursor in the browser
    try {
        await initCursor(page);
        addEvent(session, 'status', 'Visual cursor initialized');
    } catch (err) {
        addEvent(session, 'warning', 'Could not initialize cursor: ' + err.message);
    }

    for (const goal of goals) {
        if (result.totalActions >= MAX_ACTIONS) {
            addEvent(session, 'warning', `Action limit (${MAX_ACTIONS}) reached. Stopping.`);
            break;
        }

        addEvent(session, 'task-start', `Goal ${goal.id}: ${goal.name}`, {
            taskId: goal.id,
            taskName: goal.name,
            goal: goal.description,
        });

        const goalResult = {
            id: goal.id,
            name: goal.name,
            description: goal.description,
            status: 'running',
            actionsCompleted: 0,
            bugsFound: 0,
            errors: [],
        };

        // Agent loop for this goal: up to 3 observation rounds
        let roundsForGoal = 0;
        const MAX_ROUNDS_PER_GOAL = 3;

        while (roundsForGoal < MAX_ROUNDS_PER_GOAL && result.totalActions < MAX_ACTIONS) {
            roundsForGoal++;

            // 1. Extract current page state
            let pageState;
            try {
                pageState = await extractPageState(page);
            } catch (err) {
                addEvent(session, 'warning', 'Page extraction failed: ' + err.message);
                pageState = { url: page.url(), title: '', headings: [], buttons: [], links: [], inputs: [], images_count: 0, forms_count: 0, nav_items: [] };
            }

            // Track current URL
            const currentUrl = page.url();
            if (!result.pagesVisited.includes(currentUrl)) {
                result.pagesVisited.push(currentUrl);
            }

            // 2. AI observes and decides next actions
            addEvent(session, 'ai', `Analyzing page for: ${goal.name}...`);
            let decision;
            try {
                decision = await observeAndDecideFn(
                    pageState, goal, actionHistory, result.aiBugs, testData
                );
            } catch (err) {
                addEvent(session, 'warning', 'AI decision failed: ' + err.message);
                break;
            }

            // 3. Process AI-detected bugs
            if (decision.bugs_detected && decision.bugs_detected.length > 0) {
                for (const bug of decision.bugs_detected) {
                    result.aiBugsFound++;
                    result.aiBugs.push(bug);
                    goalResult.bugsFound++;
                    addEvent(session, 'action-fail', `🐛 AI Bug: ${bug.message}`, {
                        bugType: bug.type,
                        severity: bug.severity,
                    });

                    // Bug screenshot
                    await takeBugScreenshot(page, screenshotDir, session, addEvent, `ai-bug-g${goal.id}-r${roundsForGoal}`);
                }
            }

            // Log AI reasoning
            if (decision.reasoning) {
                addEvent(session, 'ai', `💭 ${decision.reasoning}`);
            }

            // 4. Check if goal is done
            if (decision.status === 'done' || !decision.actions || decision.actions.length === 0) {
                addEvent(session, 'ai', `Goal "${goal.name}" completed.`);
                break;
            }

            // 5. Execute the batch of actions
            for (const action of decision.actions) {
                if (result.totalActions >= MAX_ACTIONS) break;

                // Loop detection
                const actionKey = `${currentUrl}|${action.type}|${action.target || ''}`;
                const count = seenActions.get(actionKey) || 0;
                if (count >= 3) {
                    addEvent(session, 'warning', `Loop detected: skipping repeated action "${action.describe || action.type}"`);
                    continue;
                }
                seenActions.set(actionKey, count + 1);

                result.totalActions++;
                const actionDesc = action.describe || `${action.type}: ${action.target}`;

                try {
                    addEvent(session, 'status', `→ ${actionDesc}`);
                    const success = await executeAction(page, action, testData, session, screenshotDir, addEvent);

                    if (success) {
                        result.successfulActions++;
                        goalResult.actionsCompleted++;
                        addEvent(session, 'action', `✓ ${actionDesc}`);
                    } else {
                        result.failedActions++;
                        goalResult.bugsFound++;
                        goalResult.errors.push(actionDesc);
                        addEvent(session, 'action-fail', `✗ FAILED: ${actionDesc}`);
                        try { await takeBugScreenshot(page, screenshotDir, session, addEvent, `fail-g${goal.id}`); } catch { }
                    }

                    // Update action history (keep last 5 for context)
                    actionHistory.push({ type: action.type, target: action.target, describe: actionDesc, success });
                    if (actionHistory.length > 5) actionHistory.shift();

                    // Track URL changes
                    const newUrl = page.url();
                    if (!result.pagesVisited.includes(newUrl)) {
                        result.pagesVisited.push(newUrl);
                        addEvent(session, 'navigate', newUrl);
                    }

                    // Timeline
                    result.timeline.push({
                        timestamp: Date.now(),
                        goalId: goal.id,
                        action: action.type,
                        target: (action.target || '').slice(0, 80),
                        describe: actionDesc,
                        success,
                    });

                } catch (err) {
                    result.failedActions++;
                    goalResult.bugsFound++;
                    goalResult.errors.push(`${actionDesc}: ${err.message}`);
                    addEvent(session, 'action-fail', `✗ ERROR: ${actionDesc} — ${err.message}`);
                    try { await takeBugScreenshot(page, screenshotDir, session, addEvent, `error-g${goal.id}`); } catch { }
                }

                // Deliberate pause between actions (safe)
                try { await page.waitForTimeout(ACTION_PAUSE); } catch { }
            }
        }

        // Goal complete
        if (goalResult.bugsFound === 0 && goalResult.actionsCompleted > 0) {
            goalResult.status = 'passed';
        } else if (goalResult.actionsCompleted > 0) {
            goalResult.status = 'partial';
        } else {
            goalResult.status = 'failed';
        }

        result.goalsCompleted++;
        result.goalResults.push(goalResult);

        addEvent(session, 'task-end', `Goal ${goal.id} complete: ${goalResult.status}`, {
            taskId: goal.id,
            status: goalResult.status,
            bugsFound: goalResult.bugsFound,
        });

        // Navigate back for next goal
        try {
            if (page.url() !== session.url) {
                addEvent(session, 'status', 'Returning to homepage...');
                await page.goto(session.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                try { await page.waitForTimeout(PAGE_SETTLE_TIME); } catch { }
                try { await initCursor(page); } catch { }
            }
        } catch { }
    }

    return result;
}

/**
 * Execute a single action with cursor animations and human-like pacing.
 */
async function executeAction(page, action, testData, session, screenshotDir, addEvent) {
    const type = (action.type || '').toLowerCase();

    switch (type) {
        case 'click':
            return await smartClick(page, action);

        case 'type':
            return await smartType(page, action, testData);

        case 'scroll':
            return await smartScrollAction(page, action);

        case 'verify':
            return await smartVerify(page, action);

        case 'viewport':
            return await handleViewport(page, action);

        case 'navigate':
            return await smartNavigate(page, action);

        case 'wait':
            await page.waitForTimeout(parseInt(action.value) || 2000);
            return true;

        case 'select':
            return await smartSelect(page, action);

        default:
            return await smartClick(page, action);
    }
}

/**
 * Smart click with cursor animation — tries multiple strategies.
 */
async function smartClick(page, action) {
    const target = action.target || '';
    const textHint = action.value || action.describe || '';

    // Strategy 1: Direct CSS selector
    try {
        const el = page.locator(target).first();
        if (await el.isVisible({ timeout: 3000 })) {
            await cursorClick(page, el);
            await waitForPageSettle(page);
            return true;
        }
    } catch { }

    // Strategy 2: By visible text
    if (textHint) {
        try {
            const byText = page.getByText(textHint, { exact: false }).first();
            if (await byText.isVisible({ timeout: 2000 })) {
                await cursorClick(page, byText);
                await waitForPageSettle(page);
                return true;
            }
        } catch { }
    }

    // Strategy 3: by role button with name
    if (textHint) {
        try {
            const byRole = page.getByRole('button', { name: textHint }).first();
            if (await byRole.isVisible({ timeout: 2000 })) {
                await cursorClick(page, byRole);
                await waitForPageSettle(page);
                return true;
            }
        } catch { }

        // Strategy 4: by role link
        try {
            const byLink = page.getByRole('link', { name: textHint }).first();
            if (await byLink.isVisible({ timeout: 2000 })) {
                await cursorClick(page, byLink);
                await waitForPageSettle(page);
                return true;
            }
        } catch { }
    }

    // Strategy 5: aria-label
    if (textHint) {
        try {
            const byAria = page.locator(`[aria-label*="${textHint}" i]`).first();
            if (await byAria.isVisible({ timeout: 2000 })) {
                await cursorClick(page, byAria);
                await waitForPageSettle(page);
                return true;
            }
        } catch { }
    }

    // Strategy 6: partial text match on buttons
    if (textHint) {
        const words = textHint.split(/\s+/).filter(w => w.length > 2);
        for (const word of words) {
            try {
                const el = page.getByText(word, { exact: false }).first();
                if (await el.isVisible({ timeout: 1500 })) {
                    await cursorClick(page, el);
                    await waitForPageSettle(page);
                    return true;
                }
            } catch { }
        }
    }

    return false;
}

/**
 * Smart type with cursor animation — human-like character-by-character typing.
 */
async function smartType(page, action, testData) {
    const target = action.target || '';
    const value = action.value || resolveTestData(action, testData) || 'test';

    // Strategy 1: Direct selector
    try {
        const el = page.locator(target).first();
        if (await el.isVisible({ timeout: 3000 })) {
            await cursorType(page, el, value);
            return true;
        }
    } catch { }

    // Strategy 2: By placeholder
    const placeholder = action.describe || action.value || '';
    if (placeholder) {
        try {
            const byPH = page.getByPlaceholder(placeholder, { exact: false }).first();
            if (await byPH.isVisible({ timeout: 2000 })) {
                await cursorType(page, byPH, value);
                return true;
            }
        } catch { }
    }

    // Strategy 3: By label
    if (placeholder) {
        try {
            const byLabel = page.getByLabel(placeholder, { exact: false }).first();
            if (await byLabel.isVisible({ timeout: 2000 })) {
                await cursorType(page, byLabel, value);
                return true;
            }
        } catch { }
    }

    // Strategy 4: By name attribute
    if (target.includes('name=')) {
        const nameMatch = target.match(/name="?([^"]+)"?/);
        if (nameMatch) {
            try {
                const byName = page.locator(`[name="${nameMatch[1]}"]`).first();
                if (await byName.isVisible({ timeout: 2000 })) {
                    await cursorType(page, byName, value);
                    return true;
                }
            } catch { }
        }
    }

    // Strategy 5: First visible input of matching type
    try {
        const inputType = action.target?.match(/type="?(\w+)"?/)?.[1] || 'text';
        const el = page.locator(`input[type="${inputType}"]`).first();
        if (await el.isVisible({ timeout: 2000 })) {
            await cursorType(page, el, value);
            return true;
        }
    } catch { }

    return false;
}

/**
 * Smart scroll with cursor animation.
 */
async function smartScrollAction(page, action) {
    try {
        if (action.target === 'bottom') {
            await cursorScroll(page, 'down', 99999);
        } else if (action.target === 'top') {
            await cursorScroll(page, 'up', 99999);
        } else {
            const amount = parseInt(action.value) || 500;
            await cursorScroll(page, 'down', amount);
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Smart verify — check if element exists and is visible.
 */
async function smartVerify(page, action) {
    const target = action.target || '';

    try {
        const el = page.locator(target).first();
        if (await el.isVisible({ timeout: 3000 })) {
            return true;
        }
    } catch { }

    if (target) {
        try {
            const byText = page.getByText(target, { exact: false }).first();
            if (await byText.isVisible({ timeout: 2000 })) {
                return true;
            }
        } catch { }
    }

    return false;
}

/**
 * Handle viewport switching.
 */
async function handleViewport(page, action) {
    try {
        const type = action.target === 'mobile' ? 'mobile' : 'desktop';
        await switchViewport(page, type);
        // Re-init cursor after viewport change
        try { await initCursor(page); } catch { }
        return true;
    } catch {
        return false;
    }
}

/**
 * Navigate to URL or click nav item.
 */
async function smartNavigate(page, action) {
    const target = action.target || '';

    if (target.startsWith('http')) {
        try {
            await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForTimeout(PAGE_SETTLE_TIME);
            try { await initCursor(page); } catch { }
            return true;
        } catch {
            return false;
        }
    }

    return await smartClick(page, action);
}

/**
 * Smart select — dropdowns.
 */
async function smartSelect(page, action) {
    try {
        const el = page.locator(action.target).first();
        if (await el.isVisible({ timeout: 3000 })) {
            await moveCursorToElement(page, el);
            await showClickRipple(page, 0, 0);
            await el.selectOption({ label: action.value });
            return true;
        }
    } catch { }

    try {
        const el = page.locator(action.target).first();
        if (await el.isVisible({ timeout: 2000 })) {
            await el.selectOption({ index: 1 });
            return true;
        }
    } catch { }

    return false;
}

/**
 * Wait for page to settle after a navigation or click.
 * Smart wait: tries networkidle first, falls back to domcontentloaded.
 */
async function waitForPageSettle(page) {
    try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch {
        try {
            await page.waitForLoadState('domcontentloaded', { timeout: 3000 });
        } catch { }
    }
    // Extra settle time
    await page.waitForTimeout(800);
}

/**
 * Resolve test data from AI-provided test_data.
 */
function resolveTestData(action, testData) {
    if (!testData) return null;
    const desc = (action.describe || '').toLowerCase();

    if (desc.includes('email')) return testData.email;
    if (desc.includes('phone') || desc.includes('mobile')) return testData.phone;
    if (desc.includes('name')) return testData.name;
    if (desc.includes('from') || desc.includes('depart') || desc.includes('source')) return testData.from_city;
    if (desc.includes('to') || desc.includes('dest') || desc.includes('arrival')) return testData.to_city;
    if (desc.includes('date')) return testData.date;
    return null;
}

/**
 * Take screenshot at bug locations only.
 */
async function takeBugScreenshot(page, screenshotDir, session, addEvent, label) {
    try {
        const { join } = await import('path');
        const filename = `${label}-${Date.now()}.png`;
        const filepath = join(screenshotDir, filename);
        await page.screenshot({ path: filepath, fullPage: false });
        addEvent(session, 'screenshot', `Bug screenshot: ${filename}`, { name: filename });
    } catch { }
}
