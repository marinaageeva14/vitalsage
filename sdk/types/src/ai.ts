export interface AIRequest {
  systemPrompt: string;
  userPrompt:   string;
  maxTokens?:   number;
  temperature?: number;
}

export interface AIResponse {
  content:     string;
  provider:    string;
  model:       string;
  tokensUsed?: number;
}

export interface AIProvider {
  readonly name: string;
  complete(request: AIRequest): Promise<AIResponse>;
}
