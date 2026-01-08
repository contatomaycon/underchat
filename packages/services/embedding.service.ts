import { injectable, inject } from 'tsyringe';
import { Client } from '@elastic/elasticsearch';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { v7 as uuidv7 } from 'uuid';
import { IChunk } from '@core/common/interfaces/IChunk';
import { IEmbeddingDocument } from '@core/common/interfaces/IEmbeddingDocument';
import { IEmbeddingResponse } from '@core/common/interfaces/IEmbeddingResponse';
import { IGeminiBatchEmbedContentsResponse } from '@core/common/interfaces/IGeminiBatchEmbedContentsResponse';
import { IChatHistoryEmbeddingDocument } from '@core/common/interfaces/IChatHistoryEmbeddingDocument';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { aiAgentPromptEmbeddingMappings } from '@core/mappings/aiAgentPromptEmbedding.mappings';
import { chatHistoryEmbeddingMappings } from '@core/mappings/chatHistoryEmbedding.mappings';
import { AiAgentViewerRepository } from '@core/repositories/aiAgent/AiAgentViewer.repository';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

type ElasticHit<T> = {
  _source?: T;
};

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

  private validateAiAgentConfig(aiAgent: {
    base_url: string | null;
    api_key: string | null;
    embedding_model: string | null;
  }): asserts aiAgent is {
    base_url: string;
    api_key: string;
    embedding_model: string;
  } {
    if (!aiAgent.base_url || !aiAgent.api_key) {
      throw new InvalidConfigurationError(
        'AI Agent base_url or api_key is not configured.'
      );
    }

    if (!aiAgent.embedding_model) {
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
    userId?: string | null
  ): Promise<number> {
    await this.ensureChatHistoryIndex();

    const aiAgent = await this.aiAgentViewerRepository.viewAiAgent(
      aiAgentId,
      accountId
    );

    if (!aiAgent) {
      throw new Error('AI Agent not found.');
    }

    this.validateAiAgentConfig(aiAgent);

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

    const messages: Array<{ text: string; message_id: string }> = [];

    for (const hit of result.hits.hits.reverse()) {
      const message = hit._source as IChatMessage;
      if (!message.content || !message.message_id) {
        continue;
      }

      const text = extractMessageTextFromContent(message.content);
      if (!text || text.trim().length === 0) {
        continue;
      }

      messages.push({
        text,
        message_id: message.message_id,
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
      (msg, idx) => ({
        account_id: accountId,
        chat_id: chatId,
        ai_agent_id: aiAgentId,
        message_id: msg.message_id,
        message_text: msg.text,
        embedding: embeddings[idx],
        created_at: now,
        user_id: userId || null,
      })
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
    userId: string,
    aiAgentId: string
  ): Promise<number> {
    const unembeddedChats = await this.findUnembeddedChats(
      accountId,
      userId,
      aiAgentId,
      5
    );

    if (unembeddedChats.length === 0) {
      return 0;
    }

    let totalProcessed = 0;

    for (const chat of unembeddedChats) {
      try {
        const count = await this.processChatHistoryEmbeddings(
          accountId,
          chat.chat_id,
          aiAgentId,
          userId
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

  async searchChatHistory(
    accountId: string,
    chatId: string,
    aiAgentId: string,
    queryText: string,
    topK = 10
  ): Promise<Array<{ text: string; score: number; message_id: string }>> {
    await this.ensureChatHistoryIndex();

    const aiAgent = await this.aiAgentViewerRepository.viewAiAgent(
      aiAgentId,
      accountId
    );

    if (!aiAgent) {
      return [];
    }

    this.validateAiAgentConfig(aiAgent);

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

    const searchQuery = {
      index: this.chatHistoryIndexName,
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
                      { term: { chat_id: chatId } },
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

    try {
      const response = await this.elasticClient.search(searchQuery);

      const hits = response.hits.hits as Array<{
        _score: number;
        _source: IChatHistoryEmbeddingDocument;
      }>;

      return hits.map((hit) => ({
        text: hit._source.message_text,
        score: hit._score - 1.0,
        message_id: hit._source.message_id,
      }));
    } catch (error) {
      console.error('[searchChatHistory] Erro ao buscar histórico:', error);
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

      await this.elasticDatabaseService.update(
        EElasticIndex.chat,
        updatedChat,
        chatId
      );

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
