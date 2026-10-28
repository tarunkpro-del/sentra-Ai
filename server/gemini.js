/**
 * gemini.js — SENTRA AI Engine (v3 — PRD-aligned)
 *
 * Phase 1: DISCOVERY — Autonomous site exploration + per-agent mission creation
 * Phase 2: ACT       — Step-by-step browser action decisions
 * Phase 3: REPORT    — 12-section consolidated QA report
 */

import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Use gemini-3.5-flash with env override support and resilient fallbacks
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
export const GEMINI_MAX_CONCURRENT = Math.max(1, Number(process.env.GEMINI_MAX_CONCURRENT || 3));
export const GEMINI_REQUESTS_PER_MINUTE = Math.max(1, Number(process.env.GEMINI_REQUESTS_PER_MINUTE || 30));
const GEMINI_MAX_RETRIES = 3;
const GEMINI_BACKOFFS = [1000, 2500, 5000];

let aiCallCount = 0;
let totalTokens = 0;

const requestQueue = [];
let activeRequests = 0;
const requestTimestamps = [];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function getAICallCount() { return aiCallCount; }
export function getTotalTokens() { return totalTokens; }
export function resetAICounter() { aiCallCount = 0; totalTokens = 0; }
export function isAIBudgetExhausted() { return totalTokens >= 300000; }

function parseRetryDelay(err) {
    if (!err) return null;
    const headers = err.headers || err.sdkHttpResponse?.headers || err.response?.headers || {};
    const getHeader = key => {
        if (!headers) return undefined;
        const lower = Object.keys(headers).find(k => k.toLowerCase() === key.toLowerCase());
        if (!lower) return undefined;
        return headers[lower];
    };
    const rawHeader = getHeader('retry-after') || getHeader('Retry-After') || getHeader('retry_delay');
    if (rawHeader) {
        const parsed = parseInt(String(rawHeader).trim(), 10);
        if (!isNaN(parsed) && parsed > 0) return parsed * 1000;
    }
    const message = String(err.message || '');
    const delayMatch = message.match(/retry(?:[-_ ]after| delay)?[:=]?\s*(\d+)\s*s/i)
        || message.match(/(\d+)\s*seconds/i)
        || message.match(/(\d+)\s*sec/i);
    if (delayMatch) {
        const ms = parseInt(delayMatch[1], 10) * 1000;
        if (!isNaN(ms) && ms > 0) return ms;
    }
    try {
        const body = typeof err.message === 'string' ? JSON.parse(err.message) : null;
        const delay = body?.error?.retryDelay || body?.retryDelay || body?.error?.details?.[0]?.retryDelay;
        if (typeof delay === 'number' && delay > 0) return delay * 1000;
    } catch { }
    return null;
}

function normalizeNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = parseInt(value.replace(/[^\d-]/g, ''), 10);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function getErrorCode(err) {
    const rawCode = err?.code || err?.error?.code || err?.response?.data?.error?.code || err?.response?.data?.code;
    return normalizeNumber(rawCode) ?? rawCode;
}

function getErrorStatus(err) {
    const raw = err?.status || err?.statusCode || err?.error?.status || err?.response?.status || err?.sdkHttpResponse?.responseInternal?.status;
    return normalizeNumber(raw) ?? raw;
}

function getErrorStatusText(err) {
    return err?.statusText || err?.error?.status || err?.error?.name || err?.name || '';
}

function isRetryableError(err) {
    if (!err) return false;
    const status = getErrorStatus(err);
    const code = getErrorCode(err);
    const statusText = String(getErrorStatusText(err) || '').toUpperCase();
    const msg = String(err.message || '').toUpperCase();
    return status === 429 || code === 429 ||
        status === 503 || code === 503 ||
        status === 500 || code === 500 ||
        status === 502 || code === 502 ||
        status === 504 || code === 504 ||
        statusText === 'RESOURCE_EXHAUSTED' ||
        statusText === 'UNAVAILABLE' ||
        statusText === 'INTERNAL' ||
        msg.includes('HIGH DEMAND') ||
        msg.includes('SPIKES IN DEMAND') ||
        msg.includes('OVERLOADED') ||
        msg.includes('TEMPORARILY') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('INTERMITTENT') ||
        msg.includes('SERVICE UNAVAILABLE') ||
        msg.includes('MODEL API IS CURRENTLY OVERLOADED') ||
        msg.includes('TRY AGAIN') ||
        String(code).toUpperCase() === 'RESOURCE_EXHAUSTED';
}

