// src/services/geminiService.js
import { GEMINI_API_KEY, hasGeminiKey } from '../config/env';
import { stripMarkdown } from '../utils/format';

// Gemini model names change fairly often — check
// https://ai.google.dev/gemini-api/docs/models for the current
// recommended multimodal "flash" model before you ship.
// Overridable via EXPO_PUBLIC_GEMINI_MODEL so a future deprecation
// (like gemini-2.5-flash's early cutoff for new users) doesn't require
// a code change — just update the env var and restart/rebuild.
const GEMINI_MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const AI_REQUEST_TIMEOUT_MS = 20000;

/**
 * Sends a base64 JPEG to Gemini and returns the identified dish name,
 * or null if no dish was recognized.
 * Throws Error('MISSING_KEY') if no API key is configured.
 */
export async function identifyDishFromImage(base64Image) {
  if (!hasGeminiKey()) {
    throw new Error('MISSING_KEY');
  }

  const cleanBase64 = base64Image
    .replace(/^data:image\/\w+;base64,/, '')
    .replace(/[\r\n]+/g, '');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: 'Identify the hawker dish in this photo. Return ONLY the dish name '
                + '(e.g., Hainanese Chicken Rice, Laksa, Nasi Lemak). If no food dish is '
                + 'present, respond strictly with: NO_FOOD',
            },
            { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } },
          ],
        }],
      }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data?.error?.message || `Request failed (${response.status})`);
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (!rawText || rawText.includes('NO_FOOD')) {
      return null;
    }

    return stripMarkdown(rawText);
  } finally {
    clearTimeout(timeout);
  }
}
