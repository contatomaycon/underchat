import { singleton, inject } from 'tsyringe';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { EmbeddingService } from '@core/services/embedding.service';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { AiAgentService } from '@core/services/aiAgent.service';
import { IAiAgentPromptEmbeddingRequest } from '@core/common/interfaces/IAiAgentPromptEmbeddingRequest';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import {
  PromptDocumentExtractorService,
  type IPromptDocumentExtractionResult,
} from '@core/services/promptDocumentExtractor.service';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import Redis from 'ioredis';
import {
  LockAcquisitionTimeoutError,
  withLock,
} from '@core/common/functions/withLock';

@singleton()
export class AiAgentPromptEmbeddingConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IAiAgentPromptEmbeddingRequest> | null =
    null;
  private isRunning = false;
  private readonly RETRY_ATTEMPTS = 3;
  private readonly RETRY_BASE_DELAY_MS = 700;
  private readonly pendingRefreshHash =
    'ai-agent:prompt-embedding:pending-refresh:v1';

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(EmbeddingService)
    private readonly embeddingService: EmbeddingService,
    @inject(OpenAIAssistantService)
    private readonly openAIAssistantService: OpenAIAssistantService,
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService,
    @inject(PromptDocumentExtractorService)
    private readonly promptDocumentExtractorService: PromptDocumentExtractorService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) {
      return;
    }

    const topic = this.kafkaServiceQueueService.aiAgentPromptEmbedding();
    this.runner = new KafkaConsumerRunner<IAiAgentPromptEmbeddingRequest>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-ai-agent-prompt-embedding',
      parse: (message) => this.parseRequest(message.value),
      resolveEntityKey: (data) =>
        `${data.account_id}:${data.ai_agent_id}:${data.ai_agent_prompt_id}`,
      handle: async (data) => {
        try {
          await this.processEmbedding(data);
        } catch (error) {
          console.error(
            '[AiAgentPromptEmbedding] erro ao processar embedding',
            {
              error,
              account_id: data.account_id,
              ai_agent_id: data.ai_agent_id,
              ai_agent_prompt_id: data.ai_agent_prompt_id,
              source: data.source ?? 'unknown',
              retry_count: data.retry_count ?? 0,
            }
          );
          throw error;
        }
      },
      maxRetries: 3,
      retryDelaysMs: [1000, 5000, 15000],
      onDiscarded: (data, context, error, reason) => {
        console.error('[AiAgentPromptEmbedding] mensagem descartada', {
          account_id: data.account_id,
          ai_agent_id: data.ai_agent_id,
          ai_agent_prompt_id: data.ai_agent_prompt_id,
          partition: context.partition,
          offset: context.offset,
          reason,
          error: this.normalizeErrorReason(error),
        });
      },
      logger: console,
    });

    await this.runner.start(() => {
      this.isRunning = true;
    });
    this.consumer = this.runner.consumer;
    await this.recoverDurablePendingRefreshes();
  }

  private async recoverDurablePendingRefreshes(): Promise<void> {
    try {
      await withLock(
        this.redis,
        `${this.pendingRefreshHash}:recovery-lock`,
        async (lockContext) => {
          const pendingJobs = await this.redis.hgetall(this.pendingRefreshHash);

          for (const [jobId, serializedJob] of Object.entries(pendingJobs)) {
            lockContext.assertActive();
            const data = this.parseRequest(Buffer.from(serializedJob, 'utf8'));
            if (!data) {
              await this.redis.hdel(this.pendingRefreshHash, jobId);
              continue;
            }

            try {
              await this.processEmbedding(data);
              lockContext.assertActive();
              await this.redis.hdel(this.pendingRefreshHash, jobId);
            } catch (error) {
              console.error(
                '[AiAgentPromptEmbedding] recuperação durável permaneceu pendente',
                {
                  error,
                  account_id: data.account_id,
                  ai_agent_id: data.ai_agent_id,
                  ai_agent_prompt_id: data.ai_agent_prompt_id,
                }
              );
            }
          }
        },
        {
          ttlMs: 120_000,
          maxWaitMs: 1_000,
        }
      );
    } catch (error) {
      if (error instanceof LockAcquisitionTimeoutError) {
        return;
      }
      throw error;
    }
  }

  public async close(): Promise<void> {
    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
  }

  private parseRequest(
    value: Buffer | null
  ): IAiAgentPromptEmbeddingRequest | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IAiAgentPromptEmbeddingRequest;
      if (
        parsed &&
        'account_id' in parsed &&
        'ai_agent_id' in parsed &&
        'ai_agent_prompt_id' in parsed &&
        'value' in parsed
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async processEmbedding(
    data: IAiAgentPromptEmbeddingRequest
  ): Promise<void> {
    const currentPrompt = await this.aiAgentService.viewAiAgentPrompt(
      data.ai_agent_prompt_id,
      data.account_id
    );

    if (!currentPrompt) {
      return;
    }

    if (currentPrompt.value !== data.value) {
      return;
    }

    if (currentPrompt.status !== EAiAgentStatus.active) {
      await this.cleanupInactivePromptArtifacts(data);
      return;
    }

    let extraction: IPromptDocumentExtractionResult;
    try {
      extraction = await this.retryWithBackoff(
        () =>
          this.promptDocumentExtractorService.extractTextFromUrl(data.value, {
            allowLegacyOfficeFormats: true,
          }),
        this.RETRY_ATTEMPTS,
        {
          account_id: data.account_id,
          ai_agent_id: data.ai_agent_id,
          ai_agent_prompt_id: data.ai_agent_prompt_id,
          stage: 'extract_document',
          source: data.source ?? 'unknown',
        }
      );
    } catch (error) {
      console.error('[AiAgentPromptEmbedding] extração falhou', {
        error,
        account_id: data.account_id,
        ai_agent_id: data.ai_agent_id,
        ai_agent_prompt_id: data.ai_agent_prompt_id,
        source: data.source ?? 'unknown',
      });
      throw error;
    }

    const textContent = extraction.text.trim();
    if (!textContent) {
      console.warn(
        '[AiAgentPromptEmbedding] conteúdo vazio, removendo conhecimento anterior',
        {
          account_id: data.account_id,
          ai_agent_id: data.ai_agent_id,
          ai_agent_prompt_id: data.ai_agent_prompt_id,
          extraction_source: extraction.source,
        }
      );
    }

    let chunksCount = 0;
    try {
      chunksCount = await this.retryWithBackoff(
        () =>
          this.embeddingService.processAndStoreEmbeddings(
            data.account_id,
            data.ai_agent_id,
            data.ai_agent_prompt_id,
            textContent,
            data.value
          ),
        this.RETRY_ATTEMPTS,
        {
          account_id: data.account_id,
          ai_agent_id: data.ai_agent_id,
          ai_agent_prompt_id: data.ai_agent_prompt_id,
          stage: 'store_embeddings',
          source: data.source ?? 'unknown',
        }
      );
    } catch (error) {
      console.error('[AiAgentPromptEmbedding] indexação falhou', {
        error,
        account_id: data.account_id,
        ai_agent_id: data.ai_agent_id,
        ai_agent_prompt_id: data.ai_agent_prompt_id,
        source: data.source ?? 'unknown',
      });
      throw error;
    }

    console.log('[AiAgentPromptEmbedding] embeddings gerados', {
      account_id: data.account_id,
      ai_agent_id: data.ai_agent_id,
      ai_agent_prompt_id: data.ai_agent_prompt_id,
      chunks_count: chunksCount,
      extraction_source: extraction.source,
      source: data.source ?? 'unknown',
    });

    if (!textContent) {
      await this.cleanupActivePromptOpenAIFile(data);
      return;
    }

    await this.processOpenAIFileUpload(data, extraction);
  }

  private async cleanupActivePromptOpenAIFile(
    data: IAiAgentPromptEmbeddingRequest
  ): Promise<void> {
    await this.embeddingService.withEmbeddingGenerationLock(
      data.account_id,
      data.ai_agent_id,
      async (lockContext) => {
        const [agent, prompt] = await Promise.all([
          this.aiAgentService.viewAiAgent(data.ai_agent_id, data.account_id),
          this.aiAgentService.viewAiAgentPrompt(
            data.ai_agent_prompt_id,
            data.account_id
          ),
        ]);

        if (
          !prompt ||
          prompt.status !== EAiAgentStatus.active ||
          prompt.value !== data.value ||
          !prompt.openai_file_id
        ) {
          return;
        }

        if (agent?.ai_agent_type_id === EAiAgentType.gpt) {
          lockContext.assertActive();
          await this.openAIAssistantService.registerPendingOpenAIFileCleanup(
            data.account_id,
            data.ai_agent_id,
            data.ai_agent_prompt_id,
            agent.openai_vector_store_id,
            prompt.openai_file_id
          );
        }

        lockContext.assertActive();
        const cleared =
          await this.aiAgentService.updateAiAgentPromptOpenAIFileId(
            data.ai_agent_prompt_id,
            data.account_id,
            null
          );
        if (!cleared) {
          throw new Error('Failed to clear the empty OpenAI prompt file.');
        }

        if (
          agent?.ai_agent_type_id === EAiAgentType.gpt &&
          agent.api_key &&
          agent.base_url
        ) {
          await this.openAIAssistantService.cleanupPendingOpenAIFiles(
            agent.api_key,
            agent.base_url,
            data.account_id,
            data.ai_agent_id
          );
        }
      }
    );
  }

  private async cleanupInactivePromptArtifacts(
    data: IAiAgentPromptEmbeddingRequest
  ): Promise<void> {
    await this.embeddingService.withEmbeddingGenerationLock(
      data.account_id,
      data.ai_agent_id,
      () => this.cleanupInactivePromptArtifactsWithLock(data)
    );
  }

  private async cleanupInactivePromptArtifactsWithLock(
    data: IAiAgentPromptEmbeddingRequest
  ): Promise<void> {
    const currentPrompt = await this.aiAgentService.viewAiAgentPrompt(
      data.ai_agent_prompt_id,
      data.account_id
    );
    if (!currentPrompt || currentPrompt.status === EAiAgentStatus.active) {
      return;
    }

    try {
      const deleted = await this.embeddingService.deletePromptEmbeddings(
        data.ai_agent_prompt_id
      );
      if (!deleted) {
        throw new Error('Failed to remove inactive prompt embeddings.');
      }
    } catch (error) {
      console.error(
        '[AiAgentPromptEmbedding] falha ao remover embeddings de prompt inativo',
        {
          error,
          account_id: data.account_id,
          ai_agent_id: data.ai_agent_id,
          ai_agent_prompt_id: data.ai_agent_prompt_id,
        }
      );
      throw error;
    }

    if (!currentPrompt.openai_file_id) {
      return;
    }

    try {
      const agent = await this.aiAgentService.viewAiAgent(
        data.ai_agent_id,
        data.account_id
      );

      if (agent?.ai_agent_type_id === EAiAgentType.gpt) {
        await this.openAIAssistantService.registerPendingOpenAIFileCleanup(
          data.account_id,
          data.ai_agent_id,
          data.ai_agent_prompt_id,
          agent.openai_vector_store_id,
          currentPrompt.openai_file_id
        );
      }

      const cleared = await this.aiAgentService.updateAiAgentPromptOpenAIFileId(
        data.ai_agent_prompt_id,
        data.account_id,
        null
      );
      if (!cleared) {
        throw new Error('Failed to clear inactive OpenAI prompt file.');
      }

      if (
        agent?.ai_agent_type_id === EAiAgentType.gpt &&
        agent.api_key &&
        agent.base_url
      ) {
        await this.openAIAssistantService.cleanupPendingOpenAIFiles(
          agent.api_key,
          agent.base_url,
          data.account_id,
          data.ai_agent_id
        );
      }
    } catch (error) {
      console.error(
        '[AiAgentPromptEmbedding] falha ao limpar artefatos OpenAI de prompt inativo',
        {
          error,
          account_id: data.account_id,
          ai_agent_id: data.ai_agent_id,
          ai_agent_prompt_id: data.ai_agent_prompt_id,
        }
      );
      throw error;
    }
  }

  private async processOpenAIFileUpload(
    data: IAiAgentPromptEmbeddingRequest,
    extraction: IPromptDocumentExtractionResult
  ): Promise<void> {
    let uploadedFileId: string | null = null;
    let vectorStoreId: string | null = null;
    let fileAttached = false;
    let providerConfiguration:
      | {
          apiKey: string;
          baseUrl: string;
        }
      | undefined;
    let activated = false;

    try {
      const agent = await this.aiAgentService.viewAiAgent(
        data.ai_agent_id,
        data.account_id
      );

      if (!agent) {
        return;
      }

      if (
        agent.status !== EAiAgentStatus.active ||
        agent.ai_agent_type_id !== EAiAgentType.gpt ||
        !agent.api_key ||
        !agent.base_url
      ) {
        return;
      }
      providerConfiguration = {
        apiKey: agent.api_key,
        baseUrl: agent.base_url,
      };

      const currentPrompt = await this.aiAgentService.viewAiAgentPrompt(
        data.ai_agent_prompt_id,
        data.account_id
      );
      if (
        !currentPrompt ||
        currentPrompt.status !== EAiAgentStatus.active ||
        currentPrompt.value !== data.value
      ) {
        return;
      }

      await this.openAIAssistantService.cleanupPendingOpenAIFiles(
        providerConfiguration.apiKey,
        providerConfiguration.baseUrl,
        data.account_id,
        data.ai_agent_id
      );

      const filename = this.buildFilenameForOpenAIVectorStore(
        data.value,
        extraction.contentType,
        'document'
      );

      const stagedFileId = await this.openAIAssistantService.uploadFileToOpenAI(
        providerConfiguration.apiKey,
        providerConfiguration.baseUrl,
        extraction.buffer,
        filename
      );
      uploadedFileId = stagedFileId;

      await this.embeddingService.withEmbeddingGenerationLock(
        data.account_id,
        data.ai_agent_id,
        async (lockContext) => {
          let [latestAgent, latestPrompt] = await Promise.all([
            this.aiAgentService.viewAiAgent(data.ai_agent_id, data.account_id),
            this.aiAgentService.viewAiAgentPrompt(
              data.ai_agent_prompt_id,
              data.account_id
            ),
          ]);

          if (
            !latestAgent ||
            latestAgent.status !== EAiAgentStatus.active ||
            latestAgent.ai_agent_type_id !== EAiAgentType.gpt ||
            latestAgent.api_key !== providerConfiguration?.apiKey ||
            latestAgent.base_url !== providerConfiguration?.baseUrl ||
            !latestPrompt ||
            latestPrompt.status !== EAiAgentStatus.active ||
            latestPrompt.value !== data.value
          ) {
            return;
          }

          lockContext.assertActive();
          const ensuredVectorStoreId =
            await this.openAIAssistantService.ensureVectorStore(
              data.ai_agent_id,
              data.account_id,
              providerConfiguration.apiKey,
              providerConfiguration.baseUrl
            );
          lockContext.assertActive();
          vectorStoreId =
            await this.openAIAssistantService.addFileToVectorStoreWithRecovery(
              providerConfiguration.apiKey,
              providerConfiguration.baseUrl,
              ensuredVectorStoreId,
              stagedFileId,
              data.ai_agent_id,
              data.account_id
            );
          fileAttached = true;

          [latestAgent, latestPrompt] = await Promise.all([
            this.aiAgentService.viewAiAgent(data.ai_agent_id, data.account_id),
            this.aiAgentService.viewAiAgentPrompt(
              data.ai_agent_prompt_id,
              data.account_id
            ),
          ]);
          if (
            !latestAgent ||
            latestAgent.status !== EAiAgentStatus.active ||
            latestAgent.ai_agent_type_id !== EAiAgentType.gpt ||
            latestAgent.api_key !== providerConfiguration.apiKey ||
            latestAgent.base_url !== providerConfiguration.baseUrl ||
            latestAgent.openai_vector_store_id !== vectorStoreId ||
            !latestPrompt ||
            latestPrompt.status !== EAiAgentStatus.active ||
            latestPrompt.value !== data.value
          ) {
            return;
          }

          lockContext.assertActive();
          const previousOpenAiFileId = latestPrompt.openai_file_id;
          if (previousOpenAiFileId && previousOpenAiFileId !== stagedFileId) {
            await this.openAIAssistantService.registerPendingOpenAIFileCleanup(
              data.account_id,
              data.ai_agent_id,
              data.ai_agent_prompt_id,
              vectorStoreId,
              previousOpenAiFileId
            );
          }

          const updated =
            await this.aiAgentService.updateAiAgentPromptOpenAIFileId(
              data.ai_agent_prompt_id,
              data.account_id,
              stagedFileId
            );
          if (!updated) {
            throw new Error('Failed to activate the new OpenAI prompt file.');
          }
          activated = true;
        }
      );

      if (!activated) {
        await this.cleanupUploadedOpenAIFile(
          data,
          providerConfiguration,
          vectorStoreId,
          uploadedFileId,
          fileAttached,
          'stale upload'
        );
        uploadedFileId = null;
        return;
      }

      await this.openAIAssistantService.cleanupPendingOpenAIFiles(
        providerConfiguration.apiKey,
        providerConfiguration.baseUrl,
        data.account_id,
        data.ai_agent_id
      );

      console.log('[AiAgentPromptEmbedding] arquivo enviado para OpenAI', {
        account_id: data.account_id,
        ai_agent_id: data.ai_agent_id,
        ai_agent_prompt_id: data.ai_agent_prompt_id,
        file_id: uploadedFileId,
      });
    } catch (error) {
      if (!activated && uploadedFileId && providerConfiguration) {
        try {
          await this.cleanupUploadedOpenAIFile(
            data,
            providerConfiguration,
            vectorStoreId,
            uploadedFileId,
            fileAttached,
            'failed upload'
          );
        } catch (cleanupError) {
          console.error(
            '[AiAgentPromptEmbedding] falha ao compensar arquivo OpenAI',
            {
              cleanupError,
              account_id: data.account_id,
              ai_agent_id: data.ai_agent_id,
              ai_agent_prompt_id: data.ai_agent_prompt_id,
              file_id: uploadedFileId,
            }
          );
          throw new AggregateError(
            [error, cleanupError],
            'OpenAI prompt upload and cleanup both failed.'
          );
        }
      }

      console.error(
        '[AiAgentPromptEmbedding] erro ao enviar arquivo para OpenAI',
        {
          error,
          account_id: data.account_id,
          ai_agent_id: data.ai_agent_id,
          ai_agent_prompt_id: data.ai_agent_prompt_id,
        }
      );
      throw error;
    }
  }

  private async cleanupUploadedOpenAIFile(
    data: IAiAgentPromptEmbeddingRequest,
    providerConfiguration: {
      apiKey: string;
      baseUrl: string;
    },
    vectorStoreId: string | null,
    fileId: string,
    fileAttached: boolean,
    reason: string
  ): Promise<void> {
    if (fileAttached) {
      await this.openAIAssistantService.registerPendingOpenAIFileCleanup(
        data.account_id,
        data.ai_agent_id,
        data.ai_agent_prompt_id,
        vectorStoreId,
        fileId
      );
      await this.openAIAssistantService.cleanupPendingOpenAIFiles(
        providerConfiguration.apiKey,
        providerConfiguration.baseUrl,
        data.account_id,
        data.ai_agent_id
      );
      return;
    }

    await this.openAIAssistantService.cleanupOpenAIFile(
      providerConfiguration.apiKey,
      providerConfiguration.baseUrl,
      null,
      fileId
    );
    console.warn('[AiAgentPromptEmbedding] upload OpenAI compensado', {
      reason,
      account_id: data.account_id,
      ai_agent_id: data.ai_agent_id,
      ai_agent_prompt_id: data.ai_agent_prompt_id,
      file_id: fileId,
    });
  }

  private buildFilenameForOpenAIVectorStore(
    fileUrl: string,
    contentType: string | null,
    baseName: string
  ): string {
    const extensionFromUrl = this.getExtensionFromUrl(fileUrl);
    if (extensionFromUrl) {
      return this.ensureExtension(baseName, extensionFromUrl);
    }
    const extensionFromContentType =
      this.getExtensionFromContentType(contentType);
    if (extensionFromContentType) {
      return this.ensureExtension(baseName, extensionFromContentType);
    }
    return this.ensureExtension(baseName, '.txt');
  }

  private getExtensionFromUrl(fileUrl: string): string | null {
    try {
      const pathname = new URL(fileUrl).pathname;
      const lastSlash = pathname.lastIndexOf('/');
      const basename =
        lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname;
      const lastDot = basename.lastIndexOf('.');
      if (lastDot > 0 && lastDot < basename.length - 1) {
        return basename.slice(lastDot).toLowerCase();
      }
    } catch {
      return null;
    }
    return null;
  }

  private getExtensionFromContentType(
    contentType: string | null
  ): string | null {
    if (!contentType) {
      return null;
    }
    const mime = contentType.split(';')[0].trim().toLowerCase();
    const mimeToExt: Record<string, string> = {
      'application/pdf': '.pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        '.docx',
      'application/msword': '.doc',
      'text/plain': '.txt',
      'text/markdown': '.md',
      'application/json': '.json',
      'text/csv': '.csv',
      'text/tab-separated-values': '.tsv',
    };
    return mimeToExt[mime] ?? null;
  }

  private ensureExtension(baseName: string, extension: string): string {
    const sanitized =
      baseName.replace(/[/\\?*:|\s]+/g, '_').trim() || 'document';
    const lowerExt = extension.startsWith('.')
      ? extension.toLowerCase()
      : `.${extension.toLowerCase()}`;
    const lastDot = sanitized.lastIndexOf('.');
    const existingExt =
      lastDot > 0 ? sanitized.slice(lastDot).toLowerCase() : '';
    if (existingExt === lowerExt) {
      return sanitized;
    }
    return `${sanitized}${lowerExt}`;
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    attempts: number,
    context: {
      account_id: string;
      ai_agent_id: string;
      ai_agent_prompt_id: string;
      stage: string;
      source: string;
    }
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === attempts) {
          break;
        }

        const delayMs = this.RETRY_BASE_DELAY_MS * attempt;
        console.warn(
          '[AiAgentPromptEmbedding] tentativa falhou, retry agendado',
          {
            attempt,
            attempts,
            delay_ms: delayMs,
            stage: context.stage,
            reason: this.normalizeErrorReason(error),
            account_id: context.account_id,
            ai_agent_id: context.ai_agent_id,
            ai_agent_prompt_id: context.ai_agent_prompt_id,
            source: context.source,
          }
        );
        await this.delay(delayMs);
      }
    }

    throw lastError;
  }

  private normalizeErrorReason(error: unknown): string {
    if (error instanceof Error) {
      const message = error.message.trim();
      return message.length > 120 ? message.slice(0, 120) : message;
    }
    return 'unknown_error';
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
