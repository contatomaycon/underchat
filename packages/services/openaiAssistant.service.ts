import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { IOpenAIHeaders } from '@core/common/interfaces/IOpenAIHeaders';
import { withLock } from '@core/common/functions/withLock';
import { AiAgentService } from './aiAgent.service';

@injectable()
export class OpenAIAssistantService {
  private readonly THREAD_CACHE_TTL_SECONDS = 86400;
  private readonly RUN_POLL_INTERVAL_MS = 1000;
  private readonly RUN_MAX_POLL_ATTEMPTS = 120;
  private readonly VECTOR_STORE_FILE_POLL_INTERVAL_MS = 2000;
  private readonly VECTOR_STORE_FILE_MAX_POLL_ATTEMPTS = 120;
  private readonly UNSUPPORTED_MODEL_CACHE_TTL_SECONDS = 86400;
  private readonly DEFAULT_ASSISTANT_INSTRUCTIONS = [
    'Você é um assistente virtual inteligente, prestativo e rigoroso.',
    '',
    '### INSTRUÇÕES CRÍTICAS DE CONTEXTO:',
    '- Você DEVE ler, absorver e internalizar TODAS as instruções que receber. Nada pode ser ignorado.',
    '- Documentos e arquivos do agente estão disponíveis via File Search. Consulte a ferramenta sempre que necessário.',
    '- Combine TODAS as fontes de conhecimento disponíveis: prompts de texto, resultados do File Search, contexto RAG e histórico do thread.',
    '- Use apenas o contexto disponível para responder. Não invente informações que não estejam no contexto.',
    '- Quando houver contexto suficiente, seja completo e útil, trazendo detalhes, exemplos e informações relevantes.',
    '- Se a pergunta estiver fora do escopo do contexto, informe isso de forma breve e redirecione para os temas em que você pode ajudar.',
    '- Quando houver múltiplas opções ou alternativas, recomende a melhor e explique rapidamente o porquê.',
    '- Responda de forma natural e humana, sem mencionar termos técnicos como "contexto", "prompt", "RAG", "sistema" ou "file_search".',
    '',
    '### DIRETRIZES DE RESPOSTA:',
    '- Siga o perfil, personalidade e objetivos definidos nas instruções do agente.',
    '- Priorize precisão e consistência com todas as regras fornecidas.',
    '- Evite respostas vagas; foque em resolver a necessidade do usuário.',
    '- Se a pergunta for repetida, evite repetir a mesma estrutura de resposta e traga novos detalhes quando possível.',
  ].join('\n');

  constructor(
    @inject('Redis') private readonly redis: Redis,
    private readonly aiAgentService: AiAgentService
  ) {}

  private buildHeaders(apiKey: string): IOpenAIHeaders {
    return {
      Authorization: `Bearer ${apiKey}`,
      'OpenAI-Beta': 'assistants=v2',
      'Content-Type': 'application/json',
    };
  }

