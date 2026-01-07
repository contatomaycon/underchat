import { injectable } from 'tsyringe';
import { EmbeddingService } from './embedding.service';
import { IRagContext } from '@core/common/interfaces/IRagContext';

@injectable()
export class RagService {
  constructor(private readonly embeddingService: EmbeddingService) {}

  async getRelevantContext(
    accountId: string,
    aiAgentId: string,
    userQuery: string,
    topK = 5,
    minScore = 0.7
  ): Promise<IRagContext> {
    const chunks = await this.embeddingService.searchSimilarChunks(
      accountId,
      aiAgentId,
      userQuery,
      topK
    );

    const relevantChunks = chunks.filter((chunk) => chunk.score >= minScore);

    const combinedContext = relevantChunks
      .map((chunk) => chunk.text)
      .join('\n\n---\n\n');

    return {
      chunks: relevantChunks,
      combinedContext,
    };
  }

  buildPromptWithContext(systemPrompt: string, context: string): string {
    if (!context || context.trim() === '') {
      return systemPrompt;
    }

    return `${systemPrompt}

### Contexto Relevante (Base de Conhecimento):
${context}

### Instruções:
Use o contexto acima para responder à pergunta do usuário. Se o contexto não contiver informações relevantes, responda com base no seu conhecimento geral, mas indique que não encontrou informações específicas na base de conhecimento.`;
  }

  async enhancePromptWithRag(
    accountId: string,
    aiAgentId: string,
    systemPrompt: string,
    userQuery: string,
    options?: {
      topK?: number;
      minScore?: number;
    }
  ): Promise<{
    enhancedPrompt: string;
    contextUsed: boolean;
    chunksCount: number;
  }> {
    const topK = options?.topK ?? 5;
    const minScore = options?.minScore ?? 0.7;

    const { chunks, combinedContext } = await this.getRelevantContext(
      accountId,
      aiAgentId,
      userQuery,
      topK,
      minScore
    );

    const enhancedPrompt = this.buildPromptWithContext(
      systemPrompt,
      combinedContext
    );

    return {
      enhancedPrompt,
      contextUsed: chunks.length > 0,
      chunksCount: chunks.length,
    };
  }
}
