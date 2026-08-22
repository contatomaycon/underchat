import { randomUUID } from 'node:crypto';

import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { IOpenAIHeaders } from '@core/common/interfaces/IOpenAIHeaders';
import { withLock } from '@core/common/functions/withLock';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import {
  executeSafeOutboundHttp,
  type SafeOutboundHttpMethod,
  type SafeOutboundHttpResponse,
} from '@core/common/functions/safeOutboundHttp';
import { AiAgentService } from './aiAgent.service';

interface OpenAIRequestInput {
  readonly url: string;
  readonly method: SafeOutboundHttpMethod;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Buffer | string;
  readonly operation: string;
  readonly canRetry: boolean;
}

class OpenAIOutboundStatusError extends Error {
  constructor(
    readonly statusCode: number,
    operation: string
  ) {
    super(`OpenAI API error (${operation}): status ${statusCode}.`);
    this.name = 'OpenAIOutboundStatusError';
  }
}

@injectable()
export class OpenAIAssistantService {
  private readonly VECTOR_STORE_FILE_POLL_INTERVAL_MS = 2000;
  private readonly VECTOR_STORE_FILE_MAX_POLL_ATTEMPTS = 120;
  private readonly OUTBOUND_TIMEOUT_MS = 60000;
  private readonly OUTBOUND_MAX_ATTEMPTS = 3;

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(AiAgentService)
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

  private getOutboundPolicy(): {
    isProduction: boolean;
    allowLocalhostHttp: boolean;
  } {
    const appEnvironment = process.env.APP_ENVIRONMENT?.trim().toLowerCase();
    const isProduction = appEnvironment
      ? !['local', 'dev', 'development', 'test'].includes(appEnvironment)
      : process.env.NODE_ENV?.trim().toLowerCase() === 'production';

    return {
      isProduction,
      allowLocalhostHttp: !isProduction,
    };
  }

  private isRetryableStatus(statusCode: number): boolean {
    return statusCode === 429 || (statusCode >= 500 && statusCode <= 599);
  }

  private async executeOpenAIRequest(
    input: OpenAIRequestInput
  ): Promise<SafeOutboundHttpResponse> {
    const maximumAttempts = input.canRetry ? this.OUTBOUND_MAX_ATTEMPTS : 1;
    const policy = this.getOutboundPolicy();

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      let result;
      try {
        result = await executeSafeOutboundHttp({
          url: input.url,
          method: input.method,
          headers: input.headers,
          body: input.body,
          isProduction: policy.isProduction,
          allowLocalhostHttp: policy.allowLocalhostHttp,
          timeoutMs: this.OUTBOUND_TIMEOUT_MS,
          sensitiveHeaderNames: ['authorization', 'openai-beta'],
        });
      } catch {
        throw new Error(`OpenAI API request failed (${input.operation}).`);
      }

      if (result.kind === 'failure') {
        if (input.canRetry && result.retryable && attempt < maximumAttempts) {
          await this.delayBeforeRetry(attempt);
          continue;
        }

        throw new Error(
          result.isTimeout
            ? `OpenAI API request timed out (${input.operation}).`
            : `OpenAI API request failed (${input.operation}).`
        );
      }

      if (
        input.canRetry &&
        this.isRetryableStatus(result.statusCode) &&
        attempt < maximumAttempts
      ) {
        await this.delayBeforeRetry(attempt);
        continue;
      }

      return result;
    }

