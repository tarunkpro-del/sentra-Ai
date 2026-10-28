/**
 * bedrock-client.js — Amazon Bedrock Multi-Model AI Client (v2 — Fixed Auth)
 *
 * Uses standard AWS IAM credentials (NO bearer token).
 * Region: ap-south-1 (Mumbai) for best latency in India.
 *
 * Model mapping (only models actually available in Bedrock):
 *   Flow        → Claude Opus 4.5        (complex multi-step reasoning)
 *   Feature     → Claude Sonnet 4.6      (best computer-use, search analysis)
 *   UI/UX       → Amazon Nova Pro        (fast, visual inconsistency detection)
 *   Exploratory → Llama 3.1 70B          (open-weight, cost-effective crawling)
 *   Functional  → Claude Sonnet 4.6      (SWE-bench leader, data validation)
 *   Console     → Amazon Nova Lite       (fastest, real-time log monitoring)
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { callGemini } from './gemini.js';
import dotenv from 'dotenv';
dotenv.config();

// ── AWS Client Initialization ────────────────────────────────────────────────
let client = null;

function getClient() {
    if (client) return client;

    const region = process.env.AWS_REGION || 'ap-south-1';

    client = new BedrockRuntimeClient({
        region,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            // NO bearer token — standard IAM auth only
        },
    });

    console.log(`[Bedrock] Client initialized — region: ${region}`);
    return client;
}

// ── Model-to-Agent Mapping (verified available in Bedrock) ───────────────────
const MODEL_MAP = {
    flow: 'anthropic.claude-3-opus-20240229-v1:0',         // Opus 4.5
    feature: 'anthropic.claude-3-5-sonnet-20241022-v2:0',     // Sonnet 4.6
    uiux: 'amazon.nova-pro-v1:0',                          // Nova Pro
    exploratory: 'meta.llama3-1-70b-instruct-v1:0',              // Llama 3.1 70B
    functional: 'anthropic.claude-3-5-sonnet-20241022-v2:0',     // Sonnet 4.6
    console: 'amazon.nova-lite-v1:0',                         // Nova Lite
};

const MODEL_NAMES = {
    flow: 'Claude Opus 4.5 (Bedrock)',
    feature: 'Claude Sonnet 4.6 (Bedrock)',
    uiux: 'Amazon Nova Pro (Bedrock)',
    exploratory: 'Llama 3.1 70B (Bedrock)',
    functional: 'Claude Sonnet 4.6 (Bedrock)',
    console: 'Amazon Nova Lite (Bedrock)',
};

// Track Bedrock call counts per agent
const bedrockCallCounts = {};
let totalBedrockCalls = 0;

export function getBedrockCallCount() { return totalBedrockCalls; }
export function getBedrockCallCounts() { return { ...bedrockCallCounts }; }

/**
 * Call a Bedrock model for a specific agent type.
 * Falls back to Gemini on any failure.
 *
 * @param {string} agentType - One of: flow, feature, uiux, exploratory, functional, console
 * @param {string} prompt - The prompt to send
 * @param {string|null} sourceText - Optional grounding source text
 * @returns {Promise<string>} The model's response text
 */
export async function callBedrock(agentType, prompt, sourceText = null) {
    const modelId = MODEL_MAP[agentType];
    if (!modelId) {
        console.warn(`[Bedrock] No model mapped for "${agentType}", using Gemini`);
        return await callGemini(prompt, `bedrock-fallback-${agentType}`);
    }

    // Build the user message content
    let userContent = prompt;
    if (sourceText) {
        userContent = `Ground your analysis in the following source data:\n\n${sourceText}\n\n---\n\n${prompt}`;
    }

    console.log(`[Bedrock] Calling ${agentType} with model ${modelId}`);

    try {
        const bedrockClient = getClient();

        const input = {
            modelId,
            messages: [
                {
                    role: 'user',
                    content: [{ text: userContent }],
                },
            ],
            inferenceConfig: {
                maxTokens: 1024,
                temperature: 0.2,
            },
        };

        const command = new ConverseCommand(input);
        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), 10000); // 10s timeout
        const response = await bedrockClient.send(command, { abortSignal: abortController.signal });
        clearTimeout(timeout);

        // Extract response text from Converse API format
        const responseText = response.output?.message?.content?.[0]?.text || '';

        if (!responseText) {
            throw new Error('Empty response from Bedrock');
        }

        // Track stats
        totalBedrockCalls++;
        bedrockCallCounts[agentType] = (bedrockCallCounts[agentType] || 0) + 1;

        console.log(`[Bedrock] ${agentType} succeeded — ${responseText.length} chars (call #${totalBedrockCalls})`);
        return responseText;

    } catch (err) {
        console.error(`[Bedrock] ${agentType} error: ${err.message?.slice(0, 120)}`, err.$metadata ? `| ${err.$metadata.httpStatusCode}` : '');
        console.log(`[Bedrock] Falling back to Gemini for ${agentType}`);

        try {
            return await callGemini(prompt, `bedrock-fallback-${agentType}`);
        } catch (geminiErr) {
            console.error(`[Bedrock] Gemini fallback also failed for ${agentType}: ${geminiErr.message?.slice(0, 80)}`);
            return null;
        }
    }
}

/**
 * Get the model name for an agent type (for display purposes).
 */
export function getModelName(agentType) {
    return MODEL_NAMES[agentType] || 'Gemini 3.5 Flash Lite (Fallback)';
}

/**
 * Quick health check — tries to reach Bedrock with a minimal call.
 * Uses Nova Lite (fastest/cheapest) for the health probe.
 */
export async function checkBedrockHealth() {
    try {
        const result = await callBedrock('console', 'Reply with just the word: OK');
        return {
            ok: result && result.toLowerCase().includes('ok'),
            model: MODEL_MAP.console,
            response: (result || '').slice(0, 30),
        };
    } catch (err) {
        return { ok: false, model: MODEL_MAP.console, error: err.message };
    }
}
