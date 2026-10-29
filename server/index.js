import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import http from 'http';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

import { runOrchestrator } from './orchestrator.js';
import { GEMINI_MODEL, getAICallCount, callGemini } from './gemini.js';

// Prevent server crashes from unhandled errors (e.g. Playwright browser failures)
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT]', err.message || err);
});
process.on('unhandledRejection', (err) => {
    console.error('[UNHANDLED]', err?.message || err);
});

const PORT = 3001;
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Session store
const sessions = new Map();

// ── SSE connections ──
const sseClients = new Map(); // sessionId → Set<res>

function addEvent(session, type, message, data = {}) {
    const event = { type, message, timestamp: Date.now(), ...data };
    session.events.push(event);

    // Push to all SSE clients for this session
    const clients = sseClients.get(session.id);
    if (clients) {
        const payload = `data: ${JSON.stringify(event)}\n\n`;
        for (const res of clients) {
            try { res.write(payload); } catch { clients.delete(res); }
        }
    }
}

// ── URL Validator: supports localhost + public URLs ─────────────────────────
function validateTestUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return { ok: false, error: 'Invalid URL format. Please include http:// or https://' };
    }

    const protocol = parsed.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
        return { ok: false, error: 'Only http:// and https:// URLs are supported.' };
    }

    const host = parsed.hostname.toLowerCase();

    // Allow local targets explicitly
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
        host.endsWith('.local') || host.startsWith('192.168.') ||
        host.startsWith('10.') || host.startsWith('172.');

    // Block cloud metadata and internal services
    if (host === '169.254.169.254' || host === 'metadata.google.internal') {
        return { ok: false, error: 'Cloud metadata endpoints are not permitted.' };
    }

    return { ok: true, isLocal, parsed };
}

// ── Check if target URL is actually reachable ────────────────────────────────
function checkUrlReachable(url, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.request({
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname || '/',
            method: 'HEAD',
            timeout: timeoutMs,
        }, (res) => {
            resolve({ ok: true, status: res.statusCode });
            req.destroy();
        });
        req.on('error', (e) => resolve({ ok: false, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Connection timed out' }); });
        req.end();
    });
}

// ── Sanitize screenshot filename (path-traversal protection) ─────────────────
function sanitizeFilename(raw) {
    return String(raw || '').replace(/[^a-zA-Z0-9._\-]/g, '_').slice(0, 120);
}

// ── Prevent recursive self-test loops ────────────────────────────────────────
const SELF_URLS = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
let activeSelfTestCount = 0;
const MAX_SELF_TESTS = 1;

// ── API: Health check ──
app.get('/api/health', (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY || '';
    const aiConfigured = apiKey.length > 10 && !apiKey.includes('your_gemini');
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        aiConfigured,
        team: 'ZYPHER',
        teamLead: 'Tarun Kumar',
        primaryAI: GEMINI_MODEL,
        architecture: 'sentra-multi-agent-v3',
        localTestingSupported: true,
        agents: [
            { id: 'A', name: 'Discovery Agent', role: 'Site exploration & test planning', model: GEMINI_MODEL },
            { id: 'B', name: 'Orchestrator', role: 'Mission dispatch & coordination', model: GEMINI_MODEL },
            { id: 'C', name: 'Navigation & Exploration', role: 'Routes, menus, redirects & page discovery', model: GEMINI_MODEL },
            { id: 'D', name: 'UI & Interactive Controls', role: 'Buttons, tabs, dropdowns & state changes', model: GEMINI_MODEL },
            { id: 'E', name: 'Forms & Input Validation', role: 'Input fields, auth & boundary validation', model: GEMINI_MODEL },
            { id: 'F', name: 'Core Workflow & E-Commerce', role: 'End-to-end cart, checkout & user journeys', model: GEMINI_MODEL },
            { id: 'G', name: 'Business Logic & Domain Testing', role: 'Seat selection, calculations & rules', model: GEMINI_MODEL },
            { id: 'H', name: 'Defect Verification & Evidence', role: 'Assertion checks, bug reproduction & evidence capture', model: GEMINI_MODEL },
        ],
        geminiCalls: getAICallCount(),
        activeSessions: sessions.size,
    });
});

// ── Session cleanup (keep last 20) ──
setInterval(() => {
    if (sessions.size > 20) {
        const oldest = [...sessions.keys()].slice(0, sessions.size - 20);
        for (const id of oldest) { sessions.delete(id); sseClients.delete(id); }
        console.log(`[Cleanup] Removed ${oldest.length} old sessions`);
    }
}, 5 * 60 * 1000);