    throw new Error(`OpenAI API request failed (${input.operation}).`);
  }

  private assertSuccessfulResponse(
    response: SafeOutboundHttpResponse,
    operation: string,
    acceptedStatuses: readonly number[] = []
  ): void {
    if (
      (response.statusCode >= 200 && response.statusCode <= 299) ||
      acceptedStatuses.includes(response.statusCode)
    ) {
      return;
    }

    throw new OpenAIOutboundStatusError(response.statusCode, operation);
  }

  private parseJsonResponse<T>(
    response: SafeOutboundHttpResponse,
    operation: string
  ): T {
    try {
      return JSON.parse(response.body.toString('utf8')) as T;
    } catch {
      throw new Error(`OpenAI API returned invalid JSON (${operation}).`);
    }
  }

  private requireResponseId(
    response: SafeOutboundHttpResponse,
    operation: string
  ): string {
    const data = this.parseJsonResponse<{ id?: unknown }>(response, operation);
    if (typeof data.id !== 'string' || data.id.trim().length === 0) {
      throw new Error(`OpenAI API returned no resource ID (${operation}).`);
    }
    return data.id;
  }

  private async persistVectorStoreReferenceOrRollback(
    aiAgentId: string,
    accountId: string,
    apiKey: string,
    baseUrl: string,
    vectorStoreId: string
  ): Promise<void> {
    const wasUpdated = await this.aiAgentService.updateAiAgentOpenAIIds(
      aiAgentId,
      accountId,
      {
        openai_vector_store_id: vectorStoreId,
      }
    );
    if (wasUpdated) {
      return;
    }

    const persistenceError = new Error(
      'Failed to persist the OpenAI vector store reference.'
    );
    try {
      await this.deleteVectorStore(apiKey, baseUrl, vectorStoreId);
    } catch (cleanupError) {
      console.error(
        '[OpenAIAssistantService] vector store rollback failed after persistence rejection'
      );
      throw new AggregateError(
        [persistenceError, cleanupError],
        'Failed to persist and roll back the OpenAI vector store reference.'
      );
    }

    throw persistenceError;
  }

  private buildMultipartFileUpload(
    fileBuffer: Buffer | ArrayBuffer,
    filename: string
  ): { body: Buffer; contentType: string } {
    const boundary = `----underchat-${randomUUID()}`;
    const normalizedFilename = filename.replace(/[\r\n"]/gu, '_');
    const encodedFilename = encodeURIComponent(normalizedFilename);
    const prefix = Buffer.from(
      [
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="file"; filename*=UTF-8''${encodedFilename}\r\n`,
        'Content-Type: application/octet-stream\r\n\r\n',
      ].join(''),
      'utf8'
    );
    const source = Buffer.isBuffer(fileBuffer)
      ? fileBuffer
      : Buffer.from(fileBuffer);
    const suffix = Buffer.from(
      [
        `\r\n--${boundary}\r\n`,
        'Content-Disposition: form-data; name="purpose"\r\n\r\n',
        'assistants\r\n',
        `--${boundary}--\r\n`,
      ].join(''),
      'utf8'
    );

    return {
      body: Buffer.concat([prefix, source, suffix]),
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  private async retrieveVectorStore(
    apiKey: string,
    baseUrl: string,
    vectorStoreId: string
  ): Promise<{ id: string }> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/vector_stores/${encodeURIComponent(vectorStoreId)}`;
    const operation = 'retrieve vector store';
    const response = await this.executeOpenAIRequest({
      url,
      method: 'GET',
      headers: this.buildHeaders(apiKey),
      operation,
      canRetry: true,
    });
    this.assertSuccessfulResponse(response, operation);
    return {
      id: this.requireResponseId(response, operation),
    };
  }

  private isRetrieveNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    return (
      error instanceof OpenAIOutboundStatusError && error.statusCode === 404
    );
  }

  private async requestResponsesApi(
    url: string,
    apiKey: string,
    body: string,
    idempotencyKey?: string
  ): Promise<SafeOutboundHttpResponse> {
    const operation = 'create response';
    const response = await this.executeOpenAIRequest({
      url,
      method: 'POST',
      headers: {
        ...this.buildResponsesApiHeaders(apiKey),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body,
      operation,
      canRetry: Boolean(idempotencyKey),
    });

    if (response.statusCode < 200 || response.statusCode > 299) {
      throw new Error(
        response.statusCode === 401
          ? 'OpenAI authentication failed.'
          : response.statusCode === 402
            ? 'OpenAI billing or credits are unavailable.'
            : response.statusCode === 404
              ? 'OpenAI model, vector store or endpoint was not found.'
              : `OpenAI Responses API failed with status ${response.statusCode}.`
      );
    }

    return response;
  }

  async createResponseWithFileSearch(
    apiKey: string,
    baseUrl: string,
    model: string,
    instructions: string,
    userQuery: string,
    vectorStoreId: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    idempotencyKey?: string,
    cleanupContext?: {
      accountId: string;
      aiAgentId: string;
    }
  ): Promise<{
    text: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    latency_ms?: number;
  }> {
    if (cleanupContext) {
      await this.cleanupPendingOpenAIFiles(
        apiKey,
        baseUrl,
        cleanupContext.accountId,
        cleanupContext.aiAgentId
      );
    }

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
      store: false,
    };

    const response = await this.requestResponsesApi(
      url,
      apiKey,
      JSON.stringify(body),
      idempotencyKey
    );

    const latency_ms = Date.now() - startMs;

    const data = this.parseJsonResponse<{
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
      status?: string;
      error?: { message?: string } | null;
      incomplete_details?: { reason?: string } | null;
    }>(response, 'create response');

    if (data.status && data.status !== 'completed') {
      const reason = this.sanitizeResponsesIncompleteReason(
        data.status,
        data.incomplete_details?.reason
      );
      throw new Error(`OpenAI Responses API did not complete: ${reason}.`);
    }

    const output = data.output;
    const text = this.extractResponseTextFromOutput(output);
    if (!text) {
      throw new Error('OpenAI Responses API returned no assistant text.');
    }

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
  ): string | null {
    if (!Array.isArray(output)) {
      return null;
    }
    const textParts: string[] = [];
    for (const item of output) {
      if (
        item?.type !== 'message' ||
        item?.role !== 'assistant' ||
        !item?.content
      ) {
        continue;
      }
      for (const part of item.content) {
        if (part?.type === 'output_text' && typeof part.text === 'string') {
          const text = part.text.trim();
          if (text) {
            textParts.push(text);
          }
        }
      }
    }
    return textParts.length > 0 ? textParts.join('\n') : null;
  }

  private sanitizeResponsesIncompleteReason(
    status: string,
    reason: string | undefined
  ): string {
    const safeReasons = new Set([
      'cancelled',
      'content_filter',
      'failed',
      'in_progress',
      'incomplete',
      'max_output_tokens',
    ]);
    if (reason && safeReasons.has(reason)) {
      return reason;
    }
    return safeReasons.has(status) ? status : 'unknown_status';
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
        try {
          await this.retrieveVectorStore(
            apiKey,
            baseUrl,
            agent.openai_vector_store_id
          );
          return agent.openai_vector_store_id;
        } catch (error) {
          if (!this.isRetrieveNotFoundError(error)) {
            throw error;
          }
          return this.recreateVectorStoreAndUpdate(
            aiAgentId,
            accountId,
            apiKey,
            baseUrl
          );
        }
      }

      const vectorStoreId = await this.createVectorStore(
        apiKey,
        baseUrl,
        `underchat-${aiAgentId}`
      );

      await this.persistVectorStoreReferenceOrRollback(
        aiAgentId,
        accountId,
        apiKey,
        baseUrl,
        vectorStoreId
      );

      return vectorStoreId;
    });
  }

  private async createVectorStore(
    apiKey: string,
    baseUrl: string,
    name: string
  ): Promise<string> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/vector_stores`;
    const operation = 'create vector store';
    const response = await this.executeOpenAIRequest({
      url,
      method: 'POST',
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify({ name }),
      operation,
      canRetry: false,
    });
    this.assertSuccessfulResponse(response, operation);
    return this.requireResponseId(response, operation);
  }

  async uploadFileToOpenAI(
    apiKey: string,
    baseUrl: string,
    fileBuffer: Buffer | ArrayBuffer,
    filename: string
  ): Promise<string> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/files`;
    const operation = 'upload file';
    const multipart = this.buildMultipartFileUpload(fileBuffer, filename);
    const response = await this.executeOpenAIRequest({
      url,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2',
        'Content-Type': multipart.contentType,
      },
      body: multipart.body,
      operation,
      canRetry: false,
    });
    this.assertSuccessfulResponse(response, operation);
    return this.requireResponseId(response, operation);
  }

  private async addFileToVectorStorePostOnly(
    apiKey: string,
    baseUrl: string,
    vectorStoreId: string,
    fileId: string
  ): Promise<string> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/vector_stores/${encodeURIComponent(vectorStoreId)}/files`;
    const operation = 'add file to vector store';
    const response = await this.executeOpenAIRequest({
      url,
      method: 'POST',
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify({ file_id: fileId }),
      operation,
      canRetry: false,
    });
    this.assertSuccessfulResponse(response, operation);
    const vectorStoreFile = this.parseJsonResponse<{ id?: unknown }>(
      response,
      operation
    );
    return typeof vectorStoreFile.id === 'string' ? vectorStoreFile.id : fileId;
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
    const operation = 'get vector store file';
    const response = await this.executeOpenAIRequest({
      url,
      method: 'GET',
      headers: this.buildHeaders(apiKey),
      operation,
      canRetry: true,
    });
    this.assertSuccessfulResponse(response, operation);
    const data = this.parseJsonResponse<{
      status: string;
      last_error?: { message?: string } | null;
    }>(response, operation);
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
      const { status } = await this.getVectorStoreFileStatus(
        apiKey,
        baseUrl,
        vectorStoreId,
        fileId
      );

      if (status === 'completed') {
        return;
      }

      if (status === 'failed' || status === 'cancelled') {
        throw new Error(
          `OpenAI vector store file processing failed with status ${status}.`
        );
      }

      await this.sleep(this.VECTOR_STORE_FILE_POLL_INTERVAL_MS);
    }

    throw new Error(
      `OpenAI vector store file processing timed out after ${this.VECTOR_STORE_FILE_MAX_POLL_ATTEMPTS} attempts`
    );
  }

  private isVectorStoreNotFoundError(error: Error): boolean {
    return (
      error instanceof OpenAIOutboundStatusError && error.statusCode === 404
    );
  }

  async recreateVectorStoreAndUpdate(
    aiAgentId: string,
    accountId: string,
    apiKey: string,
    baseUrl: string
  ): Promise<string> {
    const vectorStoreId = await this.createVectorStore(
      apiKey,
      baseUrl,
      `underchat-${aiAgentId}`
    );
    await this.persistVectorStoreReferenceOrRollback(
      aiAgentId,
      accountId,
      apiKey,
      baseUrl,
      vectorStoreId
    );
    return vectorStoreId;
  }

  async addFileToVectorStoreWithRecovery(
    apiKey: string,
    baseUrl: string,
    vectorStoreId: string,
    fileId: string,
    aiAgentId: string,
    accountId: string
  ): Promise<string> {
    try {
      await this.addFileToVectorStore(apiKey, baseUrl, vectorStoreId, fileId);
      return vectorStoreId;
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
        return result.vectorStoreId;
      }
      await this.addFileToVectorStore(
        apiKey,
        baseUrl,
        result.vectorStoreId,
        fileId
      );
      return result.vectorStoreId;
    }
  }

  async removeFileFromVectorStore(
    apiKey: string,
    baseUrl: string,
    vectorStoreId: string,
    fileId: string
  ): Promise<void> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/vector_stores/${encodeURIComponent(vectorStoreId)}/files/${encodeURIComponent(fileId)}`;
    const operation = 'remove file from vector store';
    const response = await this.executeOpenAIRequest({
      url,
      method: 'DELETE',
      headers: this.buildHeaders(apiKey),
      operation,
      canRetry: true,
    });
    this.assertSuccessfulResponse(response, operation, [404]);
  }

  async deleteVectorStore(
    apiKey: string,
    baseUrl: string,
    vectorStoreId: string
  ): Promise<void> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/vector_stores/${encodeURIComponent(vectorStoreId)}`;
    const operation = 'delete vector store';
    const response = await this.executeOpenAIRequest({
      url,
      method: 'DELETE',
      headers: this.buildHeaders(apiKey),
      operation,
      canRetry: true,
    });
    this.assertSuccessfulResponse(response, operation, [404]);
  }

  async deleteFileFromOpenAI(
    apiKey: string,
    baseUrl: string,
    fileId: string
  ): Promise<void> {
    const url = `${this.normalizeBaseUrl(baseUrl)}/files/${encodeURIComponent(fileId)}`;
    const operation = 'delete file';
    const response = await this.executeOpenAIRequest({
      url,
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2',
        'Content-Type': 'application/json',
      },
      operation,
      canRetry: true,
    });
    this.assertSuccessfulResponse(response, operation, [404]);
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

  private pendingFileCleanupKey(accountId: string, aiAgentId: string): string {
    return `openai:pending-file-cleanup:${accountId}:${aiAgentId}`;
  }

  async registerPendingOpenAIFileCleanup(
    accountId: string,
    aiAgentId: string,
    aiAgentPromptId: string,
    vectorStoreId: string | null | undefined,
    fileId: string
  ): Promise<void> {
    const key = this.pendingFileCleanupKey(accountId, aiAgentId);
    await this.redis
      .multi()
      .hset(
        key,
        fileId,
        JSON.stringify({
          aiAgentPromptId,
          vectorStoreId: vectorStoreId ?? null,
          fileId,
        })
      )
      .expire(key, 30 * 24 * 60 * 60)
      .exec();
  }

  async cancelPendingOpenAIFileCleanup(
    accountId: string,
    aiAgentId: string,
    fileId: string
  ): Promise<void> {
    await this.redis.hdel(
      this.pendingFileCleanupKey(accountId, aiAgentId),
      fileId
    );
  }

  async cleanupPendingOpenAIFiles(
    apiKey: string,
    baseUrl: string,
    accountId: string,
    aiAgentId: string
  ): Promise<void> {
    const key = this.pendingFileCleanupKey(accountId, aiAgentId);
    const pending = await this.redis.hgetall(key);

    for (const [field, serializedJob] of Object.entries(pending)) {
      let job: {
        aiAgentPromptId: string;
        vectorStoreId: string | null;
        fileId: string;
      } | null = null;
      try {
        const parsed = JSON.parse(serializedJob) as unknown;
        if (
          parsed &&
          typeof parsed === 'object' &&
          'aiAgentPromptId' in parsed &&
          typeof parsed.aiAgentPromptId === 'string' &&
          'fileId' in parsed &&
          typeof parsed.fileId === 'string' &&
          'vectorStoreId' in parsed &&
          (typeof parsed.vectorStoreId === 'string' ||
            parsed.vectorStoreId === null)
        ) {
          job = {
            aiAgentPromptId: parsed.aiAgentPromptId,
            vectorStoreId: parsed.vectorStoreId,
            fileId: parsed.fileId,
          };
        }
      } catch {
        job = null;
      }

      if (!job) {
        await this.redis.hdel(key, field);
        continue;
      }

      const prompt = await this.aiAgentService.viewAiAgentPrompt(
        job.aiAgentPromptId,
        accountId
      );
      if (
        prompt?.status === EAiAgentStatus.active &&
        prompt.openai_file_id === job.fileId
      ) {
        continue;
      }

      await this.cleanupOpenAIFile(
        apiKey,
        baseUrl,
        job.vectorStoreId,
        job.fileId
      );
      await this.redis.hdel(key, field);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async delayBeforeRetry(attempt: number): Promise<void> {
    await this.sleep(Math.min(500 * 2 ** (attempt - 1), 2000));
  }
}
