import { injectable, inject } from 'tsyringe';
import { Client } from '@elastic/elasticsearch';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { v7 as uuidv7 } from 'uuid';
import { IChunk } from '@core/common/interfaces/IChunk';
import { IEmbeddingDocument } from '@core/common/interfaces/IEmbeddingDocument';
import { IEmbeddingResponse } from '@core/common/interfaces/IEmbeddingResponse';
import { aiAgentPromptEmbeddingMappings } from '@core/mappings/aiAgentPromptEmbedding.mappings';
import { AiAgentViewerRepository } from '@core/repositories/aiAgent/AiAgentViewer.repository';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

type IGeminiBatchEmbedContentsResponse = {
  embeddings?: Array<{
    values?: number[];
    embedding?: {
      values?: number[];
    };
  }>;
};

@injectable()
export class EmbeddingService {
  private readonly indexName = EElasticIndex.ai_agent_prompt_embedding;
  private readonly embeddingDimensions = 1536;

  constructor(
    @inject('DatabaseElasticClient') private readonly elasticClient: Client,
    private readonly aiAgentViewerRepository: AiAgentViewerRepository
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
    const url = `${baseUrl}/models/${encodeURIComponent(
      model
    )}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: {
            parts: [{ text }],
          },
        })),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as IGeminiBatchEmbedContentsResponse;

    const rawEmbeddings =
      data.embeddings?.map((e) => e.values ?? e.embedding?.values ?? []) ?? [];

    return rawEmbeddings.map((e) => this.normalizeEmbedding(e));
  }

  private async callOpenAiEmbeddingApi(
    baseUrl: string,
    apiKey: string,
    model: string,
    texts: string[]
  ): Promise<number[][]> {
    const response = await fetch(`${baseUrl}/embeddings`, {
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

    return raw.map((e) => this.normalizeEmbedding(e));
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

  private validateAiAgentConfig(aiAgent: {
    base_url: string | null;
    api_key: string | null;
    model: string | null;
  }): asserts aiAgent is {
    base_url: string;
    api_key: string;
    model: string;
  } {
    if (!aiAgent.base_url || !aiAgent.api_key) {
      throw new InvalidConfigurationError(
        'AI Agent base_url or api_key is not configured.'
      );
    }

    if (!aiAgent.model) {
      throw new InvalidConfigurationError('AI Agent model is not configured.');
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

  private createEmbeddingDocuments(
    chunks: IChunk[],
    embeddings: number[][],
    accountId: string,
    aiAgentId: string,
    aiAgentPromptId: string
  ): IEmbeddingDocument[] {
    const now = new Date().toISOString();

    return chunks.map((chunk, idx) => ({
      account_id: accountId,
      ai_agent_id: aiAgentId,
      ai_agent_prompt_id: aiAgentPromptId,
      chunk_index: chunk.index,
      chunk_text: chunk.text,
      embedding: embeddings[idx],
      created_at: now,
    }));
  }

  private async bulkIndexDocuments(
    documents: IEmbeddingDocument[]
  ): Promise<void> {
    const body = documents.flatMap((doc) => [
      { index: { _index: this.indexName, _id: uuidv7() } },
      doc,
    ]);

    await this.elasticClient.bulk({ body, refresh: 'wait_for' });
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

    this.validateAiAgentConfig(aiAgent);

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
      aiAgent.model,
      aiAgent.ai_agent_type_id
    );

    const documents = this.createEmbeddingDocuments(
      chunks,
      embeddings,
      accountId,
      aiAgentId,
      aiAgentPromptId
    );

    await this.bulkIndexDocuments(documents);

    return documents.length;
  }

  private buildSimilaritySearchQuery(
    accountId: string,
    aiAgentId: string,
    queryVector: number[],
    topK: number
  ) {
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

    this.validateAiAgentConfig(aiAgent);

    const embeddings = await this.generateEmbeddings(
      [queryText],
      aiAgent.base_url,
      aiAgent.api_key,
      aiAgent.model,
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

    return this.parseSearchResults(hits);
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
      const exists = await this.checkIndexExists();

      if (!exists) {
        return true;
      }

      await this.elasticClient.deleteByQuery({
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
      });

      return true;
    } catch {
      return false;
    }
  }
}