function debugQueue(msg) {
    console.log(`[Gemini Queue] ${msg}`);
}

function pruneRequestTimestamps() {
    const now = Date.now();
    while (requestTimestamps.length > 0 && now - requestTimestamps[0] >= 60000) {
        requestTimestamps.shift();
    }
}

async function waitForRateSlot() {
    pruneRequestTimestamps();
    if (requestTimestamps.length < GEMINI_REQUESTS_PER_MINUTE) return;
    const now = Date.now();
    const nextSlot = 60000 - (now - requestTimestamps[0]);
    const waitMs = Math.max(1000, nextSlot);
    debugQueue(`Rate limit reached — waiting ${Math.ceil(waitMs / 1000)}s before request`);
    await sleep(waitMs);
    return waitForRateSlot();
}

function processQueue() {
    if (activeRequests >= GEMINI_MAX_CONCURRENT || requestQueue.length === 0) return;
    const next = requestQueue.shift();
    activeRequests += 1;
    debugQueue(`Running request... active=${activeRequests} queue=${requestQueue.length}`);
    next.executor()
        .then(next.resolve)
        .catch(next.reject)
        .finally(() => {
            activeRequests -= 1;
            debugQueue(`Completed. active=${activeRequests} queue=${requestQueue.length}`);
            processQueue();
        });
}

function enqueueGeminiRequest(executor) {
    return new Promise((resolve, reject) => {
        requestQueue.push({ executor, resolve, reject });
        debugQueue(`Waiting... active=${activeRequests} queue=${requestQueue.length}`);
        processQueue();
    });
}

const CANDIDATE_MODELS = [
    'gemini-3.1-flash-lite',
    GEMINI_MODEL,
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
].filter((m, i, arr) => arr.indexOf(m) === i && Boolean(m));

async function executeGeminiRequest(prompt, label) {
    let lastError = null;
    for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
        // Rotate through candidate models on each retry
        const activeModel = CANDIDATE_MODELS[attempt % CANDIDATE_MODELS.length];
        try {
            await waitForRateSlot();
            const result = await genAI.models.generateContent({
                model: activeModel,
                contents: prompt,
            });
            const text = result?.text;
            if (typeof text !== 'string') {
                throw new Error('Gemini returned no text response');
            }
            requestTimestamps.push(Date.now());
            aiCallCount++;
            totalTokens += Math.ceil((prompt.length + text.length) / 4);
            console.log(`  [AI:${label}] #${aiCallCount} ~${totalTokens} tokens (${activeModel})`);
            return text;
        } catch (err) {
            lastError = err;
            const is404 = String(err.message || '').includes('404') || err.status === 404;
            const isRetry = isRetryableError(err) || is404;
            console.warn(`[AI:${label}] ⚠ Attempt ${attempt + 1}/${GEMINI_MAX_RETRIES + 1} failed (${activeModel}): ${err?.message?.slice(0, 80)}`);
            if (attempt >= GEMINI_MAX_RETRIES || !isRetry) {
                console.error(`  [AI:${label}] Giving up after ${attempt + 1} attempts.`);
                throw err;
            }
            // For 404, immediately switch model with minimal delay (300ms)
            const retryDelay = is404 ? 300 : (parseRetryDelay(err) || GEMINI_BACKOFFS[Math.min(attempt, GEMINI_BACKOFFS.length - 1)]);
            const waitSeconds = Math.ceil(retryDelay / 1000);
            const nextModel = CANDIDATE_MODELS[(attempt + 1) % CANDIDATE_MODELS.length];
            debugQueue(`Retry ${attempt + 1}/${GEMINI_MAX_RETRIES}: switching ${activeModel} → ${nextModel} after ${waitSeconds}s...`);
            await sleep(retryDelay);
        }
    }
    throw lastError;
}

