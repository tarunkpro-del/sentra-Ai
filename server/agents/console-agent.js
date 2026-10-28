/**
 * console-agent.js — Agent H: Console & Network Monitor
 *
 * Uses Gemini 2.5 Flash for AI-powered error classification.
 * Listens for:
 *  - JavaScript errors (page.on('console'))
 *  - Failed network requests (page.on('requestfailed'))
 *  - Failed responses (page.on('response') with 4xx/5xx)
 *
 * Must be set up BEFORE navigation and torn down after all agents finish.
 */

import { callGemini } from '../gemini.js';

export function createConsoleAgent(page, sharedBugs, onLog) {
    const log = msg => onLog('H', msg);
    const errors = [];
    const failedRequests = [];

    log('🖥️ Console Agent listening...');

    // Capture JS errors and warnings
    const consoleHandler = msg => {
        const type = msg.type();
        const text = msg.text();

        if (type === 'error') {
            const isNoisy = /favicon|analytics|gtag|ads|tracking|cookie|CORS|ResizeObserver|hydration/i.test(text);
            if (!isNoisy) {
                errors.push({ type: 'js_error', text: text.slice(0, 200), url: page.url() });
                log(`JS Error: ${text.slice(0, 80)}`);
            }
        }
    };

    // Capture failed network requests
    const requestFailedHandler = request => {
        const url = request.url();
        const isNoisy = /analytics|gtag|ads|tracking|favicon|hotjar|intercom/i.test(url);
        if (!isNoisy) {
            failedRequests.push({ url: url.slice(0, 200), failure: request.failure()?.errorText });
            log(`Network failed: ${url.slice(0, 80)}`);
        }
    };

    // Capture 4xx/5xx responses
    const responseHandler = async response => {
        const status = response.status();
        if (status >= 400) {
            const url = response.url();
            const isNoisy = /analytics|gtag|favicon/i.test(url);
            if (!isNoisy) {
                failedRequests.push({ url: url.slice(0, 200), status, failure: `HTTP ${status}` });
            }
        }
    };

    page.on('console', consoleHandler);
    page.on('requestfailed', requestFailedHandler);
    page.on('response', responseHandler);

    // Return a teardown function
    return async function teardown() {
        page.off('console', consoleHandler);
        page.off('requestfailed', requestFailedHandler);
        page.off('response', responseHandler);

        const bugs = [];

        // Report significant JS errors
        const significantErrors = errors.slice(0, 5);
        for (const err of significantErrors) {
            const bug = {
                type: 'js_error',
                severity: 'medium',
                title: 'JavaScript Error Detected',
                description: `A JavaScript error occurred: "${err.text}"`,
                page: err.url,
                expected: 'No JavaScript errors should occur during normal use',
                actual: `Error: ${err.text.slice(0, 100)}`,
                businessImpact: 'JavaScript errors can cause features to stop working for some users.',
                source: 'console-agent',
            };
            bugs.push(bug);
            sharedBugs.push(bug);
        }

        // Report critical network failures (not CDN/tracking)
        const criticalFails = failedRequests.filter(r =>
            /api|data|json|product|bus|search/i.test(r.url)
        ).slice(0, 3);

        for (const fail of criticalFails) {
            const bug = {
                type: 'network_failure',
                severity: 'high',
                title: 'API/Data Request Failed',
                description: `Network request failed: ${fail.url} — ${fail.failure || 'Unknown error'}`,
                page: fail.url,
                expected: 'All API requests should succeed',
                actual: `Request failed with: ${fail.failure || fail.status}`,
                businessImpact: 'Failed API calls can cause missing data or broken features for users.',
                source: 'console-agent',
            };
            bugs.push(bug);
            sharedBugs.push(bug);
        }

        // ── AI Analysis: Use Bedrock (Qwen3 Coder Next) to classify errors ──
        if (errors.length > 0 || criticalFails.length > 0) {
            try {
                const errorSummary = errors.slice(0, 5).map(e => e.text.slice(0, 80)).join('\n');
                const failSummary = criticalFails.map(f => `${f.url.slice(0, 60)}: ${f.failure}`).join('\n');
                const aiPrompt = `Classify these browser errors by severity:\nJS Errors:\n${errorSummary || 'none'}\nNetwork Failures:\n${failSummary || 'none'}\n\nReply with a 1-line summary of the most critical issue, or "OK" if all are benign.`;
                const aiResult = await callGemini(aiPrompt, 'console');
                if (aiResult) {
                    log(`AI error analysis: ${aiResult.slice(0, 100)}`);
                }
            } catch (e) { /* AI classification is supplementary */ }
        }

        log(`Console Agent done. JS errors: ${errors.length}, Failed requests: ${failedRequests.length}, Reported: ${bugs.length}`);
        return { id: 'H', name: 'Console', bugs, stepsCompleted: 1, errorsFound: errors.length, failedRequestsFound: failedRequests.length };
    };
}
