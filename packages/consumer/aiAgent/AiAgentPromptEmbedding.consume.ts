import { singleton, inject } from 'tsyringe';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { KafkaConsumer } from 'node-rdkafka';
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
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import WordExtractor from 'word-extractor';

@singleton()
export class AiAgentPromptEmbeddingConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly embeddingService: EmbeddingService,
    private readonly openAIAssistantService: OpenAIAssistantService,
    private readonly aiAgentService: AiAgentService
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
        console.error('Erro ao processar embedding:', error);
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
    const textContent = await this.extractTextFromFile(data.value);

    if (!textContent || textContent.trim() === '') {
      console.warn(
        `Conteúdo vazio para prompt ${data.ai_agent_prompt_id}, pulando embedding`
      );
      return;
    }

    const chunksCount = await this.embeddingService.processAndStoreEmbeddings(
      data.account_id,
      data.ai_agent_id,
      data.ai_agent_prompt_id,
      textContent
    );

    console.log(
      `Embeddings gerados para prompt ${data.ai_agent_prompt_id}: ${chunksCount} chunks`
    );

    await this.processOpenAIFileUpload(data);
  }

  private async processOpenAIFileUpload(
    data: IAiAgentPromptEmbeddingRequest
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

      const vectorStoreId = await this.openAIAssistantService.ensureVectorStore(
        data.ai_agent_id,
        data.account_id,
        agent.api_key,
        agent.base_url
      );

      const currentPrompt = await this.aiAgentService.viewAiAgentPrompt(
        data.ai_agent_prompt_id,
        data.account_id
      );
      if (currentPrompt?.openai_file_id) {
        try {
          await this.openAIAssistantService.cleanupOpenAIFile(
            agent.api_key,
            agent.base_url,
            vectorStoreId,
            currentPrompt.openai_file_id
          );
        } catch (error) {
          console.error(
            `Erro ao remover arquivo antigo do vector store (prompt ${data.ai_agent_prompt_id}):`,
            error
          );
        }
      }

      if (agent.model) {
        await this.openAIAssistantService.ensureAssistant(
          data.ai_agent_id,
          data.account_id,
          agent.api_key,
          agent.base_url,
          agent.model,
          this.openAIAssistantService.getDefaultAssistantInstructions(),
          vectorStoreId
        );
      }

      const fileResponse = await fetch(data.value);
      if (!fileResponse.ok) {
        console.error(
          `Falha ao baixar arquivo para upload OpenAI: ${fileResponse.status}`
        );
        return;
      }

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

      console.log(
        `Arquivo enviado para OpenAI: prompt ${data.ai_agent_prompt_id}, file_id ${fileId}`
      );
    } catch (error) {
      console.error(
        `Erro ao enviar arquivo para OpenAI (prompt ${data.ai_agent_prompt_id}):`,
        error
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
    } catch {}
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
      'text/html': '.html',
      'application/json': '.json',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        '.pptx',
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

  private async extractTextFromFile(fileUrl: string): Promise<string> {
    try {
      const response = await fetch(fileUrl);

      if (!response.ok) {
        throw new Error(`Falha ao baixar arquivo: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const buffer = await response.arrayBuffer();

      if (contentType.includes('text/plain')) {
        return new TextDecoder().decode(buffer);
      }

      if (contentType.includes('application/json')) {
        const text = new TextDecoder().decode(buffer);
        const json = JSON.parse(text) as unknown;
        return JSON.stringify(json, null, 2);
      }

      if (
        contentType.includes('text/markdown') ||
        fileUrl.endsWith('.md') ||
        fileUrl.endsWith('.markdown')
      ) {
        return new TextDecoder().decode(buffer);
      }

      if (
        contentType.includes('text/csv') ||
        contentType.includes('text/tab-separated-values')
      ) {
        return new TextDecoder().decode(buffer);
      }

      if (contentType.includes('application/pdf') || fileUrl.endsWith('.pdf')) {
        return this.extractTextFromPdf(buffer);
      }

      if (
        contentType.includes(
          'application/vnd.openxmlformats-officedocument.wordprocessingml'
        ) ||
        fileUrl.endsWith('.docx')
      ) {
        return this.extractTextFromDocx(buffer);
      }

      if (
        contentType.includes('application/msword') ||
        fileUrl.endsWith('.doc')
      ) {
        return this.extractTextFromDoc(buffer);
      }

      const textContent = new TextDecoder().decode(buffer);
      const isPrintable = /^[\x20-\x7E\n\r\t]*$/.test(
        textContent.substring(0, 1000)
      );

      if (isPrintable) {
        return textContent;
      }

      console.warn(`Tipo de arquivo não suportado: ${contentType}`);
      return '';
    } catch (error) {
      console.error('Erro ao extrair texto do arquivo:', error);
      return '';
    }
  }

  private async extractTextFromDocx(buffer: ArrayBuffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });

      if (result.messages && result.messages.length > 0) {
        const warnings = result.messages
          .filter((msg) => msg.type === 'warning')
          .map((msg) => msg.message);
        if (warnings.length > 0) {
          console.warn('Avisos ao extrair texto do DOCX:', warnings);
        }
      }

      return result.value.trim();
    } catch (error) {
      console.error('Erro ao extrair texto do DOCX:', error);
      return '';
    }
  }

  private async extractTextFromPdf(buffer: ArrayBuffer): Promise<string> {
    try {
      const pdfBuffer = Buffer.from(buffer);
      const parser = new PDFParse({ data: pdfBuffer });
      const result = await parser.getText();

      await parser.destroy();

      if (!result || !result.text) {
        return '';
      }

      return result.text.trim();
    } catch (error) {
      console.error('Erro ao extrair texto do PDF:', error);
      return '';
    }
  }

  private async extractTextFromDoc(buffer: ArrayBuffer): Promise<string> {
    try {
      const docBuffer = Buffer.from(buffer);
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(docBuffer);

      const body = extracted.getBody();

      if (!body || body.trim() === '') {
        return '';
      }

      return body.trim();
    } catch (error) {
      console.error('Erro ao extrair texto do DOC:', error);
      return '';
    }
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }
}