export async function callGemini(prompt, label = 'ai', options = {}) {
    if (isAIBudgetExhausted()) { console.warn('[AI] Budget hit'); return null; }
    try {
        const text = await enqueueGeminiRequest(() => executeGeminiRequest(prompt, label));
        return text;
    } catch (e) {
        console.error(`  [AI:${label}] Error: ${e.message}`);
        if (options.throwOnError) throw e;
        return null;
    }
}

function parseJSON(text) {
    if (!text) return null;
    let s = text.replace(/^```(?:json)?\s*/im, '').replace(/```\s*$/im, '').trim();
    try { return JSON.parse(s); } catch { }
    const m = s.match(/\{[\s\S]*\}/);
    if (m) try { return JSON.parse(m[0]); } catch { }
    return null;
}

// ─── Phase 1: DISCOVERY AGENT ───────────────────────────────────────────────
/**
 * Full autonomous site discovery — explores the website, identifies features,
 * user journeys, and creates specific missions for each of the 6 QA agents.
 *
 * Returns agentAssignments object with missions for agents C, D, E, F, G, H.
 */
export async function runDiscoveryAgent(url, pageTitle, headings, pageText, elements, prdText = '', userInstructions = '') {
    const prdSection = prdText
        ? `\n\nPRD DOCUMENT (use this to guide testing requirements):\n${prdText.slice(0, 3000)}`
        : '';
    const instructionsSection = userInstructions
        ? `\n\nUSER TESTING INSTRUCTIONS:\n${userInstructions}`
        : '';

    const prompt = `You are SENTRA's Discovery Agent. Analyze this website and create targeted test missions for 6 specialized QA agents.

URL: ${url}
Title: ${pageTitle}
Page Sections/Headings: ${headings || 'none'}
Page Content (first 2000 chars):
${(pageText || '').slice(0, 2000)}

Interactive Elements Found:
${(elements || '').slice(0, 1000)}
${prdSection}
${instructionsSection}

Based on this analysis, create specific test missions for each of the 6 SENTRA QA agents.
Each mission must include:
- A clear task description tailored to THIS specific website
- A step-by-step test plan (array of steps)
- Specific test data to use (URLs, inputs, values)

Return ONLY this JSON (no markdown fences):
{
  "siteType": "ecommerce|saas|blog|portfolio|booking|marketplace|social|other",
  "siteName": "human readable site name",
  "discoveredFeatures": ["feature1", "feature2"],
  "userJourneys": ["journey1 description", "journey2 description"],
  "testData": {
    "searchTerm": "relevant search term for this site",
    "email": "test@sentra.io",
    "password": "TestPass123!",
    "username": "sentra_tester",
    "name": "Test User",
    "phone": "9876543210",
    "address": "123 Test Street, Test City"
  },
  "agentMissions": {
    "ui_responsiveness": {
      "task": "You are SENTRA's UI & Responsiveness Agent testing ${pageTitle || url}. Check the visual presentation and usability. Specifically: [list 3-5 specific UI things to check based on what you see on this site]. Look for overlapping elements, layout overflow, inaccessible buttons, navigation issues, and spacing inconsistencies.",
      "testPlan": [
        { "step": "specific action on this site" }
      ],
      "focusAreas": ["specific UI area 1", "specific UI area 2"]
    },
    "core_user_flow": {
      "task": "You are SENTRA's Core User Flow Agent testing ${pageTitle || url}. Verify the most important user journeys. Based on the site: [describe the primary user journey for THIS site specifically].",
      "testPlan": [
        { "step": "specific flow step" }
      ],
      "primaryJourney": "description of the main journey to test"
    },
    "security": {
      "task": "You are SENTRA's Security Agent testing ${pageTitle || url} through authorized, non-destructive checks. Check: (1) authentication behavior, (2) access control on any protected pages, (3) input validation using safe test inputs like <test>, ../test, or spaces/special chars, (4) whether sensitive data appears in URLs or error messages.",
      "testPlan": [
        { "step": "security check step" }
      ],
      "checkPoints": ["auth behavior", "input validation"]
    },
    "performance": {
      "task": "You are SENTRA's Performance & Speed Agent testing ${pageTitle || url}. Observe load behavior and identify slow operations. Any page taking more than 3 seconds is notable; more than 5 seconds is a critical finding.",
      "testPlan": [
        { "step": "performance check step" }
      ],
      "thresholds": { "warning": 3000, "critical": 5000 }
    },
    "edge_case": {
      "task": "You are SENTRA's Edge Case & Failure Agent testing ${pageTitle || url}. Test unusual, invalid, and boundary inputs. Try: empty form submissions, very long inputs (200+ chars), special characters (!@#$%^&*), invalid email formats, negative numbers. Check if validation messages appear and are helpful.",
      "testPlan": [
        { "step": "edge case test" }
      ],
      "inputs": ["empty", "very_long", "special_chars", "invalid_format"]
    },
    "functional": {
      "task": "You are SENTRA's Functional & Business Logic Agent testing ${pageTitle || url}. Verify that features behave according to their stated purpose. Check calculations, data persistence, state consistency, and whether features produce correct outcomes.",
      "testPlan": [
        { "step": "functional check" }
      ],
      "verifyAreas": ["calculations", "state persistence", "data accuracy"]
    }
  }
}`;

    const text = await callGemini(prompt, 'discovery');
    const parsed = parseJSON(text);

    if (!parsed) {
        console.log('  [Discovery] Failed to parse response, using fallback missions');
        return buildFallbackMissions(url, pageTitle);
    }

    console.log(`  [Discovery] Site: ${parsed.siteType} — ${parsed.discoveredFeatures?.length || 0} features, ${parsed.userJourneys?.length || 0} journeys`);
    return parsed;
}

