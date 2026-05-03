import type { AIProvider, AIRequest, AIResponse } from '@vitalsage/types';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  private apiKey: string;
  private model:  string;

  constructor(config: { apiKey: string; model?: string }) {
    this.apiKey = config.apiKey;
    this.model  = config.model ?? 'claude-sonnet-4-20250514';
  }

  async complete(req: AIRequest): Promise<AIResponse> {
    let attempt = 0;
    while (attempt < 3) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
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
        });

        if (res.status === 429) {
          const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 10000);
          await sleep(delay);
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
        if (attempt >= 2) throw err;
        attempt++;
        await sleep(500 * attempt);
      }
    }
    throw new Error('Anthropic: max retries exceeded');
  }
}
