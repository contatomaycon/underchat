import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import {
  AI_PROVIDER_DEFAULT_BASE_URLS,
  AiProviderClient,
  AiProviderError,
  type AiProviderClientOptions,
  type AiProviderConfiguration,
  GEMINI_EMBEDDING_DIMENSION,
  normalizeAiProviderBaseUrl,
  normalizeAiProviderHistory,
  normalizeAiProviderModel,
  resolveAiProviderKind,
  validateAiProviderConfiguration,
} from '@core/services/aiProviderClient.service';

const GEMINI_CONFIGURATION: AiProviderConfiguration = {
  provider: EAiAgentType.gemini,
  apiKey: 'test-gemini-key',
  model: 'gemini-2.5-flash',
  embeddingModel: 'gemini-embedding-001',
  baseUrl: 'https://generativelanguage.googleapis.com/v1',
};

const GPT_CONFIGURATION: AiProviderConfiguration = {
  provider: EAiAgentType.gpt,
  apiKey: 'test-openai-key',
  model: 'gpt-5.6',
  baseUrl: 'https://api.openai.com/v1/',
};

const jsonResponse = (
  body: unknown,
  status = 200,
  headers: HeadersInit = {}
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...Object.fromEntries(new Headers(headers).entries()),
    },
  });

const createClient = (
  options: AiProviderClientOptions = {}
): AiProviderClient =>
  new AiProviderClient({
    isProduction: false,
    retryBaseDelayMs: 0,
    maxRetryDelayMs: 0,
    sleep: async () => undefined,
    ...options,
  });

const captureProviderError = async (
  promise: Promise<unknown>
): Promise<AiProviderError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AiProviderError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected AiProviderError');
};

const embeddingVector = (): number[] =>
  Array.from(
    { length: GEMINI_EMBEDDING_DIMENSION },
    (_value, index) => index / GEMINI_EMBEDDING_DIMENSION
  );

describe('AiProviderClient provider and URL contracts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    [EAiAgentType.gpt, 'gpt'],
    ['GPT', 'gpt'],
    ['OpenAI', 'gpt'],
    [EAiAgentType.gemini, 'gemini'],
    ['Gemini', 'gemini'],
    ['Google', 'gemini'],
    [EAiAgentType.deepseek, 'deepseek'],
    ['DeepSeek', 'deepseek'],
    [EAiAgentType.others, 'others'],
    ['Outros', 'others'],
    ['custom', 'others'],
  ] as const)('resolves provider %s as %s', (provider, expected) => {
    expect(resolveAiProviderKind(provider)).toBe(expected);
  });

  it.each([
    ['https://example.test/v1', 'https://example.test/v1beta'],
    ['https://example.test/v1/', 'https://example.test/v1beta'],
    ['https://example.test/v1beta', 'https://example.test/v1beta'],
    ['https://example.test/v1beta/', 'https://example.test/v1beta'],
    ['https://example.test/v1betabeta', 'https://example.test/v1beta'],
    [
      'https://example.test/gateway/v1beta/openai/',
      'https://example.test/gateway/v1beta',
    ],
    ['https://example.test/gateway', 'https://example.test/gateway/v1beta'],
  ])('normalizes Gemini base URL %s', (baseUrl, expected) => {
    expect(
      normalizeAiProviderBaseUrl({
        provider: EAiAgentType.gemini,
        baseUrl,
      })
    ).toBe(expected);
  });

  it('uses canonical defaults and preserves custom OpenAI-compatible paths', () => {
    expect(
      normalizeAiProviderBaseUrl({
        provider: 'GPT',
      })
    ).toBe(AI_PROVIDER_DEFAULT_BASE_URLS.gpt);
    expect(
      normalizeAiProviderBaseUrl({
        provider: 'DeepSeek',
      })
    ).toBe(AI_PROVIDER_DEFAULT_BASE_URLS.deepseek);
    expect(
      normalizeAiProviderBaseUrl({
        provider: 'Outros',
        baseUrl: 'https://gateway.example.test/custom/v1/',
      })
    ).toBe('https://gateway.example.test/custom/v1');
  });

  it('strips repeated Gemini model resource prefixes without renaming the model', () => {
    expect(
      normalizeAiProviderModel({
        provider: 'Gemini',
        model: '/models/models/gemini-embedding-001',
      })
    ).toBe('gemini-embedding-001');
  });

  it('rejects unknown providers and invalid custom base URLs with sanitized errors', () => {
    expect(() => resolveAiProviderKind('unknown-provider')).toThrow(
      expect.objectContaining({
        code: 'invalid_configuration',
      })
    );
    expect(() =>
      normalizeAiProviderBaseUrl({
        provider: 'Outros',
        baseUrl: 'file:///etc/passwd',
      })
    ).toThrow(
      expect.objectContaining({
        code: 'invalid_configuration',
      })
    );
  });
});

