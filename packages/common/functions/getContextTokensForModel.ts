const DEFAULT_CONTEXT_TOKENS = 8000;

type ContextTokensMatcher = {
  test: (normalized: string) => boolean;
  tokens: number;
};

const CONTEXT_TOKENS_MAPPING: ContextTokensMatcher[] = [
  { test: (n) => /128k|128000/.test(n), tokens: 128000 },
  { test: (n) => /64k|64000/.test(n), tokens: 64000 },
  { test: (n) => /32k|32000/.test(n), tokens: 32000 },
  { test: (n) => /16k|16000/.test(n), tokens: 16000 },
  { test: (n) => /8k|8000/.test(n), tokens: 8000 },
  { test: (n) => /4k|4000/.test(n), tokens: 4000 },
  { test: (n) => n.includes('gpt-4o-mini'), tokens: 128000 },
  { test: (n) => n.includes('gpt-4o'), tokens: 128000 },
  {
    test: (n) => n.includes('gpt-4.1') || n.includes('gpt-4-turbo'),
    tokens: 128000,
  },
  { test: (n) => n.includes('gpt-4'), tokens: 8000 },
  { test: (n) => n.includes('gpt-3.5'), tokens: 4000 },
  { test: (n) => n.includes('gemini-1.5'), tokens: 1000000 },
  { test: (n) => n.includes('gemini-2'), tokens: 1000000 },
  { test: (n) => n.includes('gemini'), tokens: 32000 },
  {
    test: (n) => n.includes('claude-3-5') || n.includes('claude-3.5'),
    tokens: 200000,
  },
  { test: (n) => n.includes('claude-3'), tokens: 200000 },
  { test: (n) => n.includes('claude-4'), tokens: 200000 },
  { test: (n) => n.includes('llama-3.2'), tokens: 128000 },
  { test: (n) => n.includes('llama-3.1'), tokens: 128000 },
  { test: (n) => n.includes('llama-3'), tokens: 128000 },
];

export function getContextTokensForModel(
  model: string,
  overrideContextTokens?: number | null
): number {
  if (
    overrideContextTokens !== undefined &&
    overrideContextTokens !== null &&
    overrideContextTokens > 0
  ) {
    return overrideContextTokens;
  }

  const normalized = (model || '').toLowerCase();
  for (let i = 0; i < CONTEXT_TOKENS_MAPPING.length; i++) {
    const { test, tokens } = CONTEXT_TOKENS_MAPPING[i];
    if (test(normalized)) {
      return tokens;
    }
  }

  return DEFAULT_CONTEXT_TOKENS;
}
