import { injectable, inject } from 'tsyringe';
import { Client } from '@elastic/elasticsearch';
import { createHash } from 'crypto';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { IChunk } from '@core/common/interfaces/IChunk';
import { IEmbeddingDocument } from '@core/common/interfaces/IEmbeddingDocument';
import { IChatHistoryEmbeddingDocument } from '@core/common/interfaces/IChatHistoryEmbeddingDocument';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { aiAgentPromptEmbeddingMappings } from '@core/mappings/aiAgentPromptEmbedding.mappings';
import { chatHistoryEmbeddingMappings } from '@core/mappings/chatHistoryEmbedding.mappings';
import { AiAgentViewerRepository } from '@core/repositories/aiAgent/AiAgentViewer.repository';
import { AiAgentPromptViewerRepository } from '@core/repositories/aiAgent/AiAgentPromptViewer.repository';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import Redis from 'ioredis';
import {
  withLock,
  type ILockLeaseContext,
} from '@core/common/functions/withLock';
import { aiProviderClient } from './aiProviderClient.service';

type ElasticHit<T> = {
  _source?: T;
};

@injectable()
export class EmbeddingService {
  private readonly indexName = EElasticIndex.ai_agent_prompt_embedding;
  private readonly chatHistoryIndexName = EElasticIndex.chat_history_embedding;
  private readonly embeddingDimensions = 1536;
  private readonly embeddingBatchSize = 100;
  private readonly maxChunkTokensForFaq = 800;
  private promptEmbeddingMappingEnsured = false;
  private chatHistoryMappingEnsured = false;

  constructor(
    @inject('DatabaseElasticClient') private readonly elasticClient: Client,
    @inject(AiAgentViewerRepository)
    private readonly aiAgentViewerRepository: AiAgentViewerRepository,
    @inject(AiAgentPromptViewerRepository)
    private readonly aiAgentPromptViewerRepository: AiAgentPromptViewerRepository,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  async withEmbeddingGenerationLock<T>(
    accountId: string,
    aiAgentId: string,
    task: (lockContext: ILockLeaseContext) => Promise<T>
  ): Promise<T> {
    const lockKey = `ai-agent-embedding-generation:${accountId}:${aiAgentId}`;

    return withLock(
      this.redis,
      lockKey,
      async (lockContext) => {
        lockContext.assertActive();
        const result = await task(lockContext);
        lockContext.assertActive();
        return result;
      },
      {
        ttlMs: 120_000,
        maxWaitMs: 180_000,
      }
    );
  }

  private async ensureIndex(): Promise<void> {
    const exists = await this.elasticClient.indices.exists({
      index: this.indexName,
    });

    if (exists && this.promptEmbeddingMappingEnsured) {
      return;
    }

    if (exists) {
      await this.elasticClient.indices.putMapping({
        index: this.indexName,
        properties: {
          embedding_generation: {
            type: 'keyword',
          },
          chunk_count: {
            type: 'integer',
          },
          content_revision: {
            type: 'keyword',
          },
        },
      });
      this.promptEmbeddingMappingEnsured = true;
      return;
    }

    try {
      const mapping = aiAgentPromptEmbeddingMappings(this.embeddingDimensions);
      await this.elasticClient.indices.create(
        {
          index: this.indexName,
          settings: mapping.settings,
          mappings: mapping.mappings,
        } as any,
        { ignore: [400] }
      );
      this.promptEmbeddingMappingEnsured = true;
    } catch (error) {
      throw new Error(`Failed to create index: ${error}`);
    }
  }

  private splitTextIntoChunks(
    text: string,
    chunkSize: number,
    overlap: number
  ): IChunk[] {
    const normalized = text.trim();
    if (!normalized) {
      return [];
    }

    const effectiveChunkSize = Math.max(
      120,
      Math.min(chunkSize, this.maxChunkTokensForFaq)
    );
    const semanticBlocks = this.splitIntoSemanticBlocks(normalized);

    const chunks: IChunk[] = [];
    let chunkIndex = 0;

    for (const block of semanticBlocks) {
      const blockChunks = this.splitBlockWithTokenBudget(
        block,
        effectiveChunkSize,
        overlap
      );

      for (const chunkText of blockChunks) {
        chunks.push({
          text: chunkText,
          index: chunkIndex,
        });
        chunkIndex += 1;
      }
    }

    return chunks;
  }

  private splitIntoSemanticBlocks(text: string): string[] {
    const paragraphs = text
      .split(/\n\s*\n/g)
      .map((part) => part.trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      return [text];
    }

    const blocks: string[] = [];
    let currentBlock: string[] = [];
    let seenQuestionInCurrentBlock = false;

    const flushBlock = (): void => {
      if (currentBlock.length === 0) {
        return;
      }
      blocks.push(currentBlock.join('\n\n').trim());
      currentBlock = [];
      seenQuestionInCurrentBlock = false;
    };

    for (const paragraph of paragraphs) {
      const startsNewFaqItem = this.isLikelyFaqQuestion(paragraph);

      if (
        startsNewFaqItem &&
        currentBlock.length > 0 &&
        seenQuestionInCurrentBlock
      ) {
        flushBlock();
      }

      currentBlock.push(paragraph);
      if (startsNewFaqItem) {
        seenQuestionInCurrentBlock = true;
      }
    }

    flushBlock();

    return blocks.length > 0 ? blocks : [text];
  }

  private splitBlockWithTokenBudget(
    block: string,
    chunkSize: number,
    overlap: number
  ): string[] {
    const paragraphs = block
      .split(/\n\s*\n/g)
      .map((part) => part.trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      return [];
    }

    const chunks: string[] = [];
    let currentChunk: string[] = [];

    const estimateTokens = (value: string): number =>
      Math.ceil(value.length / 4);

    for (const paragraph of paragraphs) {
      if (estimateTokens(paragraph) > chunkSize) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.join('\n\n').trim());
          currentChunk = [];
        }

        const splitParagraphs = this.splitLongParagraph(paragraph, chunkSize);
        chunks.push(...splitParagraphs);
        continue;
      }

      if (currentChunk.length === 0) {
        currentChunk.push(paragraph);
        continue;
      }

      const nextCandidate = [...currentChunk, paragraph].join('\n\n');
      if (estimateTokens(nextCandidate) <= chunkSize) {
        currentChunk.push(paragraph);
        continue;
      }