describe('normalizeAiProviderHistory', () => {
  it('builds an alternating Gemini history and appends the question once', () => {
    const history = normalizeAiProviderHistory({
      provider: EAiAgentType.gemini,
      excludeMessageId: 'current-message',
      question: 'Pergunta atual',
      history: [
        {
          role: 'assistant',
          content: 'Mensagem de boas-vindas',
        },
        {
          role: 'user',
          content: '   ',
        },
        {
          role: 'user',
          content: 'Primeira parte',
        },
        {
          role: 'user',
          content: 'Segunda parte',
        },
        {
          role: 'assistant',
          content: 'Primeira resposta',
        },
        {
          role: 'model',
          content: 'Complemento da resposta',
        },
        {
          role: 'user',
          content: 'Pergunta atual',
          metadata: {
            messageId: 'current-message',
          },
        },
      ],
    });

    expect(history).toEqual([
      {
        role: 'user',
        content: 'Primeira parte\nSegunda parte',
      },
      {
        role: 'model',
        content: 'Primeira resposta\nComplemento da resposta',
      },
      {
        role: 'user',
        content: 'Pergunta atual',
      },
    ]);
  });

  it('does not duplicate a question already present as the final user message', () => {
    expect(
      normalizeAiProviderHistory({
        provider: 'Gemini',
        question: 'Mensagem repetida',
        history: [
          {
            role: 'assistant',
            content: 'Boas-vindas',
          },
          {
            role: 'user',
            content: 'Mensagem repetida',
          },
        ],
      })
    ).toEqual([
      {
        role: 'user',
        content: 'Mensagem repetida',
      },
    ]);
  });

  it('keeps an initial assistant for OpenAI-compatible providers', () => {
    expect(
      normalizeAiProviderHistory({
        provider: 'DeepSeek',
        question: 'Nova pergunta',
        history: [
          {
            role: 'model',
            content: 'Resposta anterior',
          },
        ],
      })
    ).toEqual([
      {
        role: 'assistant',
        content: 'Resposta anterior',
      },
      {
        role: 'user',
        content: 'Nova pergunta',
      },
    ]);
  });
});