  private buildResponsesApiHeaders(apiKey: string): IOpenAIHeaders {
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '');
  }

  getDefaultAssistantInstructions(): string {
    return this.DEFAULT_ASSISTANT_INSTRUCTIONS;
  }

  private buildBlobFromBuffer(fileBuffer: Buffer | ArrayBuffer): Blob {
    const arrayBuffer =
      fileBuffer instanceof Buffer
        ? (() => {
            const buffer = new ArrayBuffer(fileBuffer.byteLength);
            new Uint8Array(buffer).set(fileBuffer);
            return buffer;
          })()
        : fileBuffer;
    const blobPart = new Uint8Array(arrayBuffer);

    return new Blob([blobPart], {
      type: 'application/octet-stream',
    });
  }

  private getUnsupportedModelCacheKey(
    accountId: string,
    baseUrl: string,
    model: string
  ): string {
    return `openai:assistants:unsupported:${accountId}:${this.normalizeBaseUrl(baseUrl)}:${model}`;
  }

  private isUnsupportedModelError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const message =
      'message' in error && typeof error.message === 'string'
        ? error.message
        : '';

    return (
      message.includes('unsupported_model') ||
      message.includes('cannot be used with the Assistants API')
    );
  }

  async ensureAssistant(
    aiAgentId: string,
    accountId: string,
    apiKey: string,
    baseUrl: string,
    model: string,
    instructions: string,
    vectorStoreId?: string | null
  ): Promise<string | null> {
    const lockKey = `openai:assistant:${accountId}:${aiAgentId}`;
    return withLock(this.redis, lockKey, async () => {
      const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
      if (agent?.openai_assistant_id) {
        return agent.openai_assistant_id;
      }

      const unsupportedCacheKey = this.getUnsupportedModelCacheKey(
        accountId,
        baseUrl,
        model
      );
      const isUnsupported = await this.redis.get(unsupportedCacheKey);
      if (isUnsupported === 'true') {
        return null;
      }

      let assistantId: string;
      try {
        assistantId = await this.createAssistant(
          apiKey,
          baseUrl,
          model,
          instructions,
          vectorStoreId
        );
      } catch (error) {
        if (this.isUnsupportedModelError(error)) {
          await this.redis.set(
            unsupportedCacheKey,
            'true',
            'EX',
            this.UNSUPPORTED_MODEL_CACHE_TTL_SECONDS
          );
          console.warn(
            `OpenAI Assistants: model "${model}" não suporta Assistants API.`
          );
          return null;
        }
        throw error;
      }

      await this.aiAgentService.updateAiAgentOpenAIIds(aiAgentId, accountId, {
        openai_assistant_id: assistantId,
      });

      return assistantId;
    });
  }

  private async createAssistant(
    apiKey: string,
    baseUrl: string,
    model: string,
    instructions: string,
    vectorStoreId?: string | null
  ): Promise<string> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/assistants`;

    const body: Record<string, unknown> = {
      model,
      instructions,
      tools: [{ type: 'file_search' }],
    };

    if (vectorStoreId) {
      body.tool_resources = {
        file_search: {
          vector_store_ids: [vectorStoreId],
        },
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI Assistants API error (create assistant): ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as { id: string };
    return data.id;
  }

  async createResponseWithFileSearch(
    apiKey: string,
    baseUrl: string,
    model: string,
    instructions: string,
    userQuery: string,
    vectorStoreId: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{
    text: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    latency_ms?: number;
  }> {
    const startMs = Date.now();
    const url = `${this.normalizeBaseUrl(baseUrl)}/responses`;

    const input =
      history && history.length > 0
        ? [
            ...history.map((msg) => ({
              role: msg.role as 'user' | 'assistant',
              content: msg.content,
            })),
            { role: 'user' as const, content: userQuery },
          ]
        : userQuery;

    const body = {
      model,
      instructions,
      input,
      tools: [
        {
          type: 'file_search',
          vector_store_ids: [vectorStoreId],
        },
      ],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildResponsesApiHeaders(apiKey),
      body: JSON.stringify(body),
    });

    const latency_ms = Date.now() - startMs;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI Responses API error (file search): ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as {
      output?: Array<{
        type?: string;
        role?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
    };

    const output = data.output;
    const text = this.extractResponseTextFromOutput(output);

    const usage = data.usage
      ? {
          prompt_tokens: data.usage.input_tokens ?? 0,
          completion_tokens: data.usage.output_tokens ?? 0,
          total_tokens: data.usage.total_tokens ?? 0,
        }
      : undefined;

    return { text, usage, latency_ms };
  }

  private extractResponseTextFromOutput(
    output:
      | Array<{
          type?: string;
          role?: string;
          content?: Array<{ type?: string; text?: string }>;
        }>
      | undefined
  ): string {
    const defaultText = 'Desculpe, não consegui processar sua solicitação.';
    if (!Array.isArray(output)) {
      return defaultText;
    }
    for (let i = output.length - 1; i >= 0; i -= 1) {
      const item = output[i];
      if (
        item?.type !== 'message' ||
        item?.role !== 'assistant' ||
        !item?.content
      ) {
        continue;
      }
      for (const part of item.content) {
        if (part?.type === 'output_text' && typeof part.text === 'string') {
          return part.text;
        }
      }
    }
    return defaultText;
  }

  async updateAssistantInstructions(
    assistantId: string,
    apiKey: string,
    baseUrl: string,
    instructions: string
  ): Promise<void> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/assistants/${encodeURIComponent(assistantId)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify({ instructions }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI Assistants API error (update assistant): ${response.status} - ${errorText}`
      );
    }
  }

  async updateAssistantVectorStore(
    assistantId: string,
    apiKey: string,
    baseUrl: string,
    vectorStoreId: string
  ): Promise<void> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/assistants/${encodeURIComponent(assistantId)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify({
        tool_resources: {
          file_search: {
            vector_store_ids: [vectorStoreId],
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI Assistants API error (update vector store): ${response.status} - ${errorText}`
      );
    }
  }

  async ensureVectorStore(
    aiAgentId: string,
    accountId: string,
    apiKey: string,
    baseUrl: string
  ): Promise<string> {
    const lockKey = `openai:vector-store:${accountId}:${aiAgentId}`;
    return withLock(this.redis, lockKey, async () => {
      const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
      if (agent?.openai_vector_store_id) {
        return agent.openai_vector_store_id;
      }

      const vectorStoreId = await this.createVectorStore(
        apiKey,
        baseUrl,
        `underchat-${aiAgentId}`
      );

      await this.aiAgentService.updateAiAgentOpenAIIds(aiAgentId, accountId, {
        openai_vector_store_id: vectorStoreId,
      });

      if (agent?.openai_assistant_id) {
        await this.updateAssistantVectorStore(
          agent.openai_assistant_id,
          apiKey,
          baseUrl,
          vectorStoreId
        );
      }

      return vectorStoreId;
    });
  }

  private async createVectorStore(
    apiKey: string,
    baseUrl: string,
    name: string
  ): Promise<string> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/vector_stores`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI Assistants API error (create vector store): ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as { id: string };
    return data.id;
  }

  async uploadFileToOpenAI(
    apiKey: string,
    baseUrl: string,
    fileBuffer: Buffer | ArrayBuffer,
    filename: string
  ): Promise<string> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/files`;

    const formData = new FormData();
    const blob = this.buildBlobFromBuffer(fileBuffer);
    formData.append('file', blob, filename);
    formData.append('purpose', 'assistants');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2',
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI Assistants API error (upload file): ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as { id: string };
    return data.id;
  }

  private async addFileToVectorStorePostOnly(
    apiKey: string,
    baseUrl: string,
    vectorStoreId: string,
    fileId: string
  ): Promise<string> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/vector_stores/${encodeURIComponent(vectorStoreId)}/files`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify({ file_id: fileId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI Assistants API error (add file to vector store): ${response.status} - ${errorText}`
      );
    }

    const vectorStoreFile = (await response.json()) as { id: string };
    return vectorStoreFile.id ?? fileId;
  }

  async addFileToVectorStore(
    apiKey: string,
    baseUrl: string,
    vectorStoreId: string,
    fileId: string
  ): Promise<void> {
    const vectorStoreFileId = await this.addFileToVectorStorePostOnly(
      apiKey,
      baseUrl,
      vectorStoreId,
      fileId
    );
    await this.waitForVectorStoreFileCompletion(
      apiKey,
      baseUrl,
      vectorStoreId,
      vectorStoreFileId
    );
  }

  private async getVectorStoreFileStatus(
    apiKey: string,
    baseUrl: string,
    vectorStoreId: string,
    fileId: string
  ): Promise<{ status: string; last_error?: { message?: string } | null }> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/vector_stores/${encodeURIComponent(vectorStoreId)}/files/${encodeURIComponent(fileId)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(apiKey),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI Assistants API error (get vector store file): ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as {
      status: string;
      last_error?: { message?: string } | null;
    };
    return { status: data.status, last_error: data.last_error };
  }

  private async waitForVectorStoreFileCompletion(
    apiKey: string,
    baseUrl: string,
    vectorStoreId: string,
    fileId: string
  ): Promise<void> {
    for (
      let attempt = 0;
      attempt < this.VECTOR_STORE_FILE_MAX_POLL_ATTEMPTS;
      attempt++
    ) {
      const { status, last_error } = await this.getVectorStoreFileStatus(
        apiKey,
        baseUrl,
        vectorStoreId,
        fileId
      );

      if (status === 'completed') {
        return;
      }

      if (status === 'failed' || status === 'cancelled') {
        const message =
          last_error?.message ?? `Status do arquivo no vector store: ${status}`;
        throw new Error(
          `OpenAI vector store file processing failed: ${message}`
        );
      }

      await this.sleep(this.VECTOR_STORE_FILE_POLL_INTERVAL_MS);
    }

    throw new Error(
      `OpenAI vector store file processing timed out after ${this.VECTOR_STORE_FILE_MAX_POLL_ATTEMPTS} attempts`
    );
  }

  private isVectorStoreNotFoundError(error: Error): boolean {
    if (!error.message.includes('404')) {
      return false;
    }
    return (
      error.message.includes('No valid vector store') ||
      error.message.includes('No vector store found')
    );
  }

  private isAssistantNotFoundError(error: Error): boolean {
    return (
      error.message.includes('404') &&
      error.message.includes('No assistant found')
    );
  }

  async recreateAssistantAndUpdate(
    aiAgentId: string,
    accountId: string,
    apiKey: string,
    baseUrl: string,
    vectorStoreId: string
  ): Promise<string> {
    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
    if (!agent?.model) {
      throw new Error(
        'Agente sem model configurado para recriar assistente OpenAI'
      );
    }
    const assistantId = await this.createAssistant(
      apiKey,
      baseUrl,
      agent.model,
      this.getDefaultAssistantInstructions(),
      vectorStoreId
    );
    await this.aiAgentService.updateAiAgentOpenAIIds(aiAgentId, accountId, {
      openai_assistant_id: assistantId,
    });
    return assistantId;
  }

  async recreateVectorStoreAndUpdate(
    aiAgentId: string,
    accountId: string,
    apiKey: string,
    baseUrl: string
  ): Promise<string> {
    const agent = await this.aiAgentService.viewAiAgent(aiAgentId, accountId);
    const vectorStoreId = await this.createVectorStore(
      apiKey,
      baseUrl,
      `underchat-${aiAgentId}`
    );
    await this.aiAgentService.updateAiAgentOpenAIIds(aiAgentId, accountId, {
      openai_vector_store_id: vectorStoreId,
    });
    if (agent?.openai_assistant_id) {
      try {
        await this.updateAssistantVectorStore(
          agent.openai_assistant_id,
          apiKey,
          baseUrl,
          vectorStoreId
        );
      } catch (error) {
        if (error instanceof Error && this.isAssistantNotFoundError(error)) {
          await this.recreateAssistantAndUpdate(
            aiAgentId,
            accountId,
            apiKey,
            baseUrl,
            vectorStoreId
          );
        } else {
          throw error;
        }
      }
    }
    return vectorStoreId;
  }

  async addFileToVectorStoreWithRecovery(
    apiKey: string,
    baseUrl: string,
    vectorStoreId: string,
    fileId: string,
    aiAgentId: string,
    accountId: string
  ): Promise<void> {
    try {
      await this.addFileToVectorStore(apiKey, baseUrl, vectorStoreId, fileId);
    } catch (error) {
      if (!(error instanceof Error && this.isVectorStoreNotFoundError(error))) {
        throw error;
      }
      const lockKey = `openai:vector-store:${accountId}:${aiAgentId}`;
      const result: {
        vectorStoreId: string;
        vectorStoreFileId: string | null;
      } = { vectorStoreId: '', vectorStoreFileId: null };
      await withLock(this.redis, lockKey, async () => {
        const agent = await this.aiAgentService.viewAiAgent(
          aiAgentId,
          accountId
        );
        if (agent?.openai_vector_store_id) {
          try {
            const vsFileId = await this.addFileToVectorStorePostOnly(
              apiKey,
              baseUrl,
              agent.openai_vector_store_id,
              fileId
            );
            result.vectorStoreId = agent.openai_vector_store_id;
            result.vectorStoreFileId = vsFileId;
            return;
          } catch (e) {
            if (!(e instanceof Error && this.isVectorStoreNotFoundError(e))) {
              throw e;
            }
          }
        }
        result.vectorStoreId = await this.recreateVectorStoreAndUpdate(
          aiAgentId,
          accountId,
          apiKey,
          baseUrl
        );
      });
      if (result.vectorStoreFileId !== null) {
        await this.waitForVectorStoreFileCompletion(
          apiKey,
          baseUrl,
          result.vectorStoreId,
          result.vectorStoreFileId
        );
        return;
      }
      await this.addFileToVectorStore(
        apiKey,
        baseUrl,
        result.vectorStoreId,
        fileId
      );
    }
  }

  async removeFileFromVectorStore(
    apiKey: string,
    baseUrl: string,
    vectorStoreId: string,
    fileId: string
  ): Promise<void> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/vector_stores/${encodeURIComponent(vectorStoreId)}/files/${encodeURIComponent(fileId)}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.buildHeaders(apiKey),
    });

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      console.error(
        `OpenAI Assistants API error (remove file from vector store): ${response.status} - ${errorText}`
      );
    }
  }

  async deleteFileFromOpenAI(
    apiKey: string,
    baseUrl: string,
    fileId: string
  ): Promise<void> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/files/${encodeURIComponent(fileId)}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2',
      },
    });

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      console.error(
        `OpenAI Assistants API error (delete file): ${response.status} - ${errorText}`
      );
    }
  }

  async cleanupOpenAIFile(
    apiKey: string,
    baseUrl: string,
    vectorStoreId: string | null | undefined,
    fileId: string
  ): Promise<void> {
    if (vectorStoreId) {
      await this.removeFileFromVectorStore(
        apiKey,
        baseUrl,
        vectorStoreId,
        fileId
      );
    }
    await this.deleteFileFromOpenAI(apiKey, baseUrl, fileId);
  }

  private getThreadCacheKey(
    accountId: string,
    chatId: string,
    aiAgentId: string
  ): string {
    return `openai:thread:${accountId}:${chatId}:${aiAgentId}`;
  }

  async getOrCreateThread(
    accountId: string,
    chatId: string,
    aiAgentId: string,
    apiKey: string,
    baseUrl: string
  ): Promise<string> {
    const cacheKey = this.getThreadCacheKey(accountId, chatId, aiAgentId);
    const cachedThreadId = await this.redis.get(cacheKey);

    if (cachedThreadId) {
      return cachedThreadId;
    }

    const threadId = await this.createThread(apiKey, baseUrl);
    await this.redis.set(
      cacheKey,
      threadId,
      'EX',
      this.THREAD_CACHE_TTL_SECONDS
    );
    return threadId;
  }

  private async createThread(apiKey: string, baseUrl: string): Promise<string> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/threads`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI Assistants API error (create thread): ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as { id: string };
    return data.id;
  }

  async addMessageToThread(
    apiKey: string,
    baseUrl: string,
    threadId: string,
    content: string,
    role: 'user' | 'assistant' = 'user'
  ): Promise<string> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/threads/${encodeURIComponent(threadId)}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify({ role, content }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI Assistants API error (add message): ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as { id: string };
    return data.id;
  }

  async createRunAndWait(
    apiKey: string,
    baseUrl: string,
    threadId: string,
    assistantId: string,
    additionalInstructions?: string
  ): Promise<{
    text: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    latency_ms?: number;
  }> {
    const startMs = Date.now();
    const runId = await this.createRun(
      apiKey,
      baseUrl,
      threadId,
      assistantId,
      additionalInstructions
    );

    const runUsage = await this.pollRunCompletion(
      apiKey,
      baseUrl,
      threadId,
      runId
    );

    const text = await this.getRunResponseText(apiKey, baseUrl, threadId);
    const latency_ms = Date.now() - startMs;

    return { text, usage: runUsage, latency_ms };
  }

  private async createRun(
    apiKey: string,
    baseUrl: string,
    threadId: string,
    assistantId: string,
    additionalInstructions?: string
  ): Promise<string> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/threads/${encodeURIComponent(threadId)}/runs`;

    const body: Record<string, unknown> = {
      assistant_id: assistantId,
      truncation_strategy: { type: 'auto' },
    };

    if (additionalInstructions) {
      body.additional_instructions = additionalInstructions;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI Assistants API error (create run): ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as { id: string };
    return data.id;
  }

  private async pollRunCompletion(
    apiKey: string,
    baseUrl: string,
    threadId: string,
    runId: string
  ): Promise<
    | {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      }
    | undefined
  > {
    const terminalStatuses = new Set([
      'completed',
      'failed',
      'cancelled',
      'expired',
      'incomplete',
    ]);

    for (let attempt = 0; attempt < this.RUN_MAX_POLL_ATTEMPTS; attempt++) {
      await this.sleep(this.RUN_POLL_INTERVAL_MS);

      const url = `${this.normalizeBaseUrl(baseUrl)}/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: this.buildHeaders(apiKey),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenAI Assistants API error (poll run): ${response.status} - ${errorText}`
        );
      }

      const data = (await response.json()) as {
        status: string;
        last_error?: { message: string } | null;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      if (data.status === 'completed') {
        if (data.usage) {
          return {
            prompt_tokens: data.usage.prompt_tokens ?? 0,
            completion_tokens: data.usage.completion_tokens ?? 0,
            total_tokens: data.usage.total_tokens ?? 0,
          };
        }
        return undefined;
      }

      if (terminalStatuses.has(data.status) && data.status !== 'completed') {
        const errorMessage = data.last_error?.message || data.status;
        throw new Error(
          `OpenAI Assistants run failed with status: ${data.status} - ${errorMessage}`
        );
      }
    }

    throw new Error(
      `OpenAI Assistants run timed out after ${this.RUN_MAX_POLL_ATTEMPTS} attempts`
    );
  }

  private async getRunResponseText(
    apiKey: string,
    baseUrl: string,
    threadId: string
  ): Promise<string> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/threads/${encodeURIComponent(threadId)}/messages?order=desc&limit=1`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(apiKey),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI Assistants API error (get messages): ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as {
      data: Array<{
        role: string;
        content: Array<{
          type: string;
          text?: { value: string };
        }>;
      }>;
    };

    const assistantMessage = data.data.find((msg) => msg.role === 'assistant');
    if (!assistantMessage) {
      return 'Desculpe, não consegui processar sua solicitação.';
    }

    const textContent = assistantMessage.content.find((c) => c.type === 'text');

    return (
      textContent?.text?.value ||
      'Desculpe, não consegui processar sua solicitação.'
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
