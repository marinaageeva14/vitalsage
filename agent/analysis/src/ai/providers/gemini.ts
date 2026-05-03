import type { AIProvider, AIRequest, AIResponse } from '@vitalsage/types';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private apiKey: string;
  private model:  string;

  constructor(config: { apiKey: string; model?: string }) {
    this.apiKey = config.apiKey;
    this.model  = config.model ?? 'gemini-2.0-flash';
  }

  async complete(req: AIRequest): Promise<AIResponse> {
    let attempt = 0;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    while (attempt < 3) {
      try {
        const res = await fetch(url, {
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
        });

        if (res.status === 429) {
          const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 10000);
          await sleep(delay);
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
        if (attempt >= 2) throw err;
        attempt++;
        await sleep(500 * attempt);
      }
    }
    throw new Error('Gemini: max retries exceeded');
  }
}
