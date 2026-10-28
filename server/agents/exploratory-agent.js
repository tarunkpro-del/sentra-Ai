/**
 * exploratory-agent.js — Agent F: Link & Interaction Explorer
 *
 * Pure rule-based — no LLM needed.
 * Clicks all primary CTA links and nav links, checks for 404s and dead ends.
 * Uses safeNavigate for automatic 404 detection and bug reporting.
 */

import { safeNavigate } from '../safe-navigate.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SKIP_PATTERNS = /logout|signout|delete|remove|clear|pay|purchase|subscribe|external|mailto:|tel:/i;
const MAX_LINKS = 10;

export async function runExploratoryAgent(page, baseUrl, sharedBugs, onLog) {
    const log = msg => onLog('F', msg);
    log('🔍 Exploratory Agent starting...');
    const bugs = [];
    const visited = new Set([baseUrl]);

    try {
        // Go back to base URL
        if (page.url() !== baseUrl) {
            await safeNavigate(page, baseUrl, {
                timeout: 30000,
                bugList: bugs,
                log,
                source: 'exploratory-agent',
            });
            await sleep(1500);
        }

        // Gather nav links
        const navLinks = await page.evaluate((base) => {
            const links = [];
            const els = document.querySelectorAll('nav a, header a, [class*="nav"] a, [class*="menu"] a, footer a');
            for (const el of els) {
                const href = el.href;
                if (href && href.startsWith(base) && !links.includes(href) && links.length < 12) {
                    links.push(href);
                }
            }
            return links;
        }, new URL(baseUrl).origin);

        // Also gather body links (product links, etc.)
        const bodyLinks = await page.evaluate((base) => {
            const links = [];
            document.querySelectorAll('a[href]').forEach(el => {
                const href = el.href;
                if (href && href.startsWith(base) && !links.includes(href) && links.length < 10) {
                    links.push(href);
                }
            });
            return links;
        }, new URL(baseUrl).origin);

        const allLinks = [...new Set([...navLinks, ...bodyLinks])];
        log(`Found ${allLinks.length} links to explore (${navLinks.length} nav + body links)`);

        for (const link of allLinks.slice(0, MAX_LINKS)) {
            if (visited.has(link)) continue;
            if (SKIP_PATTERNS.test(link)) { log(`Skipping: ${link.slice(0, 50)}`); continue; }
            visited.add(link);

            try {
                const result = await safeNavigate(page, link, {
                    timeout: 15000,
                    bugList: bugs,
                    log,
                    source: 'exploratory-agent',
                });
                await sleep(800);

                if (!result.ok) {
                    // Bug was already pushed by safeNavigate
                    // Also push to sharedBugs
                    const newBugs = bugs.filter(b => b.page === link && !sharedBugs.some(sb => sb.page === link && sb.type === b.type));
                    for (const b of newBugs) sharedBugs.push(b);
                    log(`🐛 Broken: ${link.slice(0, 60)} (${result.status})`);
                } else {
                    log(`OK: ${link.slice(0, 60)}`);
                }
            } catch (e) {
                log(`Link error: ${link.slice(0, 50)} — ${e.message?.slice(0, 40)}`);
            }
        }

        // Go back to base
        await safeNavigate(page, baseUrl, { timeout: 15000, log, source: 'exploratory-agent' });

    } catch (e) {
        log(`Exploratory agent error: ${e.message}`);
    }

    log(`Exploratory Agent done. Pages checked: ${visited.size}, Bugs: ${bugs.length}`);
    return { id: 'F', name: 'Exploratory', bugs, stepsCompleted: visited.size };
}
