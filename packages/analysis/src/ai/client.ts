import type { AIConfig, AIProvider } from '@vitalsage/types';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider }    from './providers/openai.js';
import { GeminiProvider }    from './providers/gemini.js';

export function resolveProvider(config: AIConfig): AIProvider {
  if (typeof config.provider === 'object') {
    return config.provider;
  }

  const providerConfig = {
    apiKey: config.apiKey,
    ...(config.model      ? { model:      config.model      } : {}),
    ...(config.maxTokens  ? { maxTokens:  config.maxTokens  } : {}),
    ...(config.temperature ? { temperature: config.temperature } : {}),
  };

  switch (config.provider) {
    case 'anthropic': return new AnthropicProvider(providerConfig);
    case 'openai':    return new OpenAIProvider(providerConfig);
    case 'gemini':    return new GeminiProvider(providerConfig);
  }
}
