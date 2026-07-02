import type { AIProvider, AIRequest, AIResponse } from '@vitalsage/types';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  private apiKey:  string;
  private model:   string;
  private baseURL: string;

  constructor(config: { apiKey: string; model?: string }) {
    this.apiKey  = config.apiKey;
    this.model   = config.model ?? 'gpt-4o';
    this.baseURL = (process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  }

  async complete(req: AIRequest): Promise<AIResponse> {
    let attempt = 0;
    while (attempt < 3) {
      try {
        const res = await fetch(`${this.baseURL}/chat/completions`, {
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
        });

        if (res.status === 429) {
          const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 10000);
          await sleep(delay);
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
        if (attempt >= 2) throw err;
        attempt++;
        await sleep(500 * attempt);
      }
    }
    throw new Error('OpenAI: max retries exceeded');
  }
}
