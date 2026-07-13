import type { AIProvider, AIRequest, AIResponse } from '@vitalsage/types';
import { fetchWithTimeout, rateLimitDelay, sleep, DEFAULT_TIMEOUT_MS, AITimeoutError } from './http.js';

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  private apiKey:    string;
  private model:     string;
  private baseURL:   string;
  private timeoutMs: number;

  constructor(config: { apiKey: string; model?: string; timeoutMs?: number }) {
    this.apiKey    = config.apiKey;
    this.model     = config.model ?? 'gpt-4o';
    this.baseURL   = (process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async complete(req: AIRequest): Promise<AIResponse> {
    let attempt = 0;
    let lastStatus: number | undefined;
    while (attempt < 3) {
      try {
        const res = await fetchWithTimeout(this.name, `${this.baseURL}/chat/completions`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model:       this.model,
            max_tokens:  req.maxTokens ?? 1024,
            temperature: req.temperature ?? 0.2,
            messages: [
              { role: 'system', content: req.systemPrompt },
              { role: 'user',   content: req.userPrompt },
            ],
          }),
        }, this.timeoutMs);

        if (res.status === 429) {
          lastStatus = 429;
          await sleep(rateLimitDelay(res, attempt));
          attempt++;
          continue;
        }

        if (!res.ok) {
          throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
        }

        const data = await res.json() as { choices: Array<{ message: { content: string } }>; usage?: { total_tokens?: number }; model: string };
        return {
          content:  data.choices[0]!.message.content,
          provider: 'openai',
          model:    this.model,
          ...(data.usage?.total_tokens !== undefined ? { tokensUsed: data.usage.total_tokens } : {}),
        };
      } catch (err) {
        // A timeout on the last attempt (or repeatedly) should surface as-is.
        if (attempt >= 2 || err instanceof AITimeoutError) throw err;
        attempt++;
        await sleep(500 * attempt);
      }
    }
    throw new Error(
      lastStatus === 429
        ? 'OpenAI: rate limited (HTTP 429) on all 3 attempts — provider is throttling this key'
        : 'OpenAI: max retries exceeded'
    );
  }
}
