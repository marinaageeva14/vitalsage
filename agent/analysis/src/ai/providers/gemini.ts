import type { AIProvider, AIRequest, AIResponse } from '@vitalsage/types';
import { fetchWithTimeout, rateLimitDelay, sleep, DEFAULT_TIMEOUT_MS, AITimeoutError } from './http.js';

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private apiKey:    string;
  private model:     string;
  private baseURL:   string;
  private timeoutMs: number;

  constructor(config: { apiKey: string; model?: string; timeoutMs?: number }) {
    this.apiKey    = config.apiKey;
    this.model     = config.model ?? 'gemini-2.0-flash';
    this.baseURL   = (process.env['GEMINI_BASE_URL'] ?? 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async complete(req: AIRequest): Promise<AIResponse> {
    let attempt = 0;
    const url = `${this.baseURL}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    while (attempt < 3) {
      try {
        const res = await fetchWithTimeout(this.name, url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: req.systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: req.userPrompt }] }],
            generationConfig: {
              maxOutputTokens: req.maxTokens ?? 1024,
              temperature:     req.temperature ?? 0.2,
            },
          }),
        }, this.timeoutMs);

        if (res.status === 429) {
          await sleep(rateLimitDelay(res, attempt));
          attempt++;
          continue;
        }

        if (!res.ok) {
          throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
        }

        const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }>; usageMetadata?: { totalTokenCount?: number } };
        return {
          content:  data.candidates[0]!.content.parts[0]!.text,
          provider: 'gemini',
          model:    this.model,
          ...(data.usageMetadata?.totalTokenCount !== undefined ? { tokensUsed: data.usageMetadata.totalTokenCount } : {}),
        };
      } catch (err) {
        if (attempt >= 2 || err instanceof AITimeoutError) throw err;
        attempt++;
        await sleep(500 * attempt);
      }
    }
    throw new Error('Gemini: max retries exceeded');
  }
}