      chunks.push(currentChunk.join('\n\n').trim());
      currentChunk = this.buildOverlapPrefix(currentChunk, overlap, chunkSize);
      currentChunk.push(paragraph);
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n').trim());
    }

    return chunks.filter(Boolean);
  }

  private splitLongParagraph(paragraph: string, chunkSize: number): string[] {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return [];
    }

    const chunks: string[] = [];
    let currentWords: string[] = [];

    for (const word of words) {
      const next = [...currentWords, word].join(' ');
      const tokenEstimate = Math.ceil(next.length / 4);
      if (tokenEstimate > chunkSize && currentWords.length > 0) {
        chunks.push(currentWords.join(' ').trim());
        currentWords = [word];
        continue;
      }

      currentWords.push(word);
    }

    if (currentWords.length > 0) {
      chunks.push(currentWords.join(' ').trim());
    }

    return chunks;
  }

  private buildOverlapPrefix(
    paragraphs: string[],
    overlap: number,
    chunkSize: number
  ): string[] {
    if (overlap <= 0 || paragraphs.length === 0 || chunkSize <= 0) {
      return [];
    }

    const overlapTarget = Math.max(1, Math.floor(overlap));
    const result: string[] = [];
    let accumulatedTokens = 0;

    for (let i = paragraphs.length - 1; i >= 0; i -= 1) {
      const paragraph = paragraphs[i];
      const tokenEstimate = Math.ceil(paragraph.length / 4);
      if (
        accumulatedTokens + tokenEstimate > overlapTarget &&
        result.length > 0
      ) {
        break;
      }
      result.unshift(paragraph);
      accumulatedTokens += tokenEstimate;
      if (accumulatedTokens >= overlapTarget) {
        break;
      }
    }

    return result;
  }

  private isLikelyFaqQuestion(paragraph: string): boolean {
    const lines = paragraph
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return false;
    }

    const firstLine = lines[0];
    if (firstLine.length < 10 || firstLine.length > 260) {
      return false;
    }

    if (firstLine.endsWith('?')) {
      return true;
    }

    return /^(pergunta|q)[:\-]/i.test(firstLine);
  }

  private isGeminiAgent(aiAgentTypeId: string): boolean {
    return aiAgentTypeId === EAiAgentType.gemini;
  }

  private isDeepSeekAgent(aiAgentTypeId: string): boolean {
    return aiAgentTypeId === EAiAgentType.deepseek;
  }

  private isEmbeddingOptional(aiAgentTypeId: string): boolean {
    return (
      aiAgentTypeId === EAiAgentType.deepseek ||
      aiAgentTypeId === EAiAgentType.others
    );
  }

  private validateEmbeddingConfig(
    baseUrl: string,
    apiKey: string,
    model: string
  ): void {
    if (!baseUrl) {
      throw new InvalidConfigurationError(
        'AI Agent base_url is not configured.'
      );
    }

    if (!apiKey) {
      throw new InvalidConfigurationError(
        'AI Agent api_key is not configured.'
      );
    }

    if (!model) {
      throw new InvalidConfigurationError('AI Agent model is not configured.');
    }
  }

  private async callGeminiEmbeddingApi(
    baseUrl: string,
    apiKey: string,
    model: string,
    texts: string[]
  ): Promise<number[][]> {
    return aiProviderClient.generateGeminiEmbeddings({
      configuration: {
        provider: EAiAgentType.gemini,
        baseUrl,
        apiKey,
        model,
        embeddingModel: model,
      },
      texts,
    });
  }

  private async callOpenAiEmbeddingApi(
    baseUrl: string,
    apiKey: string,
    model: string,
    texts: string[],
    aiAgentTypeId: string
  ): Promise<number[][]> {
    return aiProviderClient.generateOpenAiCompatibleEmbeddings({
      configuration: {
        provider: aiAgentTypeId,
        baseUrl,
        apiKey,
        model,
        embeddingModel: model,
      },
      texts,
    });
  }

  private async generateEmbeddings(
    texts: string[],
    baseUrl: string,
    apiKey: string,
    model: string,
    aiAgentTypeId: string
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    this.validateEmbeddingConfig(baseUrl, apiKey, model);

    const embeddings: number[][] = [];
    for (
      let batchStart = 0;
      batchStart < texts.length;
      batchStart += this.embeddingBatchSize
    ) {
      const batch = texts.slice(
        batchStart,
        batchStart + this.embeddingBatchSize
      );
      const batchEmbeddings = this.isGeminiAgent(aiAgentTypeId)
        ? await this.callGeminiEmbeddingApi(baseUrl, apiKey, model, batch)
        : await this.callOpenAiEmbeddingApi(
            baseUrl,
            apiKey,
            model,
            batch,
            aiAgentTypeId
          );
      embeddings.push(...batchEmbeddings);
    }

    return embeddings;
  }

  private validateAiAgentConfig(
    aiAgent: {
      base_url: string | null;
      api_key: string | null;
      embedding_model: string | null;
      ai_agent_type_id: string;
    },
    requireEmbedding: boolean = true
  ): asserts aiAgent is {
    base_url: string;
    api_key: string;
    embedding_model: string;
    ai_agent_type_id: string;
  } {
    if (!aiAgent.base_url || !aiAgent.api_key) {
      throw new InvalidConfigurationError(
        'AI Agent base_url or api_key is not configured.'
      );
    }

    if (requireEmbedding && !aiAgent.embedding_model) {
      throw new InvalidConfigurationError(
        'AI Agent embedding_model is not configured.'
      );
    }
  }

  private parseChunkConfig(
    chunkSize: string,
    chunkOverlap: string
  ): {
    size: number;
    overlap: number;
  } {
    return {
      size: Number.parseInt(chunkSize, 10) || 600,
      overlap: Number.parseInt(chunkOverlap, 10) || 100,
    };
  }

  private computeContentFingerprint(
    chunkText: string,
    sourceId: string,
    embeddingModel: string | null,
    embeddingDimensions: number,
    embeddingGeneration: string
  ): string {
    const normalizedText = chunkText.trim().toLowerCase();
    const payload = JSON.stringify({
      text: normalizedText,
      source_id: sourceId,
      embedding_model: embeddingModel || '',
      embedding_dimensions: embeddingDimensions,
      embedding_generation: embeddingGeneration,
    });

    return createHash('sha256').update(payload).digest('hex');
  }

  private computePromptContentRevision(
    chunks: IChunk[],
    embeddingGeneration: string
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          embedding_generation: embeddingGeneration,
          chunks: chunks.map((chunk) => ({
            index: chunk.index,
            text: chunk.text,
          })),
        })
      )
      .digest('hex');
  }

  private computeEmbeddingGeneration(aiAgent: {
    ai_agent_type_id: string;
    base_url: string | null;
    embedding_model: string | null;
    chunk_size: string;
    chunk_overlap: string;
  }): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          provider: aiAgent.ai_agent_type_id,
          base_url: aiAgent.base_url?.trim().replace(/\/+$/, '') ?? '',
          embedding_model: aiAgent.embedding_model?.trim() ?? '',
          chunk_size: aiAgent.chunk_size,
          chunk_overlap: aiAgent.chunk_overlap,
          dimensions: this.embeddingDimensions,
        })
      )
      .digest('hex');
  }

  private async assertEmbeddingGenerationIsCurrent(
    accountId: string,
    aiAgentId: string,
    expectedGeneration: string
  ): Promise<void> {
    const currentAgent = await this.aiAgentViewerRepository.viewAiAgent(
      aiAgentId,
      accountId
    );

    if (
      !currentAgent ||
      currentAgent.status !== EAiAgentStatus.active ||
      this.computeEmbeddingGeneration(currentAgent) !== expectedGeneration
    ) {
      throw new Error(
        'AI Agent embedding configuration changed while the job was running.'
      );
    }
  }

  private async assertPromptSourceIsCurrent(
    accountId: string,
    aiAgentId: string,
    aiAgentPromptId: string,
    expectedSourceValue: string
  ): Promise<void> {
    const currentPrompt =
      await this.aiAgentPromptViewerRepository.viewAiAgentPrompt(
        aiAgentPromptId,
        accountId
      );

    if (
      !currentPrompt ||
      currentPrompt.ai_agent_id !== aiAgentId ||
      currentPrompt.status !== EAiAgentStatus.active ||
      currentPrompt.value !== expectedSourceValue
    ) {
      throw new Error(
        'AI Agent prompt changed while the embedding job was running.'
      );
    }
  }

  private buildLegacyCompatibleEmbeddingModelFilter(
    embeddingModel: string
  ): Record<string, unknown> {
    return {
      bool: {
        should: [
          { term: { embedding_model: embeddingModel } },
          {
            bool: {
              must_not: [{ exists: { field: 'embedding_model' } }],
            },
          },
        ],
        minimum_should_match: 1,
      },
    };
  }

  private createEmbeddingDocuments(
    chunks: IChunk[],
    embeddings: number[][] | null,
    accountId: string,
    aiAgentId: string,
    aiAgentPromptId: string,
    embeddingModel: string | null,
    embeddingGeneration: string
  ): IEmbeddingDocument[] {
    const now = new Date().toISOString();
    const nowEpochMillis = Date.now();
    const contentRevision = this.computePromptContentRevision(
      chunks,
      embeddingGeneration
    );

    return chunks.map((chunk, idx) => {
      const sourceId = `${accountId}:${aiAgentId}:${aiAgentPromptId}:${chunk.index}`;
      const contentFingerprint = this.computeContentFingerprint(
        chunk.text,
        sourceId,
        embeddingModel,
        this.embeddingDimensions,
        embeddingGeneration
      );

      return {
        account_id: accountId,
        ai_agent_id: aiAgentId,
        ai_agent_prompt_id: aiAgentPromptId,
        chunk_index: chunk.index,
        chunk_count: chunks.length,
        chunk_text: chunk.text,
        embedding: embeddings ? embeddings[idx] : null,
        has_embedding: embeddings !== null,
        created_at: now,
        content_fingerprint: contentFingerprint,
        content_revision: contentRevision,
        embedding_model: embeddingModel,
        embedding_generation: embeddingGeneration,
        updated_at: now,
        updated_at_epoch_millis: nowEpochMillis,
      };
    });
  }

  private buildEmbeddingDocumentId(doc: IEmbeddingDocument): string {
    const payload = `${doc.account_id}:${doc.ai_agent_id}:${doc.ai_agent_prompt_id}:${doc.embedding_generation ?? 'legacy'}:${doc.content_revision ?? 'legacy'}:${doc.chunk_index}`;
    return createHash('sha256').update(payload).digest('hex').substring(0, 32);
  }

  private async deleteStalePromptEmbeddingDocuments(
    aiAgentPromptId: string,
    activeDocuments: IEmbeddingDocument[]
  ): Promise<void> {
    if (activeDocuments.length === 0) {
      const deleted = await this.deletePromptEmbeddings(aiAgentPromptId);
      if (!deleted) {
        throw new Error('Failed to remove stale prompt embeddings.');
      }
      return;
    }

    await this.elasticClient.deleteByQuery({
      index: this.indexName,
      conflicts: 'proceed',
      query: {
        bool: {
          filter: [{ term: { ai_agent_prompt_id: aiAgentPromptId } }],
          must_not: [
            {
              ids: {
                values: activeDocuments.map((document) =>
                  this.buildEmbeddingDocumentId(document)
                ),
              },
            },
          ],
        },
      },
      refresh: true,
    });
  }

  private async bulkIndexDocuments(
    documents: IEmbeddingDocument[]
  ): Promise<void> {
    if (documents.length === 0) {
      return;
    }

    const scriptSource = `
      if (ctx.op == 'create') {
        ctx._source = params.doc;
      } else if (
        ctx._source != null &&
        ctx._source.containsKey('content_fingerprint') &&
        ctx._source.content_fingerprint == params.content_fingerprint &&
        ctx._source.embedding_generation == params.embedding_generation &&
        ctx._source.content_revision == params.content_revision
      ) {
        ctx.op = 'noop';
      } else {
        ctx._source = params.doc;
      }
    `;

    const operations = documents.map((doc) => {
      const documentId = this.buildEmbeddingDocumentId(doc);

      return {
        id: documentId,
        script: {
          source: scriptSource,
          params: {
            doc: doc as unknown as Record<string, unknown>,
            content_fingerprint: doc.content_fingerprint,
            embedding_generation: doc.embedding_generation,
            content_revision: doc.content_revision,
          },
        },
        upsert: doc as unknown as Record<string, unknown>,
      };
    });

    await this.elasticDatabaseService.bulkUpdateWithScript(
      this.indexName,
      operations
    );
  }

  private async commitPromptEmbeddingDocuments(
    accountId: string,
    aiAgentId: string,
    aiAgentPromptId: string,
    expectedSourceValue: string,
    embeddingGeneration: string,
    documents: IEmbeddingDocument[]
  ): Promise<void> {
    await this.withEmbeddingGenerationLock(
      accountId,
      aiAgentId,
      async (lockContext) => {
        lockContext.assertActive();
        await this.assertEmbeddingGenerationIsCurrent(
          accountId,
          aiAgentId,
          embeddingGeneration
        );
        await this.assertPromptSourceIsCurrent(
          accountId,
          aiAgentId,
          aiAgentPromptId,
          expectedSourceValue
        );
        lockContext.assertActive();
        await this.bulkIndexDocuments(documents);
        await this.assertEmbeddingGenerationIsCurrent(
          accountId,
          aiAgentId,
          embeddingGeneration
        );
        await this.assertPromptSourceIsCurrent(
          accountId,
          aiAgentId,
          aiAgentPromptId,
          expectedSourceValue
        );
        lockContext.assertActive();
        await this.deleteStalePromptEmbeddingDocuments(
          aiAgentPromptId,
          documents
        );
      }
    );
  }

  async processAndStoreEmbeddings(
    accountId: string,
    aiAgentId: string,
    aiAgentPromptId: string,
    text: string,
    expectedSourceValue: string
  ): Promise<number> {
    await this.ensureIndex();

    const aiAgent = await this.aiAgentViewerRepository.viewAiAgent(
      aiAgentId,
      accountId
    );

    if (!aiAgent) {
      throw new Error('AI Agent not found.');
    }

    const embeddingOptional = this.isEmbeddingOptional(
      aiAgent.ai_agent_type_id
    );
    const hasEmbeddingModel = !!aiAgent.embedding_model;
    const embeddingGeneration = this.computeEmbeddingGeneration(aiAgent);

    if (embeddingOptional && !hasEmbeddingModel) {
      const { size, overlap } = this.parseChunkConfig(
        aiAgent.chunk_size,
        aiAgent.chunk_overlap
      );

      const chunks = this.splitTextIntoChunks(text, size, overlap);

      if (chunks.length === 0) {
        await this.commitPromptEmbeddingDocuments(
          accountId,
          aiAgentId,
          aiAgentPromptId,
          expectedSourceValue,
          embeddingGeneration,
          []
        );
        return 0;
      }

      const documents = this.createEmbeddingDocuments(
        chunks,
        null,
        accountId,
        aiAgentId,
        aiAgentPromptId,
        null,
        embeddingGeneration
      );

      await this.commitPromptEmbeddingDocuments(
        accountId,
        aiAgentId,
        aiAgentPromptId,
        expectedSourceValue,
        embeddingGeneration,
        documents
      );

      return documents.length;
    }

    this.validateAiAgentConfig(aiAgent, true);

    if (!aiAgent.embedding_model) {
      throw new InvalidConfigurationError(
        'AI Agent embedding_model is not configured.'
      );
    }

    const { size, overlap } = this.parseChunkConfig(
      aiAgent.chunk_size,
      aiAgent.chunk_overlap
    );

    const chunks = this.splitTextIntoChunks(text, size, overlap);

    if (chunks.length === 0) {
      await this.commitPromptEmbeddingDocuments(
        accountId,
        aiAgentId,
        aiAgentPromptId,
        expectedSourceValue,
        embeddingGeneration,
        []
      );
      return 0;
    }

    const chunkTexts = chunks.map((chunk) => chunk.text);
    const embeddings = await this.generateEmbeddings(
      chunkTexts,
      aiAgent.base_url,
      aiAgent.api_key,
      aiAgent.embedding_model,
      aiAgent.ai_agent_type_id
    );

    const documents = this.createEmbeddingDocuments(
      chunks,
      embeddings,
      accountId,
      aiAgentId,
      aiAgentPromptId,
      aiAgent.embedding_model,
      embeddingGeneration
    );

    await this.commitPromptEmbeddingDocuments(
      accountId,
      aiAgentId,
      aiAgentPromptId,
      expectedSourceValue,
      embeddingGeneration,
      documents
    );

    return documents.length;
  }

  private buildSimilaritySearchQuery(
    accountId: string,
    aiAgentId: string,
    embeddingModel: string,
    embeddingGeneration: string,
    queryVector: number[],
    topK: number,
    options?: {
      allowedPromptIds?: string[];
    }
  ): any {
    const filterClauses: any[] = [
      { term: { account_id: accountId } },
      { term: { ai_agent_id: aiAgentId } },
      { term: { has_embedding: true } },
      { term: { embedding_model: embeddingModel } },
      { term: { embedding_generation: embeddingGeneration } },
    ];

    if (options?.allowedPromptIds && options.allowedPromptIds.length > 0) {
      filterClauses.push({
        terms: {
          ai_agent_prompt_id: options.allowedPromptIds,
        },
      });
    }

    return {
      index: this.indexName,
      size: topK,
      query: {
        bool: {
          must: [
            {
              script_score: {
                query: {
                  bool: {
                    filter: filterClauses,
                  },
                },
                script: {
                  source:
                    "cosineSimilarity(params.query_vector, 'embedding') + 1.0",
                  params: {
                    query_vector: queryVector,
                  },
                },
              },
            },
          ],
        },
      },
    };
  }

  private parseSearchResults(
    hits: Array<{
      _score: number;
      _source: IEmbeddingDocument;
    }>
  ): Array<{ text: string; score: number; promptId: string }> {
    return hits.map((hit) => ({
      text: hit._source.chunk_text,
      score: hit._score - 1.0,
      promptId: hit._source.ai_agent_prompt_id,
    }));
  }

  private buildTextSearchQuery(
    accountId: string,
    aiAgentId: string,
    queryText: string,
    topK: number,
    options?: {
      allowedPromptIds?: string[];
      includeEmbeddedDocuments?: boolean;
    }
  ): any {
    const filterClauses: any[] = [
      { term: { account_id: accountId } },
      { term: { ai_agent_id: aiAgentId } },
    ];

    if (!options?.includeEmbeddedDocuments) {
      filterClauses.push({ term: { has_embedding: false } });
    }

    if (options?.allowedPromptIds && options.allowedPromptIds.length > 0) {
      filterClauses.push({
        terms: {
          ai_agent_prompt_id: options.allowedPromptIds,
        },
      });
    }

    return {
      index: this.indexName,
      size: topK * 2,
      query: {
        bool: {
          must: [
            {
              match: {
                chunk_text: {
                  query: queryText,
                },
              },
            },
          ],
          filter: filterClauses,
        },
      },
    };
  }

  private parseTextSearchResults(
    hits: Array<{
      _score: number;
      _source: IEmbeddingDocument;
    }>
  ): Array<{ text: string; score: number; promptId: string }> {
    return hits.map((hit) => ({
      text: hit._source.chunk_text,
      score:
        hit._score > 0
          ? Math.max(0, Math.min(1, hit._score / (hit._score + 1)))
          : 0,
      promptId: hit._source.ai_agent_prompt_id,
    }));
  }

  private mergeSearchCandidates(
    semantic: Array<{ text: string; score: number; promptId: string }>,
    lexical: Array<{ text: string; score: number; promptId: string }>,
    topK: number
  ): Array<{ text: string; score: number; promptId: string }> {
    const merged: Array<{ text: string; score: number; promptId: string }> = [];
    const seen = new Set<string>();
    const maxLength = Math.max(semantic.length, lexical.length);

    const append = (
      candidate: { text: string; score: number; promptId: string } | undefined
    ): void => {
      if (!candidate || merged.length >= topK) {
        return;
      }

      const key = `${candidate.promptId}:${candidate.text}`;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      merged.push(candidate);
    };

    for (let index = 0; index < maxLength && merged.length < topK; index += 1) {
      append(semantic[index]);
      append(lexical[index]);
    }

    return merged;
  }

  async searchSimilarChunks(
    accountId: string,
    aiAgentId: string,
    queryText: string,
    topK = 5,
    options?: {
      allowedPromptIds?: string[];
    }
  ): Promise<Array<{ text: string; score: number; promptId: string }>> {
    if (options?.allowedPromptIds && options.allowedPromptIds.length === 0) {
      return [];
    }

    const aiAgent = await this.aiAgentViewerRepository.viewAiAgent(
      aiAgentId,
      accountId
    );

    if (!aiAgent) {
      throw new Error('AI Agent not found.');
    }

    const embeddingOptional = this.isEmbeddingOptional(
      aiAgent.ai_agent_type_id
    );
    const hasEmbeddingModel = !!aiAgent.embedding_model;

    if (embeddingOptional && !hasEmbeddingModel) {
      const searchQuery = this.buildTextSearchQuery(
        accountId,
        aiAgentId,
        queryText,
        topK,
        {
          allowedPromptIds: options?.allowedPromptIds,
        }
      );

      const response = await this.elasticClient.search(searchQuery);

      const hits = response.hits.hits as Array<{
        _score: number;
        _source: IEmbeddingDocument;
      }>;

      return this.mergeSearchCandidates(
        [],
        this.parseTextSearchResults(hits),
        topK
      );
    }

    this.validateAiAgentConfig(aiAgent, true);

    if (!aiAgent.embedding_model) {
      throw new InvalidConfigurationError(
        'AI Agent embedding_model is not configured.'
      );
    }

    const lexicalSearch = this.elasticClient
      .search(
        this.buildTextSearchQuery(accountId, aiAgentId, queryText, topK, {
          allowedPromptIds: options?.allowedPromptIds,
          includeEmbeddedDocuments: true,
        })
      )
      .catch((error) => {
        console.error('[EmbeddingService] lexical prompt search failed', {
          account_id: accountId,
          ai_agent_id: aiAgentId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });

    let semanticResults: Array<{
      text: string;
      score: number;
      promptId: string;
    }> = [];

    try {
      const embeddings = await this.generateEmbeddings(
        [queryText],
        aiAgent.base_url,
        aiAgent.api_key,
        aiAgent.embedding_model,
        aiAgent.ai_agent_type_id
      );
      const queryVector = embeddings[0];
      const searchQuery = this.buildSimilaritySearchQuery(
        accountId,
        aiAgentId,
        aiAgent.embedding_model,
        this.computeEmbeddingGeneration(aiAgent),
        queryVector,
        topK,
        {
          allowedPromptIds: options?.allowedPromptIds,
        }
      );
      const response = await this.elasticClient.search(searchQuery);
      const hits = response.hits.hits as Array<{
        _score: number;
        _source: IEmbeddingDocument;
      }>;

      semanticResults = this.parseSearchResults(hits);
    } catch (error) {
      console.error(
        '[EmbeddingService] semantic prompt search failed; using lexical fallback',
        {
          account_id: accountId,
          ai_agent_id: aiAgentId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    const lexicalResponse = await lexicalSearch;
    if (!lexicalResponse) {
      return semanticResults.slice(0, topK);
    }

    const lexicalHits = lexicalResponse.hits.hits as Array<{
      _score: number;
      _source: IEmbeddingDocument;
    }>;

    return this.mergeSearchCandidates(
      semanticResults,
      this.parseTextSearchResults(lexicalHits),
      topK
    );
  }

  private async checkIndexExists(): Promise<boolean> {
    return this.elasticClient.indices.exists({
      index: this.indexName,
    });
  }

  async hasCompletePromptEmbeddingGeneration(
    accountId: string,
    aiAgentId: string,
    activePromptIds: string[]
  ): Promise<boolean> {
    if (activePromptIds.length === 0) {
      return true;
    }

    await this.ensureIndex();
    const aiAgent = await this.aiAgentViewerRepository.viewAiAgent(
      aiAgentId,
      accountId
    );
    if (!aiAgent) {
      return false;
    }

    const embeddingGeneration = this.computeEmbeddingGeneration(aiAgent);
    const response = await this.elasticClient.search({
      index: this.indexName,
      size: 0,
      query: {
        bool: {
          filter: [
            { term: { account_id: accountId } },
            { term: { ai_agent_id: aiAgentId } },
            { term: { embedding_generation: embeddingGeneration } },
            { terms: { ai_agent_prompt_id: activePromptIds } },
          ],
        },
      },
      aggs: {
        prompt_ids: {
          terms: {
            field: 'ai_agent_prompt_id',
            size: activePromptIds.length,
          },
          aggs: {
            content_revisions: {
              terms: {
                field: 'content_revision',
                size: 100,
              },
              aggs: {
                expected_chunk_count: {
                  max: {
                    field: 'chunk_count',
                  },
                },
              },
            },
          },
        },
      },
    });
    const aggregation = response.aggregations?.prompt_ids as
      | {
          buckets?: Array<{
            key?: unknown;
            doc_count?: number;
            content_revisions?: {
              buckets?: Array<{
                doc_count?: number;
                expected_chunk_count?: { value?: number | null };
              }>;
            };
          }>;
        }
      | undefined;
    const completePromptIds = new Set(
      (aggregation?.buckets ?? [])
        .filter((bucket) => {
          const revisions = bucket.content_revisions?.buckets ?? [];
          if (revisions.length !== 1) {
            return false;
          }

          const [revision] = revisions;
          const expectedChunkCount = revision.expected_chunk_count?.value;
          return (
            typeof expectedChunkCount === 'number' &&
            expectedChunkCount > 0 &&
            revision.doc_count === expectedChunkCount &&
            bucket.doc_count === expectedChunkCount
          );
        })
        .map((bucket) => {
          return typeof bucket.key === 'string'
            ? bucket.key
            : String(bucket.key ?? '');
        })
        .filter(Boolean)
    );

    return activePromptIds.every((promptId) => completePromptIds.has(promptId));
  }

  async deletePromptEmbeddings(aiAgentPromptId: string): Promise<boolean> {
    try {
      const exists = await this.checkIndexExists();

      if (!exists) {
        return true;
      }

      await this.elasticClient.deleteByQuery({
        index: this.indexName,
        query: {
          term: {
            ai_agent_prompt_id: aiAgentPromptId,
          },
        },
        refresh: true,
      });

      return true;
    } catch {
      return false;
    }
  }

  async deleteAgentEmbeddings(
    accountId: string,
    aiAgentId: string
  ): Promise<boolean> {
    try {
      const promptIndexExists = await this.checkIndexExists();
      const chatHistoryIndexExists = await this.checkChatHistoryIndexExists();

      const deletePromises: Promise<any>[] = [];

      if (promptIndexExists) {
        deletePromises.push(
          this.elasticClient.deleteByQuery({
            index: this.indexName,
            query: {
              bool: {
                filter: [
                  { term: { account_id: accountId } },
                  { term: { ai_agent_id: aiAgentId } },
                ],
              },
            },
            refresh: true,
          })
        );
      }

      if (chatHistoryIndexExists) {
        deletePromises.push(
          this.elasticClient.deleteByQuery({
            index: this.chatHistoryIndexName,
            query: {
              bool: {
                filter: [
                  { term: { account_id: accountId } },
                  { term: { ai_agent_id: aiAgentId } },
                ],
              },
            },
            refresh: true,
          })
        );
      }

      if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
      }

      return true;
    } catch {
      return false;
    }
  }

  async invalidateChatHistoryEmbeddingGeneration(
    accountId: string,
    aiAgentId: string
  ): Promise<void> {
    const chatIndexExists = await this.elasticClient.indices.exists({
      index: EElasticIndex.chat,
    });

    if (!chatIndexExists) {
      return;
    }

    const result = await this.elasticDatabaseService.updateByQueryWithScript(
      EElasticIndex.chat,
      {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: { 'account.id': accountId },
                },
              },
            },
          ],
          filter: [{ term: { embedded_for_ai_agents: aiAgentId } }],
        },
      },
      {
        source: `
          if (ctx._source.embedded_for_ai_agents == null) {
            ctx.op = 'noop';
            return;
          }
          for (int index = ctx._source.embedded_for_ai_agents.size() - 1; index >= 0; index--) {
            if (ctx._source.embedded_for_ai_agents[index] == params.ai_agent_id) {
              ctx._source.embedded_for_ai_agents.remove(index);
            }
          }
        `,
        params: { ai_agent_id: aiAgentId },
      },
      {
        conflicts: 'proceed',
        refresh: true,
        maxRetries: 5,
      }
    );

    if (result.failures.length > 0) {
      throw new Error(
        `Failed to invalidate ${result.failures.length} chat embedding marker(s).`
      );
    }
  }

  private async checkChatHistoryIndexExists(): Promise<boolean> {
    return this.elasticClient.indices.exists({
      index: this.chatHistoryIndexName,
    });
  }

  private async ensureChatHistoryIndex(): Promise<void> {
    const exists = await this.elasticClient.indices.exists({
      index: this.chatHistoryIndexName,
    });

    if (!exists) {
      const mappings = chatHistoryEmbeddingMappings(this.embeddingDimensions);
      await this.elasticClient.indices.create({
        index: this.chatHistoryIndexName,
        settings: mappings.settings,
        mappings: mappings.mappings,
      });
      this.chatHistoryMappingEnsured = true;
      return;
    }

    if (!this.chatHistoryMappingEnsured) {
      await this.elasticClient.indices.putMapping({
        index: this.chatHistoryIndexName,
        properties: {
          embedding_model: {
            type: 'keyword',
          },
          embedding_generation: {
            type: 'keyword',
          },
        },
      });
      this.chatHistoryMappingEnsured = true;
    }
  }

  private buildChatHistoryEmbeddingDocumentId(
    document: IChatHistoryEmbeddingDocument
  ): string {
    const contentRevision = createHash('sha256')
      .update(document.message_text)
      .digest('hex');
    const payload = `${document.account_id}:${document.chat_id}:${document.ai_agent_id}:${document.embedding_generation ?? 'legacy'}:${document.message_id}:${contentRevision}`;
    return createHash('sha256').update(payload).digest('hex');
  }

  private async bulkIndexChatHistoryDocuments(
    documents: IChatHistoryEmbeddingDocument[]
  ): Promise<void> {
    const result = await this.elasticDatabaseService.bulkCreateIdempotent(
      this.chatHistoryIndexName,
      documents,
      (document) => this.buildChatHistoryEmbeddingDocumentId(document)
    );

    if (result.created + result.conflicts !== documents.length) {
      throw new Error(
        `Failed to persist all chat history embeddings (${result.created + result.conflicts}/${documents.length}).`
      );
    }

    await this.elasticClient.indices.refresh({
      index: this.chatHistoryIndexName,
    });
  }

  private async deleteStaleChatHistoryDocuments(
    accountId: string,
    chatId: string,
    aiAgentId: string,
    activeDocuments: IChatHistoryEmbeddingDocument[]
  ): Promise<void> {
    await this.elasticClient.deleteByQuery({
      index: this.chatHistoryIndexName,
      conflicts: 'proceed',
      query: {
        bool: {
          filter: [
            { term: { account_id: accountId } },
            { term: { chat_id: chatId } },
            { term: { ai_agent_id: aiAgentId } },
          ],
          must_not: [
            {
              ids: {
                values: activeDocuments.map((document) =>
                  this.buildChatHistoryEmbeddingDocumentId(document)
                ),
              },
            },
          ],
        },
      },
      refresh: true,
    });
  }

  private async commitChatHistoryDocuments(
    accountId: string,
    chatId: string,
    aiAgentId: string,
    embeddingGeneration: string,
    documents: IChatHistoryEmbeddingDocument[]
  ): Promise<void> {
    await this.withEmbeddingGenerationLock(
      accountId,
      aiAgentId,
      async (lockContext) => {
        lockContext.assertActive();
        await this.assertEmbeddingGenerationIsCurrent(
          accountId,
          aiAgentId,
          embeddingGeneration
        );
        lockContext.assertActive();
        await this.bulkIndexChatHistoryDocuments(documents);
        await this.assertEmbeddingGenerationIsCurrent(
          accountId,
          aiAgentId,
          embeddingGeneration
        );
        lockContext.assertActive();
        await this.deleteStaleChatHistoryDocuments(
          accountId,
          chatId,
          aiAgentId,
          documents
        );

        lockContext.assertActive();
        const marked = await this.markChatAsEmbedded(
          accountId,
          chatId,
          aiAgentId
        );
        if (!marked) {
          throw new Error(
            'Failed to mark chat history embeddings as complete.'
          );
        }
      }
    );
  }

  async processChatHistoryEmbeddings(
    accountId: string,
    chatId: string,
    aiAgentId: string,
    phone?: string | null
  ): Promise<number> {
    const lockKey = `chat-history-embedding:${accountId}:${chatId}:${aiAgentId}`;

    return withLock(this.redis, lockKey, () =>
      this.processChatHistoryEmbeddingsInternal(
        accountId,
        chatId,
        aiAgentId,
        phone
      )
    );
  }

  private async processChatHistoryEmbeddingsInternal(
    accountId: string,
    chatId: string,
    aiAgentId: string,
    phone?: string | null
  ): Promise<number> {
    await this.ensureChatHistoryIndex();

    const aiAgent = await this.aiAgentViewerRepository.viewAiAgent(
      aiAgentId,
      accountId
    );

    if (!aiAgent) {
      throw new Error('AI Agent not found.');
    }

    const embeddingOptional = this.isEmbeddingOptional(
      aiAgent.ai_agent_type_id
    );
    const hasEmbeddingModel = !!aiAgent.embedding_model;
    const embeddingGeneration = this.computeEmbeddingGeneration(aiAgent);

    if (embeddingOptional && !hasEmbeddingModel) {
      const queryElastic = {
        size: 100,
        sort: [{ date: { order: 'desc' } }],
        query: {
          bool: {
            must: [
              {
                nested: {
                  path: 'account',
                  query: {
                    term: {
                      'account.id': accountId,
                    },
                  },
                },
              },
            ],
            filter: [
              {
                term: {
                  chat_id: chatId,
                },
              },
              {
                terms: {
                  'content.type': ['text', 'system', 'annotation'],
                },
              },
            ],
          },
        },
      };

      const result = await this.elasticDatabaseService.select<IChatMessage>(
        EElasticIndex.message,
        queryElastic
      );

      if (!result || !result.hits.hits || result.hits.hits.length === 0) {
        return 0;
      }

      const messages: Array<{
        text: string;
        message_id: string;
        is_assistant_response: boolean;
        phone: string | null;
      }> = [];

      for (const hit of result.hits.hits.reverse()) {
        const message = hit._source as IChatMessage;
        if (!message.content || !message.message_id) {
          continue;
        }

        const text = extractMessageTextFromContent(message.content);
        if (!text || text.trim().length === 0) {
          continue;
        }

        const isAssistantResponse =
          message.type_user === ETypeUserChat.bot ||
          message.type_user === ETypeUserChat.system;

        messages.push({
          text,
          message_id: message.message_id,
          is_assistant_response: isAssistantResponse,
          phone: message.phone || phone || null,
        });
      }

      if (messages.length === 0) {
        return 0;
      }

      const now = new Date().toISOString();
      const documents: IChatHistoryEmbeddingDocument[] = messages.map((msg) => {
        const isAssistantResponse = msg.is_assistant_response;
        const initialQualityScore = isAssistantResponse ? 0.5 : 0.3;

        return {
          account_id: accountId,
          chat_id: chatId,
          ai_agent_id: aiAgentId,
          message_id: msg.message_id,
          message_text: msg.text,
          embedding: null,
          has_embedding: false,
          embedding_model: null,
          embedding_generation: embeddingGeneration,
          created_at: now,
          phone: msg.phone,
          quality_score: initialQualityScore,
          is_useful: isAssistantResponse ? true : null,
          is_assistant_response: isAssistantResponse,
        };
      });

      await this.commitChatHistoryDocuments(
        accountId,
        chatId,
        aiAgentId,
        embeddingGeneration,
        documents
      );

      return documents.length;
    }

    this.validateAiAgentConfig(aiAgent, true);

    if (!aiAgent.embedding_model) {
      throw new InvalidConfigurationError(
        'AI Agent embedding_model is not configured.'
      );
    }

    const queryElastic = {
      size: 100,
      sort: [{ date: { order: 'desc' } }],
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
          ],
          filter: [
            {
              term: {
                chat_id: chatId,
              },
            },
            {
              terms: {
                'content.type': ['text', 'system', 'annotation'],
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<IChatMessage>(
      EElasticIndex.message,
      queryElastic
    );

    if (!result || !result.hits.hits || result.hits.hits.length === 0) {
      return 0;
    }

    const messages: Array<{
      text: string;
      message_id: string;
      is_assistant_response: boolean;
      phone: string | null;
    }> = [];

    for (const hit of result.hits.hits.reverse()) {
      const message = hit._source as IChatMessage;
      if (!message.content || !message.message_id) {
        continue;
      }

      const text = extractMessageTextFromContent(message.content);
      if (!text || text.trim().length === 0) {
        continue;
      }

      const isAssistantResponse =
        message.type_user === ETypeUserChat.bot ||
        message.type_user === ETypeUserChat.system;

      messages.push({
        text,
        message_id: message.message_id,
        is_assistant_response: isAssistantResponse,
        phone: message.phone || phone || null,
      });
    }

    if (messages.length === 0) {
      return 0;
    }

    const messageTexts = messages.map((m) => m.text);
    const embeddings = await this.generateEmbeddings(
      messageTexts,
      aiAgent.base_url,
      aiAgent.api_key,
      aiAgent.embedding_model,
      aiAgent.ai_agent_type_id
    );

    const now = new Date().toISOString();
    const documents: IChatHistoryEmbeddingDocument[] = messages.map(
      (msg, idx) => {
        const isAssistantResponse = msg.is_assistant_response;
        const initialQualityScore = isAssistantResponse ? 0.5 : 0.3;

        return {
          account_id: accountId,
          chat_id: chatId,
          ai_agent_id: aiAgentId,
          message_id: msg.message_id,
          message_text: msg.text,
          embedding: embeddings[idx],
          has_embedding: true,
          embedding_model: aiAgent.embedding_model,
          embedding_generation: embeddingGeneration,
          created_at: now,
          phone: msg.phone,
          quality_score: initialQualityScore,
          is_useful: isAssistantResponse ? true : null,
          is_assistant_response: isAssistantResponse,
        };
      }
    );

    await this.commitChatHistoryDocuments(
      accountId,
      chatId,
      aiAgentId,
      embeddingGeneration,
      documents
    );

    return documents.length;
  }

  async processMultipleChatHistoryEmbeddings(
    accountId: string,
    phone: string,
    aiAgentId: string,
    excludeChatId?: string
  ): Promise<number> {
    if (!phone) {
      return 0;
    }

    const unembeddedChats = await this.findUnembeddedChatsByPhone(
      accountId,
      phone,
      aiAgentId,
      10,
      excludeChatId
    );

    if (unembeddedChats.length === 0) {
      return 0;
    }

    let totalProcessed = 0;
    let failedChats = 0;

    for (const chat of unembeddedChats) {
      try {
        const chatPhone = chat.phone || phone;
        const count = await this.processChatHistoryEmbeddings(
          accountId,
          chat.chat_id,
          aiAgentId,
          chatPhone
        );
        totalProcessed += count;
      } catch (error) {
        failedChats += 1;
        console.error(
          `[processMultipleChatHistoryEmbeddings] Erro ao processar chat ${chat.chat_id}:`,
          error
        );
      }
    }

    if (failedChats > 0) {
      throw new Error(
        `Failed to process ${failedChats} chat history embedding(s).`
      );
    }

    return totalProcessed;
  }

  private buildChatHistoryFilterClauses(
    accountId: string,
    aiAgentId: string,
    chatIds: string[],
    options?: {
      minQualityScore?: number;
      onlyUseful?: boolean;
      onlyAssistantResponses?: boolean;
    }
  ): any[] {
    const filterClauses: any[] = [
      { term: { account_id: accountId } },
      { term: { ai_agent_id: aiAgentId } },
    ];

    if (chatIds.length > 0) {
      filterClauses.push({ terms: { chat_id: chatIds } });
    }

    const minQualityScore = options?.minQualityScore ?? 0.0;
    if (minQualityScore > 0) {
      filterClauses.push({
        bool: {
          should: [
            {
              range: {
                quality_score: {
                  gte: minQualityScore,
                },
              },
            },
            {
              bool: {
                must_not: {
                  exists: {
                    field: 'quality_score',
                  },
                },
              },
            },
          ],
        },
      });
    }

    if (options?.onlyUseful) {
      filterClauses.push({
        bool: {
          should: [
            { term: { is_useful: true } },
            {
              bool: {
                must_not: {
                  exists: {
                    field: 'is_useful',
                  },
                },
              },
            },
          ],
        },
      });
    }

    if (options?.onlyAssistantResponses) {
      filterClauses.push({
        bool: {
          should: [
            { term: { is_assistant_response: true } },
            {
              bool: {
                must_not: {
                  exists: {
                    field: 'is_assistant_response',
                  },
                },
              },
            },
          ],
        },
      });
    }

    return filterClauses;
  }

  private buildChatHistoryTextSearchQuery(
    accountId: string,
    aiAgentId: string,
    queryText: string,
    topK: number,
    chatIds: string[],
    options?: {
      minQualityScore?: number;
      onlyUseful?: boolean;
      onlyAssistantResponses?: boolean;
      includeEmbeddedDocuments?: boolean;
    }
  ): any {
    const filterClauses = this.buildChatHistoryFilterClauses(
      accountId,
      aiAgentId,
      chatIds,
      options
    );

    if (!options?.includeEmbeddedDocuments) {
      filterClauses.push({ term: { has_embedding: false } });
    }

    return {
      index: this.chatHistoryIndexName,
      size: topK * 2,
      query: {
        bool: {
          must: [
            {
              match: {
                message_text: {
                  query: queryText,
                },
              },
            },
          ],
          filter: filterClauses,
        },
      },
    };
  }

  private parseChatHistoryLexicalResults(
    hits: Array<{
      _score: number;
      _source: IChatHistoryEmbeddingDocument;
    }>,
    minQualityScore: number
  ): Array<{ text: string; score: number; message_id: string }> {
    return hits
      .map((hit) => {
        const qualityScore = hit._source.quality_score || 0.0;
        const lexicalScore = hit._score > 0 ? hit._score / (hit._score + 1) : 0;
        const combinedScore = lexicalScore * 0.7 + qualityScore * 0.3;

        return {
          text: hit._source.message_text,
          score: Math.max(0, Math.min(1, combinedScore)),
          message_id: hit._source.message_id,
        };
      })
      .filter((result) => result.score >= minQualityScore);
  }

  private parseChatHistorySemanticResults(
    hits: Array<{
      _score: number;
      _source: IChatHistoryEmbeddingDocument;
    }>,
    minQualityScore: number
  ): Array<{ text: string; score: number; message_id: string }> {
    return hits
      .map((hit) => {
        const qualityScore = hit._source.quality_score || 0.0;
        const similarityScore = hit._score / (1.0 + qualityScore * 0.5) - 1.0;
        const combinedScore = similarityScore * 0.7 + qualityScore * 0.3;

        return {
          text: hit._source.message_text,
          score: Math.max(0, Math.min(1, combinedScore)),
          message_id: hit._source.message_id,
        };
      })
      .filter((result) => result.score >= minQualityScore);
  }

  private mergeChatHistorySearchCandidates(
    semantic: Array<{ text: string; score: number; message_id: string }>,
    lexical: Array<{ text: string; score: number; message_id: string }>,
    topK: number
  ): Array<{ text: string; score: number; message_id: string }> {
    const merged: Array<{ text: string; score: number; message_id: string }> =
      [];
    const seen = new Set<string>();
    const maxLength = Math.max(semantic.length, lexical.length);

    const append = (
      candidate: { text: string; score: number; message_id: string } | undefined
    ): void => {
      if (
        !candidate ||
        merged.length >= topK ||
        seen.has(candidate.message_id)
      ) {
        return;
      }

      seen.add(candidate.message_id);
      merged.push(candidate);
    };

    for (let index = 0; index < maxLength && merged.length < topK; index += 1) {
      append(semantic[index]);
      append(lexical[index]);
    }

    return merged;
  }

  private async resolveChatHistorySearchChatIds(
    accountId: string,
    chatId: string,
    phone: string | undefined,
    searchMultipleChats: boolean
  ): Promise<string[]> {
    if (!searchMultipleChats || !phone) {
      return [chatId];
    }

    const chatIds = await this.getChatIdsByPhone(accountId, phone);
    return chatIds.length > 0 ? chatIds : [chatId];
  }

  private buildChatHistorySimilaritySearchQuery(
    accountId: string,
    aiAgentId: string,
    chatIds: string[],
    embeddingModel: string,
    embeddingGeneration: string,
    queryVector: number[],
    topK: number,
    options?: {
      minQualityScore?: number;
      onlyUseful?: boolean;
      onlyAssistantResponses?: boolean;
    }
  ): any {
    const filterClauses = this.buildChatHistoryFilterClauses(
      accountId,
      aiAgentId,
      chatIds,
      options
    );
    filterClauses.push({ term: { has_embedding: true } });
    filterClauses.push(
      this.buildLegacyCompatibleEmbeddingModelFilter(embeddingModel)
    );
    filterClauses.push({
      term: { embedding_generation: embeddingGeneration },
    });

    return {
      index: this.chatHistoryIndexName,
      size: topK * 2,
      query: {
        bool: {
          must: [
            {
              script_score: {
                query: {
                  bool: {
                    filter: filterClauses,
                  },
                },
                script: {
                  source: `
                    double similarity = cosineSimilarity(params.query_vector, 'embedding') + 1.0;
                    double qualityBoost = 0.0;
                    if (doc['quality_score'].size() > 0) {
                      qualityBoost = doc['quality_score'].value;
                    }
                    return similarity * (1.0 + qualityBoost * 0.5);
                  `,
                  params: {
                    query_vector: queryVector,
                  },
                },
              },
            },
          ],
        },
      },
      sort: [
        { _score: { order: 'desc' as const } },
        { created_at: { order: 'desc' as const } },
      ] as any,
    };
  }

  async searchChatHistory(
    accountId: string,
    chatId: string,
    aiAgentId: string,
    queryText: string,
    topK = 10,
    phone?: string,
    options?: {
      searchMultipleChats?: boolean;
      minQualityScore?: number;
      onlyUseful?: boolean;
      onlyAssistantResponses?: boolean;
    }
  ): Promise<Array<{ text: string; score: number; message_id: string }>> {
    await this.ensureChatHistoryIndex();

    const aiAgent = await this.aiAgentViewerRepository.viewAiAgent(
      aiAgentId,
      accountId
    );

    if (!aiAgent) {
      return [];
    }

    const embeddingOptional = this.isEmbeddingOptional(
      aiAgent.ai_agent_type_id
    );
    const hasEmbeddingModel = !!aiAgent.embedding_model;
    const searchMultipleChats = options?.searchMultipleChats ?? true;
    const minQualityScore = options?.minQualityScore ?? 0.0;
    const chatIds = await this.resolveChatHistorySearchChatIds(
      accountId,
      chatId,
      phone,
      searchMultipleChats
    );

    if (embeddingOptional && !hasEmbeddingModel) {
      const searchQuery = this.buildChatHistoryTextSearchQuery(
        accountId,
        aiAgentId,
        queryText,
        topK,
        chatIds,
        options
      );

      try {
        const response = await this.elasticClient.search(searchQuery);

        const hits = response.hits.hits as Array<{
          _score: number;
          _source: IChatHistoryEmbeddingDocument;
        }>;

        return this.parseChatHistoryLexicalResults(hits, minQualityScore).slice(
          0,
          topK
        );
      } catch (error) {
        console.error('[searchChatHistory] Erro ao buscar histórico:', error);
        return [];
      }
    }

    this.validateAiAgentConfig(aiAgent, false);

    if (!aiAgent.embedding_model) {
      return [];
    }

    const lexicalSearch = this.elasticClient
      .search(
        this.buildChatHistoryTextSearchQuery(
          accountId,
          aiAgentId,
          queryText,
          topK,
          chatIds,
          {
            ...options,
            includeEmbeddedDocuments: true,
          }
        )
      )
      .then((response) => {
        const hits = response.hits.hits as Array<{
          _score: number;
          _source: IChatHistoryEmbeddingDocument;
        }>;
        return this.parseChatHistoryLexicalResults(hits, minQualityScore);
      })
      .catch((error) => {
        console.error('[EmbeddingService] lexical chat history search failed', {
          account_id: accountId,
          ai_agent_id: aiAgentId,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      });

    let semanticResults: Array<{
      text: string;
      score: number;
      message_id: string;
    }> = [];

    try {
      const embeddings = await this.generateEmbeddings(
        [queryText],
        aiAgent.base_url,
        aiAgent.api_key,
        aiAgent.embedding_model,
        aiAgent.ai_agent_type_id
      );
      const queryVector = embeddings[0];
      const searchQuery = this.buildChatHistorySimilaritySearchQuery(
        accountId,
        aiAgentId,
        chatIds,
        aiAgent.embedding_model,
        this.computeEmbeddingGeneration(aiAgent),
        queryVector,
        topK,
        options
      );
      const response = await this.elasticClient.search(searchQuery);
      const hits = response.hits.hits as Array<{
        _score: number;
        _source: IChatHistoryEmbeddingDocument;
      }>;

      semanticResults = this.parseChatHistorySemanticResults(
        hits,
        minQualityScore
      );
    } catch (error) {
      console.error(
        '[EmbeddingService] semantic chat history search failed; using lexical fallback',
        {
          account_id: accountId,
          ai_agent_id: aiAgentId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    return this.mergeChatHistorySearchCandidates(
      semanticResults,
      await lexicalSearch,
      topK
    );
  }

  private async getChatIdsByPhone(
    accountId: string,
    phone: string,
    limit = 50
  ): Promise<string[]> {
    try {
      const candidates = buildCandidates(phone);
      const shouldClauses: any[] = [];

      if (Array.isArray(candidates) && candidates.length > 0) {
        shouldClauses.push({ terms: { phone: candidates } });
      }

      if (shouldClauses.length === 0) {
        return [];
      }

      const queryElastic = {
        size: limit,
        _source: ['chat_id'],
        sort: [{ date: { order: 'desc' } }],
        query: {
          bool: {
            must: [
              {
                nested: {
                  path: 'account',
                  query: {
                    term: {
                      'account.id': accountId,
                    },
                  },
                },
              },
              {
                bool: {
                  should: shouldClauses,
                  minimum_should_match: 1,
                },
              },
            ],
          },
        },
      };

      const result = await this.elasticDatabaseService.select<IChat>(
        EElasticIndex.chat,
        queryElastic
      );

      if (!result || !result.hits.hits || result.hits.hits.length === 0) {
        return [];
      }

      return result.hits.hits
        .map((hit) => {
          const chat = (hit as ElasticHit<IChat>)._source;
          return chat?.chat_id;
        })
        .filter((id): id is string => id !== undefined);
    } catch (error) {
      console.error('[getChatIdsByPhone] Erro ao buscar chat IDs:', error);
      return [];
    }
  }

  async findUnembeddedChats(
    accountId: string,
    userId: string,
    aiAgentId: string,
    limit = 5
  ): Promise<IChat[]> {
    try {
      const queryElastic = {
        size: limit,
        sort: [{ date: { order: 'desc' } }],
        query: {
          bool: {
            must: [
              {
                nested: {
                  path: 'account',
                  query: {
                    term: {
                      'account.id': accountId,
                    },
                  },
                },
              },
              {
                nested: {
                  path: 'user',
                  query: {
                    term: {
                      'user.id': userId,
                    },
                  },
                },
              },
            ],
            must_not: [
              {
                term: {
                  embedded_for_ai_agents: aiAgentId,
                },
              },
            ],
          },
        },
      };

      const result = await this.elasticDatabaseService.select<IChat>(
        EElasticIndex.chat,
        queryElastic
      );

      if (!result || !result.hits.hits || result.hits.hits.length === 0) {
        return [];
      }

      const chats = result.hits.hits.map((hit) => {
        const chat = (hit as ElasticHit<IChat>)._source;
        if (chat && Array.isArray(chat.summary)) {
          chat.summary = chat.summary[0] as IChat['summary'];
        }
        return chat;
      });

      return chats.filter((chat): chat is IChat => chat !== undefined);
    } catch (error) {
      console.error('[findUnembeddedChats] Erro ao buscar chats:', error);
      return [];
    }
  }

  async findUnembeddedChatsByPhone(
    accountId: string,
    phone: string,
    aiAgentId: string,
    limit = 10,
    excludeChatId?: string
  ): Promise<IChat[]> {
    try {
      const candidates = buildCandidates(phone);
      const shouldClauses: any[] = [];

      if (Array.isArray(candidates) && candidates.length > 0) {
        shouldClauses.push({ terms: { phone: candidates } });
      }

      if (shouldClauses.length === 0) {
        return [];
      }

      const mustNotClauses: any[] = [
        {
          term: {
            embedded_for_ai_agents: aiAgentId,
          },
        },
      ];
      if (excludeChatId) {
        mustNotClauses.push({
          term: {
            chat_id: excludeChatId,
          },
        });
      }

      const queryElastic = {
        size: limit,
        sort: [{ date: { order: 'desc' } }],
        query: {
          bool: {
            must: [
              {
                nested: {
                  path: 'account',
                  query: {
                    term: {
                      'account.id': accountId,
                    },
                  },
                },
              },
              {
                bool: {
                  should: shouldClauses,
                  minimum_should_match: 1,
                },
              },
            ],
            filter: [{ term: { status: EChatStatus.closed } }],
            must_not: mustNotClauses,
          },
        },
      };

      const result = await this.elasticDatabaseService.select<IChat>(
        EElasticIndex.chat,
        queryElastic
      );

      if (!result || !result.hits.hits || result.hits.hits.length === 0) {
        return [];
      }

      const chats = result.hits.hits.map((hit) => {
        const chat = (hit as ElasticHit<IChat>)._source;
        if (chat && Array.isArray(chat.summary)) {
          chat.summary = chat.summary[0] as IChat['summary'];
        }
        return chat;
      });

      return chats.filter((chat): chat is IChat => chat !== undefined);
    } catch (error) {
      console.error(
        '[findUnembeddedChatsByPhone] Erro ao buscar chats:',
        error
      );
      throw error;
    }
  }

  async markChatAsEmbedded(
    accountId: string,
    chatId: string,
    aiAgentId: string
  ): Promise<boolean> {
    try {
      const queryElastic = {
        size: 1,
        _source: true,
        query: {
          bool: {
            must: [
              {
                nested: {
                  path: 'account',
                  query: {
                    term: {
                      'account.id': accountId,
                    },
                  },
                },
              },
            ],
            filter: [
              {
                term: {
                  chat_id: chatId,
                },
              },
              {
                term: {
                  status: EChatStatus.closed,
                },
              },
            ],
          },
        },
      };

      const result = await this.elasticDatabaseService.select<IChat>(
        EElasticIndex.chat,
        queryElastic
      );

      const hit = result?.hits?.hits?.[0] as ElasticHit<IChat> | undefined;
      const chat = hit?._source;

      if (!chat) {
        return false;
      }

      const updateResult =
        await this.elasticDatabaseService.updateWithScriptOCC(
          EElasticIndex.chat,
          chatId,
          {
            source: `
            if (ctx._source.status != params.closed_status) {
              ctx.op = 'noop';
              return;
            }
            if (ctx._source.embedded_for_ai_agents == null) {
              ctx._source.embedded_for_ai_agents = [];
            }
            if (ctx._source.embedded_for_ai_agents.contains(params.ai_agent_id)) {
              ctx.op = 'noop';
              return;
            }
            ctx._source.embedded_for_ai_agents.add(params.ai_agent_id);
          `,
            params: {
              ai_agent_id: aiAgentId,
              closed_status: EChatStatus.closed,
            },
          },
          {
            upsert: false,
            maxRetries: 5,
            refresh: true,
          }
        );

      if (
        updateResult !== 'updated' &&
        updateResult !== 'created' &&
        updateResult !== 'noop'
      ) {
        return false;
      }

      const confirmationResult =
        await this.elasticDatabaseService.select<IChat>(EElasticIndex.chat, {
          size: 1,
          _source: false,
          query: {
            bool: {
              must: [
                {
                  nested: {
                    path: 'account',
                    query: {
                      term: {
                        'account.id': accountId,
                      },
                    },
                  },
                },
              ],
              filter: [
                {
                  term: {
                    chat_id: chatId,
                  },
                },
                {
                  term: {
                    status: EChatStatus.closed,
                  },
                },
                {
                  term: {
                    embedded_for_ai_agents: aiAgentId,
                  },
                },
              ],
            },
          },
        });

      return Boolean(confirmationResult?.hits?.hits?.[0]);
    } catch (error) {
      console.error('[markChatAsEmbedded] Erro ao marcar chat:', error);
      return false;
    }
  }
}
