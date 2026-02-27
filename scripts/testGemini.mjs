import { parseMealIntent } from '../src/lib/geminiService.js';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local for Node testing
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function runTests() {
    console.log("Testing Gemini Intent Parser...\\n");

    const inputs = [
        "I had 3 scrambled eggs with two slices of brown bread, and a coffee.",
        "I'm exhausted, give me something really easy for dinner.",
        "I ate out at a Mexican restaurant tonight."
    ];

    for (const input of inputs) {
        console.log(`--- INPUT: "${input}" ---`);
        try {
            const result = await parseMealIntent(input, { slot: 'lunch' });
            console.log(JSON.stringify(result, null, 2));
        } catch (e) {
            console.error("FAILED:", e.message);
        }
        console.log("\\n");
    }
}

runTests();
