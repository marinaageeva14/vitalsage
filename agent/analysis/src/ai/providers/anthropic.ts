import type { AIProvider, AIRequest, AIResponse } from '@vitalsage/types';
import { fetchWithTimeout, rateLimitDelay, sleep, DEFAULT_TIMEOUT_MS, AITimeoutError } from './http.js';

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  private apiKey:    string;
  private model:     string;
  private baseURL:   string;
  private timeoutMs: number;

  constructor(config: { apiKey: string; model?: string; timeoutMs?: number }) {
    this.apiKey    = config.apiKey;
    this.model     = config.model ?? 'claude-sonnet-5';
    this.baseURL   = (process.env['ANTHROPIC_BASE_URL'] ?? 'https://api.anthropic.com').replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async complete(req: AIRequest): Promise<AIResponse> {
    let attempt = 0;
    while (attempt < 3) {
      try {
        const res = await fetchWithTimeout(this.name, `${this.baseURL}/v1/messages`, {
          method:  'POST',
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model:       this.model,
            max_tokens:  req.maxTokens ?? 1024,
            temperature: req.temperature ?? 0.2,
            system:      req.systemPrompt,
            messages:    [{ role: 'user', content: req.userPrompt }],
          }),
        }, this.timeoutMs);

        if (res.status === 429) {
          await sleep(rateLimitDelay(res, attempt));
          attempt++;
          continue;
        }

        if (!res.ok) {
          throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
        }

        const data = await res.json() as { content: Array<{ text: string }>; usage?: { input_tokens?: number; output_tokens?: number }; model: string };
        return {
          content:    data.content[0]!.text,
          provider:   'anthropic',
          model:      this.model,
          tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
        };
      } catch (err) {
        if (attempt >= 2 || err instanceof AITimeoutError) throw err;
        attempt++;
        await sleep(500 * attempt);
      }
    }
    throw new Error('Anthropic: max retries exceeded');
  }
}
