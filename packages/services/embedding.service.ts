import { injectable, inject } from 'tsyringe';
import { Client } from '@elastic/elasticsearch';
import { createHash } from 'crypto';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { IChunk } from '@core/common/interfaces/IChunk';
import { IEmbeddingDocument } from '@core/common/interfaces/IEmbeddingDocument';
import { IEmbeddingResponse } from '@core/common/interfaces/IEmbeddingResponse';
import { IGeminiBatchEmbedContentsResponse } from '@core/common/interfaces/IGeminiBatchEmbedContentsResponse';
import { IChatHistoryEmbeddingDocument } from '@core/common/interfaces/IChatHistoryEmbeddingDocument';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IChat } from '@core/common/interfaces/IChat';
import {
  IElasticBulkResponse,
  IElasticBulkCreateItem,
} from '@core/common/interfaces/IElasticBulk';
import { aiAgentPromptEmbeddingMappings } from '@core/mappings/aiAgentPromptEmbedding.mappings';
import { chatHistoryEmbeddingMappings } from '@core/mappings/chatHistoryEmbedding.mappings';
import { AiAgentViewerRepository } from '@core/repositories/aiAgent/AiAgentViewer.repository';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';

type ElasticHit<T> = {
  _source?: T;
};

type EmbeddingWritePolicy = 'skip_on_conflict' | 'update_if_newer';

@injectable()
export class EmbeddingService {
  private readonly indexName = EElasticIndex.ai_agent_prompt_embedding;
  private readonly chatHistoryIndexName = EElasticIndex.chat_history_embedding;
  private readonly embeddingDimensions = 1536;