/**
 * Fallback missions when Discovery Agent AI call fails.
 */
function buildFallbackMissions(url, siteName) {
    return {
        siteType: 'other',
        siteName: siteName || url,
        discoveredFeatures: ['navigation', 'forms', 'content'],
        userJourneys: ['browse and interact with main content'],
        testData: {
            searchTerm: 'test',
            email: 'test@sentra.io',
            password: 'TestPass123!',
            name: 'Test User',
        },
        agentMissions: {
            ui_responsiveness: {
                task: `You are SENTRA's UI & Responsiveness Agent. Test the visual layout of ${siteName || url}. Check for overlapping elements, broken layouts, inaccessible buttons, and navigation issues. Try different scroll positions and check all visible UI elements.`,
                testPlan: [
                    { step: 'Load the home page and inspect the overall layout' },
                    { step: 'Check if navigation menu is visible and functional' },
                    { step: 'Scroll down to inspect all page sections' },
                    { step: 'Look for any overlapping or clipped elements' },
                    { step: 'Check buttons, links and interactive elements are accessible' },
                    { step: 'Done — report all visual issues found' },
                ],
                focusAreas: ['navigation', 'layout', 'buttons'],
            },
            core_user_flow: {
                task: `You are SENTRA's Core User Flow Agent. Test the main user journey on ${siteName || url}. Navigate through the primary features, try key interactions, and verify each step leads to the expected outcome.`,
                testPlan: [
                    { step: 'Start on the home page and identify the primary call-to-action' },
                    { step: 'Follow the main user journey (sign up, browse, or primary feature)' },
                    { step: 'Check that navigation between sections works correctly' },
                    { step: 'Try submitting any forms with valid data' },
                    { step: 'Verify the expected outcome or confirmation is reached' },
                    { step: 'Done — report any broken flows found' },
                ],
                primaryJourney: 'main site interaction',
            },
            security: {
                task: `You are SENTRA's Security Agent. Test ${siteName || url} for potential security weaknesses through authorized, non-destructive checks. Check auth behavior, input validation with safe test inputs, and sensitive data exposure.`,
                testPlan: [
                    { step: 'Check if any protected pages are accessible without login' },
                    { step: 'Test form inputs with safe special characters: <test>, script>, ../test' },
                    { step: 'Check if error messages reveal sensitive technical details' },
                    { step: 'Try accessing common admin paths like /admin, /dashboard, /api' },
                    { step: 'Check if sensitive data appears in page URLs' },
                    { step: 'Done — report potential security findings' },
                ],
                checkPoints: ['access control', 'input handling', 'error messages'],
            },
            performance: {
                task: `You are SENTRA's Performance & Speed Agent. Observe the load behavior of ${siteName || url}. Note any operations taking over 3 seconds (warning) or over 5 seconds (critical). Check page load times, interaction responsiveness, and heavy resources.`,
                testPlan: [
                    { step: 'Load the home page and observe how long it takes to become interactive' },
                    { step: 'Navigate to key pages and note load times' },
                    { step: 'Try main interactions (search, click, submit) and note responsiveness' },
                    { step: 'Check if images and assets load quickly or cause delays' },
                    { step: 'Navigate back and forward to test cached load performance' },
                    { step: 'Done — report all performance observations' },
                ],
                thresholds: { warning: 3000, critical: 5000 },
            },
            edge_case: {
                task: `You are SENTRA's Edge Case & Failure Agent. Test ${siteName || url} with unusual, invalid, and boundary inputs. Submit empty forms, use very long text, special characters, and invalid formats. Check that validation messages appear and are helpful.`,
                testPlan: [
                    { step: 'Find all input fields and submit them empty' },
                    { step: 'Try a very long input (200+ characters) in text fields' },
                    { step: 'Enter special characters: !@#$%^&*()_+ in text fields' },
                    { step: 'Enter an invalid email format: notanemail' },
                    { step: 'Try submitting the same form multiple times quickly' },
                    { step: 'Check that validation messages appear and are helpful' },
                    { step: 'Done — report all edge case findings' },
                ],
                inputs: ['empty', 'too_long', 'special_chars', 'invalid_email'],
            },
            functional: {
                task: `You are SENTRA's Functional & Business Logic Agent. Verify that ${siteName || url} features work correctly. Check calculations, data accuracy, state persistence across navigation, and that features produce expected outcomes.`,
                testPlan: [
                    { step: 'Identify the core features of the site' },
                    { step: 'Test each feature with valid inputs and verify the output' },
                    { step: 'Navigate away from a page and back — check data persistence' },
                    { step: 'If there are calculations (prices, totals), verify the math' },
                    { step: 'Check that actions have consistent, repeatable outcomes' },
                    { step: 'Done — report any functional issues or inconsistencies' },
                ],
                verifyAreas: ['feature correctness', 'data consistency'],
            },
        },
    };
}

