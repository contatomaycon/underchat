import { singleton, inject } from 'tsyringe';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
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

@singleton()
export class AiAgentPromptEmbeddingConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private readonly RETRY_ATTEMPTS = 3;
  private readonly RETRY_BASE_DELAY_MS = 700;

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
    private readonly promptDocumentExtractorService: PromptDocumentExtractorService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) {
      return;
    }

    const topic = this.kafkaServiceQueueService.aiAgentPromptEmbedding();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-ai-agent-prompt-embedding'
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseRequest(message.value);

      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const heartbeat = async () => {
        this.consumer?.commit();
      };

      const stop = startHeartbeat(heartbeat);
      try {
        await this.processEmbedding(data);
      } catch (error) {
        console.error('[AiAgentPromptEmbedding] erro ao processar embedding', {
          error,
          account_id: data.account_id,
          ai_agent_id: data.ai_agent_id,
          ai_agent_prompt_id: data.ai_agent_prompt_id,
          source: data.source ?? 'unknown',
          retry_count: data.retry_count ?? 0,
        });
      } finally {
        stop();
        await this.commitNext(topic, message.partition, message.offset);
      }
    });

    this.consumer.on('event.error', (err) => {
      handleConsumerError(err, topic);
    });

    const consumer = this.consumer;
    if (!consumer) {
      throw new Error('Consumer not initialized');
    }

    connectConsumer(consumer, topic, () => {
      this.isRunning = true;
    });
  }

  public async close(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    try {
      this.isRunning = false;
      await new Promise<void>((resolve) => {
        const consumer = this.consumer;
        if (!consumer) {
          resolve();
          return;
        }
        consumer.unsubscribe();
        consumer.disconnect(resolve);
      });
    } finally {
      this.consumer = null;
    }
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

    if (currentPrompt.status !== EAiAgentStatus.active) {
      await this.cleanupInactivePromptArtifacts(
        data,
        currentPrompt.openai_file_id
      );
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
      return;
    }

    const textContent = extraction.text.trim();
    if (!textContent) {
      console.warn(
        '[AiAgentPromptEmbedding] conteúdo vazio, pulando embedding',
        {
          account_id: data.account_id,
          ai_agent_id: data.ai_agent_id,
          ai_agent_prompt_id: data.ai_agent_prompt_id,
          extraction_source: extraction.source,
        }
      );
      return;
    }

    let chunksCount = 0;
    try {
      chunksCount = await this.retryWithBackoff(
        () =>
          this.embeddingService.processAndStoreEmbeddings(
            data.account_id,
            data.ai_agent_id,
            data.ai_agent_prompt_id,
            textContent
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
      return;
    }

    console.log('[AiAgentPromptEmbedding] embeddings gerados', {
      account_id: data.account_id,
      ai_agent_id: data.ai_agent_id,
      ai_agent_prompt_id: data.ai_agent_prompt_id,
      chunks_count: chunksCount,
      extraction_source: extraction.source,
      source: data.source ?? 'unknown',
    });

    await this.processOpenAIFileUpload(data, currentPrompt.openai_file_id);
  }

  private async cleanupInactivePromptArtifacts(
    data: IAiAgentPromptEmbeddingRequest,
    existingOpenAiFileId: string | null
  ): Promise<void> {
    try {
      await this.embeddingService.deletePromptEmbeddings(
        data.ai_agent_prompt_id
      );
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
    }

    if (!existingOpenAiFileId) {
      return;
    }

    try {
      const agent = await this.aiAgentService.viewAiAgent(
        data.ai_agent_id,
        data.account_id
      );

      if (
        !agent ||
        agent.ai_agent_type_id !== EAiAgentType.gpt ||
        !agent.api_key ||
        !agent.base_url
      ) {
        await this.aiAgentService.updateAiAgentPromptOpenAIFileId(
          data.ai_agent_prompt_id,
          data.account_id,
          null
        );
        return;
      }

      await this.openAIAssistantService.cleanupOpenAIFile(
        agent.api_key,
        agent.base_url,
        agent.openai_vector_store_id,
        existingOpenAiFileId
      );
      await this.aiAgentService.updateAiAgentPromptOpenAIFileId(
        data.ai_agent_prompt_id,
        data.account_id,
        null
      );
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
    }
  }

  private async processOpenAIFileUpload(
    data: IAiAgentPromptEmbeddingRequest,
    existingOpenAiFileId: string | null
  ): Promise<void> {
    try {
      const agent = await this.aiAgentService.viewAiAgent(
        data.ai_agent_id,
        data.account_id
      );

      if (!agent) {
        return;
      }

      const isGpt =
        data.ai_agent_type_id === EAiAgentType.gpt ||
        agent.ai_agent_type_id === EAiAgentType.gpt;

      if (!isGpt || !agent.api_key || !agent.base_url) {
        return;
      }

      const currentPrompt = await this.aiAgentService.viewAiAgentPrompt(
        data.ai_agent_prompt_id,
        data.account_id
      );
      if (!currentPrompt || currentPrompt.status !== EAiAgentStatus.active) {
        return;
      }

      const vectorStoreId = await this.openAIAssistantService.ensureVectorStore(
        data.ai_agent_id,
        data.account_id,
        agent.api_key,
        agent.base_url
      );

      if (existingOpenAiFileId) {
        try {
          await this.openAIAssistantService.cleanupOpenAIFile(
            agent.api_key,
            agent.base_url,
            vectorStoreId,
            existingOpenAiFileId
          );
        } catch (error) {
          console.error(
            '[AiAgentPromptEmbedding] erro ao remover arquivo antigo do vector store',
            {
              error,
              account_id: data.account_id,
              ai_agent_id: data.ai_agent_id,
              ai_agent_prompt_id: data.ai_agent_prompt_id,
            }
          );
        }
      }

      if (agent.model) {
        const instructions =
          this.openAIAssistantService.getAssistantInstructionsFromSystemPrompt(
            agent.system_prompt
          );
        await this.openAIAssistantService.ensureAssistant(
          data.ai_agent_id,
          data.account_id,
          agent.api_key,
          agent.base_url,
          agent.model,
          instructions,
          vectorStoreId
        );
      }

      const fileResponse = await this.retryWithBackoff(
        async () => {
          const response = await fetch(data.value);
          if (!response.ok) {
            throw new Error(
              `Falha ao baixar arquivo para upload OpenAI: ${response.status}`
            );
          }
          return response;
        },
        this.RETRY_ATTEMPTS,
        {
          account_id: data.account_id,
          ai_agent_id: data.ai_agent_id,
          ai_agent_prompt_id: data.ai_agent_prompt_id,
          stage: 'openai_upload_download',
          source: data.source ?? 'unknown',
        }
      );

      const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
      const contentType = fileResponse.headers.get('content-type');
      const filename = this.buildFilenameForOpenAIVectorStore(
        data.value,
        contentType,
        'document'
      );

      const fileId = await this.openAIAssistantService.uploadFileToOpenAI(
        agent.api_key,
        agent.base_url,
        fileBuffer,
        filename
      );

      await this.openAIAssistantService.addFileToVectorStoreWithRecovery(
        agent.api_key,
        agent.base_url,
        vectorStoreId,
        fileId,
        data.ai_agent_id,
        data.account_id
      );

      await this.aiAgentService.updateAiAgentPromptOpenAIFileId(
        data.ai_agent_prompt_id,
        data.account_id,
        fileId
      );

      console.log('[AiAgentPromptEmbedding] arquivo enviado para OpenAI', {
        account_id: data.account_id,
        ai_agent_id: data.ai_agent_id,
        ai_agent_prompt_id: data.ai_agent_prompt_id,
        file_id: fileId,
      });
    } catch (error) {
      console.error(
        '[AiAgentPromptEmbedding] erro ao enviar arquivo para OpenAI',
        {
          error,
          account_id: data.account_id,
          ai_agent_id: data.ai_agent_id,
          ai_agent_prompt_id: data.ai_agent_prompt_id,
        }
      );
    }
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
        if (attempt > 1) {
        }
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

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }
}
