// src/config/env.js
// Single source of truth for reading environment variables.
// Keeping this in one file means if you ever rename the variable,
// or add a fallback/remote-config source, you only change it here.

export const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

export function hasGeminiKey() {
  return Boolean(GEMINI_API_KEY);
}