// ─── Phase 2: STEP-BY-STEP ACTION ──────────────────────────────────────────

const AGENT_FOCUS = {
    C: `You are the Navigation & Discovery Agent. Explore the homepage, categories, menus, and navigation links. Visit 3+ DIFFERENT category pages (e.g. Electronics → Home & Kitchen → Books). For bus sites: test route search (From=Mumbai To=Pune, today+3 days). Map the site structure. Do NOT add items to cart or repeat the same category.`,
    D: `You are the UI Controls & Search Agent. Test the search bar with 2+ DIFFERENT queries (e.g. "laptop" then "headphones"). Test tabs, dropdowns, filters, and interactive elements. Verify state changes after each action. Do NOT search for mobile phones.`,
    E: `You are the Forms & Auth Agent. Find the sign-in/login form and test with synthetic credentials: email testuser.sentra@gmail.com, password TestPass123!, phone 9876543210. Test form validation with empty/invalid inputs. Verify error messages appear correctly.`,
    F: `You are the Core Workflow & E-commerce Agent. Your job: (1) Search for "laptop" → open a product → Add to Cart. (2) Go BACK → search "headphones" → open a DIFFERENT product → Add to Cart. (3) Go to Cart → verify 2 items → proceed to Checkout. Fill delivery: Tarun Kumar, 123 MG Road Mumbai 400001. Inspect payment options WITHOUT submitting. For bus sites: search routes → select a bus → select 1 seat → fill passenger details.`,
    G: `You are the Business Logic & Bus Booking Agent. For bus sites: test seat selection carefully — click exactly 1 seat and verify ONLY 1 seat is selected (bug if multiple seats get selected). Enter passenger: name=Tarun Kumar age=28. Verify fare totals. For e-commerce: verify prices match between listing and cart page. Check quantity calculations.`,
    H: `You are the Defect Verification Agent. Navigate to pages where issues may occur: cart total page, checkout summary, seat confirmation. Verify: cart totals match line items, prices are not NaN/undefined, seat counts match selection. Explore the "Home & Kitchen" or "Books" category specifically. Screenshot any anomaly you find.`,
};