describe('AiProviderClient chat contracts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls native Gemini with canonical URL, key header and system_instruction', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [{ text: 'Resposta Gemini' }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 8,
          candidatesTokenCount: 3,
          totalTokenCount: 11,
        },
      })
    );
    const client = createClient();

    const result = await client.generateChat({
      configuration: {
        ...GEMINI_CONFIGURATION,
        model: 'models/gemini-3.5-flash',
        baseUrl: 'https://generativelanguage.googleapis.com/v1betabeta/openai/',
      },
      systemPrompt: 'Atenda em português.',
      question: 'Olá',
      temperature: 0.7,
      maxOutputTokens: 32,
      history: [
        {
          role: 'assistant',
          content: 'Boas-vindas',
        },
      ],
    });

    expect(result).toMatchObject({
      content: 'Resposta Gemini',
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      usage: {
        inputTokens: 8,
        outputTokens: 3,
        totalTokens: 11,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent'
    );

    const request = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;

    expect(headers.get('x-goog-api-key')).toBe('test-gemini-key');
    expect(headers.get('authorization')).toBeNull();
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('key=');
    expect(body).toMatchObject({
      system_instruction: {
        parts: [{ text: 'Atenda em português.' }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Olá' }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 32,
      },
    });
    expect(body.generationConfig).not.toHaveProperty('temperature');
  });

  it('calls GPT-5.x without temperature and uses max_completion_tokens when requested', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: 'Resposta GPT',
            },
          },
        ],
      })
    );
    const client = createClient();

    const result = await client.generateChat({
      configuration: GPT_CONFIGURATION,
      question: 'Pergunta',
      systemPrompt: 'Sistema',
      temperature: 0.8,
      maxOutputTokens: 50,
    });

    expect(result.content).toBe('Resposta GPT');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.openai.com/v1/chat/completions'
    );

    const request = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;

    expect(headers.get('authorization')).toBe('Bearer test-openai-key');
    expect(body).toMatchObject({
      model: 'gpt-5.6',
      max_completion_tokens: 50,
      messages: [
        {
          role: 'system',
          content: 'Sistema',
        },
        {
          role: 'user',
          content: 'Pergunta',
        },
      ],
    });
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('temperature');
  });

  it('keeps temperature and max_tokens for compatible non-GPT-5 APIs', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: 'Resposta compatível',
            },
          },
        ],
      })
    );
    const client = createClient();

    await client.generateChat({
      configuration: {
        provider: 'Outros',
        apiKey: 'custom-key',
        model: 'custom-model',
        baseUrl: 'https://llm.example.test/v1/',
      },
      question: 'Pergunta',
      temperature: 0.4,
      maxOutputTokens: 25,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://llm.example.test/v1/chat/completions'
    );
    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body.temperature).toBe(0.4);
    expect(body.max_tokens).toBe(25);
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  it('performs a real minimal validation chat without optional generation controls', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: 'OK',
            },
          },
        ],
      })
    );
    const client = createClient();

    const result = await validateAiProviderConfiguration({
      configuration: GPT_CONFIGURATION,
      client,
    });

    expect(result).toMatchObject({
      valid: true,
      provider: 'gpt',
      model: 'gpt-5.6',
    });
    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('max_completion_tokens');
  });
});

