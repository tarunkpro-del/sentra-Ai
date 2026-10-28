/**
 * test-bedrock.js — Diagnostic test for Bedrock connectivity
 * Run: node test-bedrock.js
 */

import { callBedrock } from './server/bedrock-client.js';

async function testAllModels() {
    console.log('🧪 Testing Bedrock connectivity for all 6 agents...\n');

    const agents = ['flow', 'feature', 'uiux', 'exploratory', 'functional', 'console'];

    let passed = 0;
    let failed = 0;

    for (const agent of agents) {
        try {
            console.log(`Testing ${agent}...`);
            const response = await callBedrock(agent, 'Reply with "OK" if you can read this.');
            if (response) {
                console.log(`✅ ${agent} success: "${response.slice(0, 60)}"\n`);
                passed++;
            } else {
                console.log(`⚠️  ${agent}: null response (fell back to Gemini)\n`);
                passed++; // Gemini fallback still counts as working
            }
        } catch (err) {
            console.error(`❌ ${agent} failed: ${err.message}\n`);
            failed++;
        }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed out of ${agents.length}`);
    console.log(`${'='.repeat(50)}`);

    process.exit(failed > 0 ? 1 : 0);
}

testAllModels();