export async function getNextAction({ task, workerId, url, title, headings, pageText, prices, cartTotal, currency, numbered, maxIndex, history, memory, mission, stuckReason, visitedUrls }) {
    const historyStr = history.length > 0
        ? history.slice(-5).map((h, i) =>
            `${i + 1}. [${h.success ? 'OK' : 'FAIL'}] ${h.action?.toUpperCase()} — ${(h.description || '').slice(0, 60)}`
        ).join('\n')
        : '(first step)';

    const memoryStr = Object.keys(memory).length > 0
        ? Object.entries(memory).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join('\n')
        : '  (empty)';

    const testData = JSON.stringify(mission?.testData || {});
    const planSteps = (mission?.testPlan || []).map((s, i) => `  ${i + 1}. ${s.step || s}`).join('\n');
    const checkpoints = (mission?.checkpoints || []).map(c => `  - On ${c.page}: ${c.expect}`).join('\n');

    const stuckNote = stuckReason ? `\n⚠ STUCK: ${stuckReason}. You MUST try a DIFFERENT action or element.\n` : '';

    const visitedNote = visitedUrls && visitedUrls.size > 0
        ? `\nALREADY VISITED (DO NOT revisit): ${[...visitedUrls].slice(0, 15).join(', ')}\n`
        : '';

    const agentFocus = workerId && AGENT_FOCUS[workerId] ? `\nAGENT ROLE:\n${AGENT_FOCUS[workerId]}\n` : '';

    const prompt = `You are an AI QA tester controlling a real browser. Pick ONE action to move forward.
${agentFocus}
YOUR MISSION (complete this — do not drift to unrelated flows):
${task || 'Explore the site systematically and test the assigned QA domain.'}
${stuckNote}${visitedNote}
PAGE: ${url}
Title: ${title} | Sections: ${headings || 'none'}
Prices: ${prices?.length > 0 ? prices.join(', ') : 'none'}${cartTotal ? ` | Cart Total: ${cartTotal}` : ''}${currency ? ` | Currency: ${currency}` : ''}

PAGE TEXT:
${(pageText || '').slice(0, 2000)}

ELEMENTS [0-${maxIndex}]:
${numbered || '(none)'}

MEMORY:
${memoryStr}

TEST DATA: ${testData}

PLAN:
${planSteps}

CHECKPOINTS:
${checkpoints || '  none'}

HISTORY:
${historyStr}

RULES (strictly follow all):
R1. [TYPEABLE] = "type". [CLICKABLE] = "click". [SELECT] = "select". Never type into CLICKABLE.
R2. After typing in search box → set pressEnter:true.
R3. Date picker: if calendar NOT open → click the date field. If open → click a future date number.
R4. Modal/popup visible → close it first (click Close/Skip/×).
R5. After typing, if autocomplete appears → set waitForSuggestion:true.
R6. Done ONLY when task objectives are fully completed OR on a confirmation page.
R7. If action failed before, try a different element or approach.
R8. index must be 0-${maxIndex}. null only for scroll/wait/done.

BUG DETECTION RULES (always check after each action):
R9.  [SEARCH MISMATCH] After searching: if results are completely unrelated to the search term → ADD bug: type:"search_mismatch", severity:"high"
R10. [CART TOTAL] On cart/checkout: if Total ≠ Subtotal + Tax → ADD bug: type:"cart_total_error", severity:"critical"
R11. [CURRENCY MISMATCH] If currency symbol changes between pages → ADD bug: type:"currency_mismatch", severity:"high"
R12. [DATE MISMATCH] On confirmation: if displayed date ≠ selected date → ADD bug: type:"date_offset_error", severity:"critical"
R13. [QUANTITY DOUBLING] After adding 1 item: if quantity shows 2+ → ADD bug: type:"quantity_doubling", severity:"critical"
R14. [PRICE INCONSISTENCY] If price changes between product page and cart → ADD bug: type:"price_inconsistency", severity:"critical"
R15. [MISSING VALIDATION] After submitting empty/invalid form: if no error message → ADD bug: type:"missing_validation", severity:"high"
R16. [BROKEN LINK] If navigating to a page shows 404/error → ADD bug: type:"broken_link", severity:"medium"
R17. [LAYOUT OVERFLOW] If text or elements overflow their containers → ADD bug: type:"layout_overflow", severity:"medium"
R18. [SLOW LOAD] If page takes unusually long to respond → ADD bug: type:"slow_load", severity:"medium"
R19. [SECURITY EXPOSURE] If error messages show stack traces/internal paths → ADD bug: type:"security_exposure", severity:"high"
R20. [ACCESS CONTROL] If protected page loads without authentication → ADD bug: type:"access_control", severity:"critical"
R21. [DIVERSITY] Do NOT repeatedly search for or navigate to the same product category. If you have already seen mobile phones, search for a DIFFERENT category like "laptop", "headphones", "books", or "home kitchen". Each agent must explore a unique category.
R22. [NO REPEAT PAGES] Do NOT navigate to URLs you have already visited. Explore new pages. If stuck on the same page, go back or navigate to a completely different section of the site.

MEMORY RULES:
- Save to memory: product_price, booking_date, listing_price, selected_currency, added_to_cart
- Compare with previous memory values when navigating new pages

RESPOND WITH RAW JSON ONLY:
{
  "description": "I am on [page]. I see [info]. I will [action] because [reason].",
  "action": "click|type|select|scroll|press|wait|navigate|done",
  "index": <0-${maxIndex} or null>,
  "value": "",
  "pressEnter": false,
  "waitForSuggestion": false,
  "done": false,
  "memory": { "key": "value to save" },
  "bugs": [
    {
      "type": "bug_type",
      "severity": "critical|high|medium|low",
      "title": "Short bug title",
      "description": "Plain English: What was done → What was expected → What happened → Why it's broken.",
      "page": "page URL or name",
      "expected": "what should have happened",
      "actual": "what actually happened",
      "businessImpact": "1 sentence business impact",
      "reproductionSteps": ["step 1", "step 2", "step 3"]
    }
  ]
}`;

    const text = await callGemini(prompt, 'step');
    if (!text) return null;

    const parsed = parseJSON(text);
    if (!parsed || typeof parsed.action !== 'string') {
        console.log(`  [AI:step] Bad response: ${(text || '').slice(0, 80)}`);
        return null;
    }

    if (typeof parsed.index === 'number' && (parsed.index < 0 || parsed.index > maxIndex)) {
        console.log(`  [AI:step] Index ${parsed.index} out of range (0-${maxIndex}), setting to null`);
        parsed.index = null;
    }

    return parsed;
}

