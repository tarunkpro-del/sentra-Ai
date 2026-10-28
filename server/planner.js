/**
 * Planner — Agent B.
 * Reads Agent A's full site analysis, then generates a tailored SYSTEM ROLE for each worker.
 * Workers use these roles as their identity and purpose throughout their run.
 */
import { generateAgentRoles } from './gemini.js';

const WORKER_IDS = ['C', 'D', 'E', 'F', 'G', 'H'];

export async function runPlanner(siteContext, onRoleReady, onStatus) {
    onStatus('thinking', 'Reading site analysis and generating agent roles...');

    // One AI call — generate a system role for each agent based on site context
    const roles = await generateAgentRoles(siteContext);

    onStatus('executing', `Generated roles for ${Object.keys(roles).length} agents. Dispatching...`);

    // Emit roles one-by-one with stagger for stability
    for (let i = 0; i < WORKER_IDS.length; i++) {
        const wId = WORKER_IDS[i];
        const role = roles[wId];
        if (!role) continue;
        await new Promise(r => setTimeout(r, 1000));
        await onRoleReady(wId, role, siteContext);
    }

    onStatus('done', `Dispatched ${WORKER_IDS.length} agents`);
    return roles;
}
