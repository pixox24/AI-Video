import { GoogleGenAI } from "@google/genai";
import { isConfiguredSecret } from "../http";

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!isConfiguredSecret(apiKey)) {
    console.warn("[Gemini API] GEMINI_API_KEY is not set in environment");
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