describe('AiProviderClient retry and error contracts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([429, 500, 503])(
    'retries retryable HTTP status %s and then succeeds',
    async (status) => {
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          jsonResponse(
            {
              error: 'sensitive-provider-body',
            },
            status,
            status === 429 ? { 'retry-after': '0' } : {}
          )
        )
        .mockResolvedValueOnce(
          jsonResponse({
            choices: [
              {
                message: {
                  content: 'Recuperado',
                },
              },
            ],
          })
        );
      const client = createClient();

      const result = await client.generateChat({
        configuration: GPT_CONFIGURATION,
        question: 'Teste',
      });

      expect(result.content).toBe('Recuperado');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    [401, 'authentication_failed'],
    [402, 'billing_required'],
    [403, 'permission_denied'],
    [404, 'model_or_endpoint_not_found'],
    [422, 'invalid_configuration'],
  ] as const)(
    'does not retry actionable HTTP status %s',
    async (status, code) => {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(
          {
            error: 'test-gemini-key must never leak',
          },
          status
        )
      );
      const client = createClient();

      const error = await captureProviderError(
        client.generateChat({
          configuration: GEMINI_CONFIGURATION,
          question: 'Teste',
        })
      );

      expect(error).toMatchObject({
        code,
        statusCode: status,
        retryable: false,
      });
      expect(error.message).not.toContain('test-gemini-key');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it('classifies Gemini API_KEY_INVALID even when Google returns HTTP 400', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          error: {
            status: 'INVALID_ARGUMENT',
            details: [{ reason: 'API_KEY_INVALID' }],
          },
        },
        400
      )
    );
    const client = createClient();

    const error = await captureProviderError(
      client.generateChat({
        configuration: GEMINI_CONFIGURATION,
        question: 'Teste',
      })
    );

    expect(error).toMatchObject({
      code: 'authentication_failed',
      statusCode: 400,
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 429 caused by exhausted billing quota', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'insufficient_quota',
            type: 'insufficient_quota',
          },
        },
        429
      )
    );
    const client = createClient();

    const error = await captureProviderError(
      client.generateChat({
        configuration: GPT_CONFIGURATION,
        question: 'Teste',
      })
    );

    expect(error).toMatchObject({
      code: 'billing_required',
      statusCode: 429,
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a timeout with a fresh request', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                content: 'Após timeout',
              },
            },
          ],
        })
      );
    const client = createClient({
      timeoutMs: 5,
      maxAttempts: 2,
    });

    const result = await client.generateChat({
      configuration: GPT_CONFIGURATION,
      question: 'Teste timeout',
    });

    expect(result.content).toBe('Após timeout');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).not.toBe(
      fetchMock.mock.calls[1]?.[1]?.signal
    );
  });

  it('retries a real fetch network error and then succeeds', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(
        new TypeError('socket failed with sensitive details')
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                content: 'Recuperado após falha de rede',
              },
            },
          ],
        })
      );
    const client = createClient();

    const result = await client.generateChat({
      configuration: GPT_CONFIGURATION,
      question: 'Teste de rede',
    });

    expect(result.content).toBe('Recuperado após falha de rede');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns a sanitized retryable error after exhausting network retries', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('ECONNRESET with sensitive details'), {
        code: 'ECONNRESET',
      })
    );
    const client = createClient({
      maxAttempts: 2,
    });

    const error = await captureProviderError(
      client.generateChat({
        configuration: GPT_CONFIGURATION,
        question: 'Teste de rede persistente',
      })
    );

    expect(error).toMatchObject({
      code: 'network_error',
      retryable: true,
    });
    expect(error.message).not.toContain('sensitive details');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry an unknown non-network exception', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unexpected implementation failure'));
    const client = createClient();

    const error = await captureProviderError(
      client.generateChat({
        configuration: GPT_CONFIGURATION,
        question: 'Teste de erro desconhecido',
      })
    );

    expect(error).toMatchObject({
      code: 'network_error',
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks metadata/private targets through safe outbound HTTP in production', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const safeOutboundHttpMock = jest.fn().mockResolvedValue({
      kind: 'failure',
      code: 'dns_blocked_address',
      message: 'raw policy detail',
      retryable: false,
      isTimeout: false,
      durationMs: 1,
    });
    const client = new AiProviderClient({
      isProduction: true,
      timeoutMs: 100,
      maxAttempts: 3,
      safeOutboundHttpImpl: safeOutboundHttpMock,
    });

    const error = await captureProviderError(
      client.generateChat({
        configuration: {
          provider: 'Outros',
          apiKey: 'custom-key',
          model: 'custom-model',
          baseUrl: 'https://169.254.169.254',
        },
        question: 'Teste',
      })
    );

    expect(error).toMatchObject({
      code: 'invalid_configuration',
      retryable: false,
    });
    expect(error.message).not.toContain('raw policy detail');
    expect(safeOutboundHttpMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a transient safe-outbound network failure in production', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const safeOutboundHttpMock = jest
      .fn()
      .mockResolvedValueOnce({
        kind: 'failure',
        code: 'network_error',
        message: 'raw socket detail',
        retryable: true,
        isTimeout: false,
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        kind: 'response',
        statusCode: 200,
        headers: {
          'content-type': 'application/json',
        },
        body: Buffer.from(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'Produção recuperada',
                },
              },
            ],
          })
        ),
        finalUrl: 'https://api.example.test/v1/chat/completions',
        redirectCount: 0,
        durationMs: 1,
      });
    const client = new AiProviderClient({
      isProduction: true,
      maxAttempts: 2,
      retryBaseDelayMs: 0,
      maxRetryDelayMs: 0,
      sleep: async () => undefined,
      safeOutboundHttpImpl: safeOutboundHttpMock,
    });

    const result = await client.generateChat({
      configuration: {
        provider: 'Outros',
        apiKey: 'custom-key',
        model: 'custom-model',
        baseUrl: 'https://api.example.test/v1',
      },
      question: 'Teste de rede segura',
    });

    expect(result.content).toBe('Produção recuperada');
    expect(safeOutboundHttpMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AiProviderClient Gemini embedding contracts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses native batch embeddings with exact output dimensionality', async () => {
    const vector = embeddingVector();
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        embeddings: [{ values: vector }, { values: vector }],
      })
    );
    const client = createClient();

    const embeddings = await client.generateGeminiEmbeddings({
      configuration: {
        ...GEMINI_CONFIGURATION,
        embeddingModel: 'models/gemini-embedding-001',
        baseUrl: 'https://generativelanguage.googleapis.com/v1/',
      },
      texts: ['Primeiro texto', 'Segundo texto'],
    });

    expect(embeddings).toHaveLength(2);
    expect(embeddings[0]).toHaveLength(GEMINI_EMBEDDING_DIMENSION);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents'
    );

    const request = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    const body = JSON.parse(String(request?.body)) as {
      requests: Array<{
        model: string;
        outputDimensionality: number;
        content: {
          parts: Array<{
            text: string;
          }>;
        };
      }>;
    };

    expect(headers.get('x-goog-api-key')).toBe('test-gemini-key');
    expect(body.requests).toHaveLength(2);
    expect(body.requests[0]).toEqual({
      model: 'models/gemini-embedding-001',
      content: {
        parts: [{ text: 'Primeiro texto' }],
      },
      outputDimensionality: GEMINI_EMBEDDING_DIMENSION,
    });
  });

  it('rejects an embedding count mismatch', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        embeddings: [{ values: embeddingVector() }],
      })
    );
    const client = createClient();

    const error = await captureProviderError(
      client.generateGeminiEmbeddings({
        configuration: GEMINI_CONFIGURATION,
        texts: ['Primeiro', 'Segundo'],
      })
    );

    expect(error.code).toBe('invalid_response');
    expect(error.message).toContain('quantidade inesperada');
  });

  it.each([
    {
      name: 'wrong dimension',
      values: Array.from({ length: GEMINI_EMBEDDING_DIMENSION - 1 }, () => 0),
    },
    {
      name: 'non-finite value',
      values: [
        ...Array.from({ length: GEMINI_EMBEDDING_DIMENSION - 1 }, () => 0),
        Number.POSITIVE_INFINITY,
      ],
    },
  ])('rejects an embedding with $name', async ({ values }) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        embeddings: [{ values }],
      })
    );
    const client = createClient();

    const error = await captureProviderError(
      client.generateGeminiEmbeddings({
        configuration: GEMINI_CONFIGURATION,
        texts: ['Texto'],
      })
    );

    expect(error.code).toBe('invalid_response');
    expect(error.message).toContain(
      `${GEMINI_EMBEDDING_DIMENSION} números finitos`
    );
  });
});