  constructor(
    @inject('DatabaseElasticClient') private readonly elasticClient: Client,
    private readonly aiAgentViewerRepository: AiAgentViewerRepository,
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  private async ensureIndex(): Promise<void> {
    const exists = await this.elasticClient.indices.exists({
      index: this.indexName,
    });

    if (exists) {
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
    } catch (error) {
      throw new Error(`Failed to create index: ${error}`);
    }
  }

  private splitTextIntoChunks(
    text: string,
    chunkSize: number,
    overlap: number
  ): IChunk[] {
    const chunks: IChunk[] = [];

    const words = text.split(/\s+/);
    let currentChunkWords: string[] = [];
    let chunkIndex = 0;

    for (const word of words) {
      currentChunkWords.push(word);
      const currentText = currentChunkWords.join(' ');
      const tokenEstimate = Math.ceil(currentText.length / 4);

      if (tokenEstimate >= chunkSize) {
        chunks.push({
          text: currentText.trim(),
          index: chunkIndex,
        });
        chunkIndex++;

        const overlapWords = Math.ceil(
          (overlap / chunkSize) * currentChunkWords.length
        );
        currentChunkWords = currentChunkWords.slice(-overlapWords);
      }
    }

    if (currentChunkWords.length > 0) {
      const remainingText = currentChunkWords.join(' ').trim();
      if (remainingText.length > 0) {
        chunks.push({
          text: remainingText,
          index: chunkIndex,
        });
      }
    }

    return chunks;
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

  private normalizeEmbedding(embedding: number[]): number[] {
    if (embedding.length === this.embeddingDimensions) {
      return embedding;
    }

    if (embedding.length > this.embeddingDimensions) {
      return embedding.slice(0, this.embeddingDimensions);
    }

    const padded = embedding.slice();
    while (padded.length < this.embeddingDimensions) {
      padded.push(0);
    }
    return padded;
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
    const apiVersion = baseUrl.replace('/v1', '/v1beta');
    const url = `${apiVersion}/models/${encodeURIComponent(
      model
    )}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;

    const requestBody = {
      requests: texts.map((text) => ({
        model: `models/${model}`,
        content: {
          parts: [{ text }],
        },
      })),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as IGeminiBatchEmbedContentsResponse;

    const rawEmbeddings =
      data.embeddings?.map((e) => e.values ?? e.embedding?.values ?? []) ?? [];

    const normalized = rawEmbeddings.map((e) => this.normalizeEmbedding(e));

    return normalized;
  }

  private async callOpenAiEmbeddingApi(
    baseUrl: string,
    apiKey: string,
    model: string,
    texts: string[]
  ): Promise<number[][]> {
    const url = `${baseUrl}/embeddings`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as IEmbeddingResponse;

    const raw = data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    const normalized = raw.map((e) => this.normalizeEmbedding(e));

    return normalized;
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

    if (this.isGeminiAgent(aiAgentTypeId)) {
      return this.callGeminiEmbeddingApi(baseUrl, apiKey, model, texts);
    }

    return this.callOpenAiEmbeddingApi(baseUrl, apiKey, model, texts);
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
    embeddingDimensions: number
  ): string {
    const normalizedText = chunkText.trim().toLowerCase();
    const payload = JSON.stringify({
      text: normalizedText,
      source_id: sourceId,
      embedding_model: embeddingModel || '',
      embedding_dimensions: embeddingDimensions,
    });

    return createHash('sha256').update(payload).digest('hex');
  }

  private createEmbeddingDocuments(
    chunks: IChunk[],
    embeddings: number[][] | null,
    accountId: string,
    aiAgentId: string,
    aiAgentPromptId: string,
    embeddingModel: string | null
  ): IEmbeddingDocument[] {
    const now = new Date().toISOString();
    const nowEpochMillis = Date.now();

    return chunks.map((chunk, idx) => {
      const sourceId = `${accountId}:${aiAgentId}:${aiAgentPromptId}:${chunk.index}`;
      const contentFingerprint = this.computeContentFingerprint(
        chunk.text,
        sourceId,
        embeddingModel,
        this.embeddingDimensions
      );

      return {
        account_id: accountId,
        ai_agent_id: aiAgentId,
        ai_agent_prompt_id: aiAgentPromptId,
        chunk_index: chunk.index,
        chunk_text: chunk.text,
        embedding: embeddings ? embeddings[idx] : null,
        has_embedding: embeddings !== null,
        created_at: now,
        content_fingerprint: contentFingerprint,
        embedding_model: embeddingModel,
        updated_at: now,
        updated_at_epoch_millis: nowEpochMillis,
      };
    });
  }

  private buildEmbeddingDocumentId(doc: IEmbeddingDocument): string {
    const payload = `${doc.account_id}:${doc.ai_agent_id}:${doc.ai_agent_prompt_id}:${doc.chunk_index}`;
    return createHash('sha256').update(payload).digest('hex').substring(0, 32);
  }

  private buildBulkCreateBody(
    documents: IEmbeddingDocument[]
  ): Array<Record<string, unknown>> {
    const body: Array<Record<string, unknown> | IEmbeddingDocument> = [];

    for (const doc of documents) {
      const documentId = this.buildEmbeddingDocumentId(doc);
      body.push({
        create: {
          _index: this.indexName,
          _id: documentId,
        },
      });
      body.push(doc);
    }

    return body as Array<Record<string, unknown>>;
  }

  private extractConflictIds(response: IElasticBulkResponse): string[] {
    const conflictIds: string[] = [];

    for (const item of response.items) {
      const createItem = item as IElasticBulkCreateItem;
      if (!createItem.create) {
        continue;
      }

      if (createItem.create.error && createItem.create.status === 409) {
        if (createItem.create._id) {
          conflictIds.push(createItem.create._id);
        }
      }
    }

    return conflictIds;
  }

  private async fetchExistingFingerprints(
    ids: string[]
  ): Promise<Map<string, IEmbeddingDocument>> {
    if (ids.length === 0) {
      return new Map();
    }

    const docs: Array<{ _id: string; _source: IEmbeddingDocument }> = [];

    for (const id of ids) {
      try {
        const result = await this.elasticClient.get({
          index: this.indexName,
          id,
          _source: [
            'content_fingerprint',
            'embedding_model',
            'updated_at_epoch_millis',
          ],
        });
        if (result._source) {
          docs.push({ _id: id, _source: result._source as IEmbeddingDocument });
        }
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          error.statusCode === 404
        ) {
          continue;
        }
      }
    }

    const map = new Map<string, IEmbeddingDocument>();
    for (const doc of docs) {
      map.set(doc._id, doc._source);
    }

    return map;
  }

  private async handleEmbeddingConflicts(
    conflicts: string[],
    documentsById: Map<string, IEmbeddingDocument>,
    policy: EmbeddingWritePolicy
  ): Promise<number> {
    if (conflicts.length === 0) {
      return 0;
    }

    const existingDocs = await this.fetchExistingFingerprints(conflicts);
    let divergenceCount = 0;

    for (const conflictId of conflicts) {
      const newDoc = documentsById.get(conflictId);
      const existingDoc = existingDocs.get(conflictId);

      if (!newDoc) {
        continue;
      }

      if (!existingDoc) {
        continue;
      }

      const existingFingerprint = existingDoc.content_fingerprint;
      const newFingerprint = newDoc.content_fingerprint;

      if (existingFingerprint === newFingerprint) {
        continue;
      }

      divergenceCount++;

      if (policy === 'update_if_newer') {
        const existingEpoch = existingDoc.updated_at_epoch_millis ?? 0;
        const newEpoch = newDoc.updated_at_epoch_millis ?? 0;

        if (newEpoch > existingEpoch) {
          await this.updateEmbeddingDocument(conflictId, newDoc);
        }
      }
    }

    return divergenceCount;
  }

  private async updateEmbeddingDocument(
    id: string,
    doc: IEmbeddingDocument
  ): Promise<void> {
    const scriptSource = `
      ctx._source.embedding = params.embedding;
      ctx._source.content_fingerprint = params.content_fingerprint;
      ctx._source.embedding_model = params.embedding_model;
      ctx._source.updated_at = params.updated_at;
      ctx._source.updated_at_epoch_millis = params.updated_at_epoch_millis;
      ctx._source.has_embedding = params.has_embedding;
    `;

    const scriptParams = {
      embedding: doc.embedding,
      content_fingerprint: doc.content_fingerprint,
      embedding_model: doc.embedding_model,
      updated_at: doc.updated_at,
      updated_at_epoch_millis: doc.updated_at_epoch_millis,
      has_embedding: doc.has_embedding,
    };

    await this.elasticDatabaseService.updateWithScript(
      this.indexName,
      id,
      {
        source: scriptSource,
        params: scriptParams,
      },
      {
        retryOnConflict: 10,
      }
    );
  }

  private throwIfBulkHasNonConflictErrors(
    response: IElasticBulkResponse
  ): void {
    if (!response.errors) {
      return;
    }

    let failed = 0;
    const errorMessages: string[] = [];

    for (const item of response.items) {
      const createItem = item as IElasticBulkCreateItem;
      if (!createItem.create) {
        continue;
      }

      if (createItem.create.error) {
        if (createItem.create.status === 409) {
          continue;
        }

        failed++;
        if (errorMessages.length < 5) {
          errorMessages.push(
            `${createItem.create.error.type}: ${createItem.create.error.reason}`
          );
        }
      }
    }

    if (failed > 0) {
      throw new Error(
        `Bulk index failed: ${failed} errors. ${JSON.stringify(errorMessages)}`
      );
    }
  }

  private async bulkIndexDocuments(
    documents: IEmbeddingDocument[],
    options?: {
      refresh?: boolean | 'wait_for';
      writePolicy?: EmbeddingWritePolicy;
    }
  ): Promise<void> {
    if (documents.length === 0) {
      return;
    }

    const refreshOption = options?.refresh ?? false;
    const writePolicy = options?.writePolicy ?? 'skip_on_conflict';

    const documentsById = new Map<string, IEmbeddingDocument>();
    for (const doc of documents) {
      const documentId = this.buildEmbeddingDocumentId(doc);
      documentsById.set(documentId, doc);
    }

    const body = this.buildBulkCreateBody(documents);
    const bulkOptions: { refresh?: boolean | 'wait_for' } = {};
    if (refreshOption !== false) {
      bulkOptions.refresh = refreshOption;
    }

    const response = (await this.elasticClient.bulk({
      body,
      ...bulkOptions,
    })) as IElasticBulkResponse;

    this.throwIfBulkHasNonConflictErrors(response);

    if (response.errors) {
      const conflictIds = this.extractConflictIds(response);
      await this.handleEmbeddingConflicts(
        conflictIds,
        documentsById,
        writePolicy
      );
    }
  }

  async processAndStoreEmbeddings(
    accountId: string,
    aiAgentId: string,
    aiAgentPromptId: string,
    text: string
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

    if (embeddingOptional && !hasEmbeddingModel) {
      await this.deletePromptEmbeddings(aiAgentPromptId);

      const { size, overlap } = this.parseChunkConfig(
        aiAgent.chunk_size,
        aiAgent.chunk_overlap
      );

      const chunks = this.splitTextIntoChunks(text, size, overlap);

      if (chunks.length === 0) {
        return 0;
      }

      const documents = this.createEmbeddingDocuments(
        chunks,
        null,
        accountId,
        aiAgentId,
        aiAgentPromptId,
        null
      );

      await this.bulkIndexDocuments(documents);

      return documents.length;
    }

    this.validateAiAgentConfig(aiAgent, true);

    if (!aiAgent.embedding_model) {
      throw new InvalidConfigurationError(
        'AI Agent embedding_model is not configured.'
      );
    }

    await this.deletePromptEmbeddings(aiAgentPromptId);

    const { size, overlap } = this.parseChunkConfig(
      aiAgent.chunk_size,
      aiAgent.chunk_overlap
    );

    const chunks = this.splitTextIntoChunks(text, size, overlap);

    if (chunks.length === 0) {
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
      aiAgent.embedding_model
    );

    await this.bulkIndexDocuments(documents);

    return documents.length;
  }

  private buildSimilaritySearchQuery(
    accountId: string,
    aiAgentId: string,
    queryVector: number[],
    topK: number
  ): any {
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
                    filter: [
                      { term: { account_id: accountId } },
                      { term: { ai_agent_id: aiAgentId } },
                      { term: { has_embedding: true } },
                    ],
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
    topK: number
  ): any {
    return {
      index: this.indexName,
      size: topK,
      query: {
        bool: {
          filter: [
            { term: { account_id: accountId } },
            { term: { ai_agent_id: aiAgentId } },
            { term: { has_embedding: false } },
          ],
        },
      },
      sort: [
        { ai_agent_prompt_id: { order: 'asc' as const } },
        { chunk_index: { order: 'asc' as const } },
      ] as any,
    };
  }

  async searchSimilarChunks(
    accountId: string,
    aiAgentId: string,
    queryText: string,
    topK = 5
  ): Promise<Array<{ text: string; score: number; promptId: string }>> {
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
      const searchQuery = this.buildTextSearchQuery(accountId, aiAgentId, topK);

      const response = await this.elasticClient.search(searchQuery);

      const hits = response.hits.hits as Array<{
        _score: number;
        _source: IEmbeddingDocument;
      }>;

      return hits.map((hit) => ({
        text: hit._source.chunk_text,
        score: 1.0,
        promptId: hit._source.ai_agent_prompt_id,
      }));
    }

    this.validateAiAgentConfig(aiAgent, true);

    if (!aiAgent.embedding_model) {
      throw new InvalidConfigurationError(
        'AI Agent embedding_model is not configured.'
      );
    }

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
      queryVector,
      topK
    );

    const response = await this.elasticClient.search(searchQuery);

    const hits = response.hits.hits as Array<{
      _score: number;
      _source: IEmbeddingDocument;
    }>;

    const results = this.parseSearchResults(hits);

    return results;
  }

  private async checkIndexExists(): Promise<boolean> {
    return this.elasticClient.indices.exists({
      index: this.indexName,
    });
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
    }
  }

  async processChatHistoryEmbeddings(
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

    if (embeddingOptional && !hasEmbeddingModel) {
      const alreadyEmbedded = await this.hasChatHistoryEmbeddings(
        accountId,
        chatId,
        aiAgentId
      );

      if (alreadyEmbedded) {
        return 0;
      }

      await this.deleteChatHistoryEmbeddings(accountId, chatId, aiAgentId);

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
          created_at: now,
          phone: msg.phone,
          quality_score: initialQualityScore,
          is_useful: isAssistantResponse ? true : null,
          is_assistant_response: isAssistantResponse,
        };
      });

      const body = documents.flatMap((doc) => [
        {
          index: {
            _index: this.chatHistoryIndexName,
            _id: `${accountId}:${chatId}:${aiAgentId}:${doc.message_id}`,
          },
        },
        doc,
      ]);

      await this.elasticClient.bulk({ body, refresh: 'wait_for' });

      await this.markChatAsEmbedded(accountId, chatId, aiAgentId);

      return documents.length;
    }

    this.validateAiAgentConfig(aiAgent, true);

    if (!aiAgent.embedding_model) {
      throw new InvalidConfigurationError(
        'AI Agent embedding_model is not configured.'
      );
    }

    const alreadyEmbedded = await this.hasChatHistoryEmbeddings(
      accountId,
      chatId,
      aiAgentId
    );

    if (alreadyEmbedded) {
      return 0;
    }

    await this.deleteChatHistoryEmbeddings(accountId, chatId, aiAgentId);

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
          created_at: now,
          phone: msg.phone,
          quality_score: initialQualityScore,
          is_useful: isAssistantResponse ? true : null,
          is_assistant_response: isAssistantResponse,
        };
      }
    );

    const body = documents.flatMap((doc) => [
      {
        index: {
          _index: this.chatHistoryIndexName,
          _id: `${accountId}:${chatId}:${aiAgentId}:${doc.message_id}`,
        },
      },
      doc,
    ]);

    await this.elasticClient.bulk({ body, refresh: 'wait_for' });

    await this.markChatAsEmbedded(accountId, chatId, aiAgentId);

    return documents.length;
  }

  async processMultipleChatHistoryEmbeddings(
    accountId: string,
    phone: string,
    aiAgentId: string
  ): Promise<number> {
    if (!phone) {
      return 0;
    }

    const unembeddedChats = await this.findUnembeddedChatsByPhone(
      accountId,
      phone,
      aiAgentId,
      10
    );

    if (unembeddedChats.length === 0) {
      return 0;
    }

    let totalProcessed = 0;

    for (const chat of unembeddedChats) {
      try {
        const alreadyEmbedded = await this.hasChatHistoryEmbeddings(
          accountId,
          chat.chat_id,
          aiAgentId
        );

        if (alreadyEmbedded) {
          continue;
        }

        const chatPhone = chat.phone || phone;
        const count = await this.processChatHistoryEmbeddings(
          accountId,
          chat.chat_id,
          aiAgentId,
          chatPhone
        );
        totalProcessed += count;
      } catch (error) {
        console.error(
          `[processMultipleChatHistoryEmbeddings] Erro ao processar chat ${chat.chat_id}:`,
          error
        );
      }
    }

    return totalProcessed;
  }

  private buildChatHistoryTextSearchQuery(
    accountId: string,
    aiAgentId: string,
    topK: number,
    chatIds: string[],
    options?: {
      minQualityScore?: number;
      onlyUseful?: boolean;
      onlyAssistantResponses?: boolean;
    }
  ): any {
    const filterClauses: any[] = [
      { term: { account_id: accountId } },
      { term: { ai_agent_id: aiAgentId } },
      { term: { has_embedding: false } },
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

    return {
      index: this.chatHistoryIndexName,
      size: topK * 2,
      query: {
        bool: {
          filter: filterClauses,
        },
      },
      sort: [{ created_at: { order: 'desc' as const } }] as any,
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

    if (embeddingOptional && !hasEmbeddingModel) {
      const searchMultipleChats = options?.searchMultipleChats ?? true;
      let chatIds: string[] = [chatId];

      if (searchMultipleChats && phone) {
        const foundChatIds = await this.getChatIdsByPhone(accountId, phone);
        if (foundChatIds.length > 0) {
          chatIds = foundChatIds;
        }
      }

      const searchQuery = this.buildChatHistoryTextSearchQuery(
        accountId,
        aiAgentId,
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

        const minQualityScore = options?.minQualityScore ?? 0.0;

        const results = hits
          .map((hit) => {
            const qualityScore = hit._source.quality_score || 0.0;
            const combinedScore = 0.7 + qualityScore * 0.3;

            return {
              text: hit._source.message_text,
              score: Math.max(0, Math.min(1, combinedScore)),
              message_id: hit._source.message_id,
            };
          })
          .filter((result) => result.score >= minQualityScore)
          .slice(0, topK);

        return results;
      } catch (error) {
        console.error('[searchChatHistory] Erro ao buscar histórico:', error);
        return [];
      }
    }

    this.validateAiAgentConfig(aiAgent, false);

    if (!aiAgent.embedding_model) {
      return [];
    }

    const embeddings = await this.generateEmbeddings(
      [queryText],
      aiAgent.base_url,
      aiAgent.api_key,
      aiAgent.embedding_model,
      aiAgent.ai_agent_type_id
    );
    const queryVector = embeddings[0];

    const filterClauses: any[] = [
      { term: { account_id: accountId } },
      { term: { ai_agent_id: aiAgentId } },
    ];

    const searchMultipleChats = options?.searchMultipleChats ?? true;
    const minQualityScore = options?.minQualityScore ?? 0.0;
    const onlyUseful = options?.onlyUseful ?? false;
    const onlyAssistantResponses = options?.onlyAssistantResponses ?? false;

    if (searchMultipleChats && phone) {
      const chatIds = await this.getChatIdsByPhone(accountId, phone);
      if (chatIds.length > 0) {
        filterClauses.push({ terms: { chat_id: chatIds } });
      } else {
        filterClauses.push({ term: { chat_id: chatId } });
      }
    } else {
      filterClauses.push({ term: { chat_id: chatId } });
    }

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

    if (onlyUseful) {
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

    if (onlyAssistantResponses) {
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

    filterClauses.push({ term: { has_embedding: true } });

    const searchQuery: any = {
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
                    double finalScore = similarity * (1.0 + qualityBoost * 0.5);
                    return finalScore;
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
      sort: ['_score', { created_at: { order: 'desc' as const } }] as any,
    };

    try {
      const response = await this.elasticClient.search(searchQuery);

      const hits = response.hits.hits as Array<{
        _score: number;
        _source: IChatHistoryEmbeddingDocument;
      }>;

      const results = hits
        .map((hit) => {
          const similarityScore =
            hit._score / (1.0 + (hit._source.quality_score || 0.0) * 0.5) - 1.0;
          const qualityScore = hit._source.quality_score || 0.0;
          const combinedScore = similarityScore * 0.7 + qualityScore * 0.3;

          return {
            text: hit._source.message_text,
            score: Math.max(0, Math.min(1, combinedScore)),
            message_id: hit._source.message_id,
          };
        })
        .filter((result) => result.score >= minQualityScore)
        .slice(0, topK);

      return results;
    } catch (error) {
      console.error('[searchChatHistory] Erro ao buscar histórico:', error);
      return [];
    }
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

  async hasChatHistoryEmbeddings(
    accountId: string,
    chatId: string,
    aiAgentId: string
  ): Promise<boolean> {
    try {
      const queryElastic = {
        size: 1,
        _source: ['embedded_for_ai_agents'],
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

      const embeddedAgents = chat.embedded_for_ai_agents || [];
      return embeddedAgents.includes(aiAgentId);
    } catch {
      return false;
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
    limit = 10
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
      console.error(
        '[findUnembeddedChatsByPhone] Erro ao buscar chats:',
        error
      );
      return [];
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

      const embeddedAgents = chat.embedded_for_ai_agents || [];
      if (embeddedAgents.includes(aiAgentId)) {
        return true;
      }

      const updatedEmbeddedAgents = [...embeddedAgents, aiAgentId];

      const updatedChat: IChat = {
        ...chat,
        embedded_for_ai_agents: updatedEmbeddedAgents,
      };

      const updateResult = await this.elasticDatabaseService.updateWithOCC(
        EElasticIndex.chat,
        chatId,
        updatedChat as unknown as Record<string, unknown>,
        {
          upsert: true,
          maxRetries: 5,
        }
      );

      if (
        updateResult !== 'updated' &&
        updateResult !== 'created' &&
        updateResult !== 'noop'
      ) {
        return false;
      }

      return true;
    } catch (error) {
      console.error('[markChatAsEmbedded] Erro ao marcar chat:', error);
      return false;
    }
  }

  private async deleteChatHistoryEmbeddings(
    accountId: string,
    chatId: string,
    aiAgentId: string
  ): Promise<boolean> {
    try {
      const exists = await this.elasticClient.indices.exists({
        index: this.chatHistoryIndexName,
      });

      if (!exists) {
        return true;
      }

      await this.elasticClient.deleteByQuery({
        index: this.chatHistoryIndexName,
        query: {
          bool: {
            filter: [
              { term: { account_id: accountId } },
              { term: { chat_id: chatId } },
              { term: { ai_agent_id: aiAgentId } },
            ],
          },
        },
        refresh: true,
      });

      return true;
    } catch {
      return false;
    }
  }
}