// ── API: Start test ──
app.post('/api/start-test', async (req, res) => {
    const { url, prdText, userInstructions } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = 'https://' + targetUrl;
    }

    // Validate URL
    const validation = validateTestUrl(targetUrl);
    if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
    }

    // Prevent recursive self-test: don't allow testing Sentra's own backend port unless it's a deliberate self-test
    const isSelfTest = SELF_URLS.some(u => targetUrl.startsWith(u));
    if (isSelfTest) {
        if (activeSelfTestCount >= MAX_SELF_TESTS) {
            return res.status(429).json({
                error: 'A Sentra self-test is already running. Please wait for it to complete to avoid recursive test loops.'
            });
        }
        console.log('[Self-test] Sentra self-test mode activated');
    }

    // Check reachability before starting agents (skip for cloud URLs that may block HEAD)
    if (validation.isLocal) {
        const reachable = await checkUrlReachable(targetUrl, 6000);
        if (!reachable.ok) {
            return res.status(400).json({
                error: `Cannot reach ${targetUrl}: ${reachable.error}. Make sure the server is running before starting a test.`
            });
        }
        console.log(`[Reachability] ${targetUrl} → HTTP ${reachable.status}`);
    }

    const sessionId = `session-${Date.now()}`;
    const screenshotDir = join(__dirname, '..', 'screenshots', sessionId);
    if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });

    const session = {
        id: sessionId,
        url: targetUrl,
        startTime: Date.now(),
        events: [],
        report: null,
        screenshotDir,
        screenshots: {},
        prdText: prdText || '',
        userInstructions: userInstructions || '',
        isSelfTest,
    };
    sessions.set(sessionId, session);

    if (isSelfTest) activeSelfTestCount++;

    res.json({ sessionId, status: 'started', isLocal: validation.isLocal, isSelfTest });

    // Run orchestrator in background
    console.log(`\n[${sessionId}] Starting multi-agent test: ${targetUrl}${validation.isLocal ? ' [LOCAL]' : ''}${isSelfTest ? ' [SELF-TEST]' : ''}`);
    runOrchestrator(targetUrl, session, addEvent).catch(err => {
        console.error(`[${sessionId}] Fatal error:`, err);
        addEvent(session, 'error', `Fatal: ${err.message}`);
        addEvent(session, 'complete', 'Test finished with errors');
    }).finally(() => {
        if (isSelfTest) activeSelfTestCount = Math.max(0, activeSelfTestCount - 1);
    });
});

// ── API: SSE events stream ──
app.get('/api/events/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });

    // Send existing events
    for (const event of session.events) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    // Register for future events
    if (!sseClients.has(session.id)) sseClients.set(session.id, new Set());
    sseClients.get(session.id).add(res);

    req.on('close', () => {
        const clients = sseClients.get(session.id);
        if (clients) clients.delete(res);
    });
});

// ── API: Get report ──
app.get('/api/report/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.report) return res.json({ report: null, status: 'in_progress' });
    res.json({ report: session.report });
});

// ── API: Screenshot (path-traversal safe & resilient to restarts) ──
app.get('/api/screenshot/:sessionId/:filename', (req, res) => {
    const rawSessionId = req.params.sessionId;
    const safeSessionId = sanitizeFilename(rawSessionId);
    const safeFilename = sanitizeFilename(req.params.filename);

    if (!safeSessionId || !safeFilename) return res.status(400).end();

    const session = sessions.get(rawSessionId);

    // 1. Try in-memory buffer first
    if (session?.screenshots && session.screenshots[safeFilename]) {
        res.set('Content-Type', 'image/png');
        return res.send(session.screenshots[safeFilename]);
    }

    // 2. Try session's configured directory
    if (session?.screenshotDir) {
        const filePath = join(session.screenshotDir, safeFilename);
        if (existsSync(filePath)) {
            return res.sendFile(filePath);
        }
    }

    // 3. Fallback to disk directory by safeSessionId (survives restarts)
    const diskPath = join(__dirname, '..', 'screenshots', safeSessionId, safeFilename);
    if (existsSync(diskPath)) {
        return res.sendFile(diskPath);
    }

    // 4. Return clean 404 with JSON rather than unhandled crash
    res.status(404).json({ error: 'Screenshot not found' });
});

// ── API: Live browser screenshot (polling-based virtual browser view) ──
app.get('/api/live-screenshot/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).end();
    // Return the most recent screenshot
    const latestScreenshot = session.latestScreenshot;
    if (latestScreenshot) {
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'no-cache, no-store');
        return res.send(latestScreenshot);
    }
    res.status(204).end(); // No screenshot yet
});

// ── Static files (production) ──
const distPath = join(__dirname, '..', 'dist');
if (existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
        res.sendFile(join(distPath, 'index.html'));
    });
}

app.listen(PORT, async () => {
    console.log('');
    console.log(`🛡️  SENTRA — Autonomous AI QA Platform (Team ZYPHER)`);
    console.log(`   URL:      http://localhost:${PORT}`);
    console.log(`   Health:   http://localhost:${PORT}/api/health`);
    console.log(`   AI:       ${GEMINI_MODEL}`);
    console.log(`   Mode:     Discovery → Orchestration → 6 Parallel Agents → Report`);
    console.log(`   Agents:   UI & Responsiveness | Core User Flow | Security`);
    console.log(`             Performance & Speed | Edge Case & Failure | Functional & Business Logic`);
    console.log(`   Local:    ✅ localhost and 127.0.0.1 URLs supported`);
    console.log(`   Safety:   300k token budget, ${15} step limit, 150s agent timeout`);
    console.log('');

    // Quick AI health check on startup
    try {
        const reply = await callGemini('Reply with just the word: OK', 'health-check', { throwOnError: true });
        if (reply && reply.trim().toUpperCase().startsWith('OK')) {
            console.log(`   Gemini:    ✅ Responding — "${reply.trim()}"`);
        } else {
            console.log(`   Gemini:    ⚠ Unexpected health response — "${reply?.slice(0, 60)}"`);
        }
    } catch (err) {
        console.error('Gemini health check failed:', err.message);
        console.log(`   Gemini:    ❌ ${err.message || err}`);
    }
    console.log('');
});