describe('AiProviderClient OpenAI-compatible embedding contracts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the protected compatible endpoint and restores response index order', async () => {
    const firstVector = embeddingVector();
    const secondVector = embeddingVector().map((value) => value + 1);
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: [
          { index: 1, embedding: secondVector },
          { index: 0, embedding: firstVector },
        ],
      })
    );
    const client = createClient();

    const embeddings = await client.generateOpenAiCompatibleEmbeddings({
      configuration: {
        ...GPT_CONFIGURATION,
        embeddingModel: 'text-embedding-3-small',
      },
      texts: ['Primeiro texto', 'Segundo texto'],
    });

    expect(embeddings).toEqual([firstVector, secondVector]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.openai.com/v1/embeddings'
    );

    const request = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    const body = JSON.parse(String(request?.body)) as {
      model: string;
      input: string[];
      dimensions: number;
    };

    expect(headers.get('authorization')).toBe('Bearer test-openai-key');
    expect(body).toEqual({
      model: 'text-embedding-3-small',
      input: ['Primeiro texto', 'Segundo texto'],
      dimensions: GEMINI_EMBEDDING_DIMENSION,
    });
  });

  it('rejects incompatible vector dimensions instead of mutating vectors', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: [
          {
            index: 0,
            embedding: Array.from(
              { length: GEMINI_EMBEDDING_DIMENSION - 1 },
              () => 0
            ),
          },
        ],
      })
    );
    const client = createClient();

    const error = await captureProviderError(
      client.generateOpenAiCompatibleEmbeddings({
        configuration: {
          ...GPT_CONFIGURATION,
          embeddingModel: 'text-embedding-3-small',
        },
        texts: ['Texto'],
      })
    );

    expect(error.code).toBe('invalid_response');
    expect(error.message).toContain(
      `${GEMINI_EMBEDDING_DIMENSION} números finitos`
    );
  });
});