// ─── Phase 3: FINAL REPORT ──────────────────────────────────────────────────

export async function generateFinalReport(history, bugs, siteType, url, discovery, memory, agentResults) {
    const ok = history.filter(h => h.success).length;
    const total = history.length;

    const bugList = bugs.length > 0
        ? bugs.map((b, i) =>
            `Bug ${i + 1} [${(b.severity || 'medium').toUpperCase()}] — ${b.title || b.type}:\n  What: ${b.description}\n  Page: ${b.page || b.url || 'unknown'}\n  Expected: ${b.expected || 'n/a'}\n  Actual: ${b.actual || 'n/a'}\n  Agent: ${b.source || 'unknown'}`
        ).join('\n\n')
        : 'No bugs detected.';

    const memoryStr = Object.entries(memory)
        .filter(([k]) => !k.startsWith('visited_'))
        .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
        .join('\n') || '  (none)';

    const agentSummary = (agentResults || []).map(a =>
        `  ${a.name || a.agentId}: ${a.bugs?.length || 0} bugs, ${a.stepsCompleted || 0} steps`
    ).join('\n') || '  (no agent data)';

    const prompt = `You are SENTRA's senior QA manager. Write a professional 12-section QA report for business stakeholders.

Website: ${discovery?.siteName || url} (${siteType})
Site Type: ${discovery?.siteType || siteType}
Features Discovered: ${(discovery?.discoveredFeatures || []).join(', ') || 'n/a'}
Steps completed: ${ok} of ${total}
Total bugs found: ${bugs.length}

AGENT CONTRIBUTIONS:
${agentSummary}

VALUES RECORDED DURING TESTING:
${memoryStr}

ALL BUGS FOUND:
${bugList}

Return ONLY this JSON (no markdown fences):
{
  "summary": "3-4 sentences: what was tested, what worked, what bugs were found, business impact. Plain English, no jargon.",
  "overallStatus": "pass|fail|partial",
  "bugs": [
    {
      "type": "bug_type",
      "title": "Short bug title",
      "description": "Plain English explanation of the bug",
      "page": "affected URL or page name",
      "expected": "what should have happened",
      "actual": "what actually happened",
      "severity": "critical|major|minor|suggestion",
      "agentDomain": "ui_responsiveness|core_user_flow|security|performance|edge_case|functional",
      "businessImpact": "How this affects users or revenue",
      "reproductionSteps": ["step 1 to reproduce", "step 2", "step 3"],
      "recommendation": "Specific fix recommendation"
    }
  ],
  "reliability_score": <0-100, deduct 25 per critical, 15 per major, 8 per minor, 3 per suggestion>,
  "risk_level": "low|medium|high|critical",
  "strengths": ["2-3 things that worked correctly on this site"],
  "recommendations": ["one actionable fix per bug or improvement area"],
  "coverageNotes": "1-2 sentences on what was and was not covered in this test run",
  "testingLimitations": ["limitation 1", "limitation 2"]
}`;

    const text = await callGemini(prompt, 'report');
    const parsed = parseJSON(text);

    const hasSufficientEvidence = total > 0 && ok > 0;
    const calcScore = hasSufficientEvidence
        ? Math.max(5, 100 - crit * 25 - high * 15 - med * 8 - low * 3)
        : null;

    if (parsed) {
        if (!hasSufficientEvidence) {
            parsed.reliability_score = null;
            parsed.overallStatus = 'insufficient_evidence';
            if (!parsed.summary || parsed.summary.includes('frictionless') || parsed.summary.includes('seamlessly')) {
                parsed.summary = `SENTRA attempted testing on ${discovery?.siteName || url}. However, no interactive user journeys or assertions were successfully executed. Insufficient evidence exists to verify application reliability.`;
            }
        } else if (typeof parsed.reliability_score !== 'number') {
            parsed.reliability_score = calcScore;
        }
        return parsed;
    }

    return {
        summary: hasSufficientEvidence
            ? `We tested ${discovery?.siteName || url} with 6 specialized AI agents. The system completed ${ok} out of ${total} verified steps. ${bugs.length > 0 ? `We identified ${bugs.length} issue(s) that require attention.` : 'No significant issues were detected within the executed test journeys.'}`
            : `Testing on ${discovery?.siteName || url} was interrupted or unable to complete actionable steps. Insufficient evidence to establish reliability.`,
        overallStatus: !hasSufficientEvidence ? 'insufficient_evidence' : (bugs.length === 0 ? 'pass' : crit > 0 ? 'fail' : 'partial'),
        bugs: bugs.map(b => ({
            type: b.type || 'bug',
            title: b.title || b.description?.slice(0, 50) || 'Untitled Issue',
            description: b.description || '',
            page: b.page || b.url || url,
            expected: b.expected || 'Normal behavior',
            actual: b.actual || 'Unexpected behavior',
            severity: b.severity || 'minor',
            agentDomain: b.agentDomain || b.source || 'functional',
            businessImpact: b.businessImpact || 'May affect user experience.',
            reproductionSteps: b.reproductionSteps || [],
            recommendation: `Review and fix: ${b.title || b.type}`,
        })),
        reliability_score: calcScore,
        risk_level: crit > 0 ? 'critical' : high > 0 ? 'high' : bugs.length > 0 ? 'medium' : 'low',
        strengths: ok > 3 ? ['Core navigation flow works', 'Pages load without critical errors'] : ['Site is accessible'],
        recommendations: bugs.map(b => `Fix: ${b.description?.slice(0, 60)}`),
        coverageNotes: `Tested ${[...new Set(bugs.map(b => b.page).filter(Boolean))].length} pages across 6 testing domains.`,
        testingLimitations: ['Authentication-protected flows may not have been tested', 'Performance measurements reflect test environment conditions'],
    };
}

// Legacy alias — keeps backward compatibility with orchestrator
export async function reconSite(url, title, headings, pageText, elements) {
    const result = await runDiscoveryAgent(url, title, headings, pageText, elements);
    // Convert to old format for backward compat
    return {
        siteType: result.siteType || 'other',
        testPlan: [{ step: 'Navigate and explore the site' }],
        checkpoints: [],
        testData: result.testData || {},
        _discovery: result,
    };
}
