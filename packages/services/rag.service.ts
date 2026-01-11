import { injectable } from 'tsyringe';
import { EmbeddingService } from './embedding.service';
import { IRagContext } from '@core/common/interfaces/IRagContext';
import { AiAgentPromptListerRepository } from '@core/repositories/aiAgent/AiAgentPromptLister.repository';
import { EAiAgentPromptType } from '@core/common/enums/EAiAgentPromptType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { SummaryProviderFactory } from './summary/summaryProviderFactory.service';

@injectable()
export class RagService {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly aiAgentPromptListerRepository: AiAgentPromptListerRepository,
    private readonly summaryProviderFactory: SummaryProviderFactory
  ) {}

  async getChatHistoryContext(
    accountId: string,
    chatId: string,
    aiAgentId: string,
    userQuery: string,
    topK = 10,
    minScore = 0.0,
    phone?: string,
    options?: {
      searchMultipleChats?: boolean;
      minQualityScore?: number;
      onlyUseful?: boolean;
      onlyAssistantResponses?: boolean;
    }
  ): Promise<IRagContext & { chunksCount: number }> {
    const chunks = await this.embeddingService.searchChatHistory(
      accountId,
      chatId,
      aiAgentId,
      userQuery,
      topK,
      phone,
      {
        searchMultipleChats: options?.searchMultipleChats ?? true,
        minQualityScore: options?.minQualityScore ?? 0.2,
        onlyUseful: options?.onlyUseful ?? false,
        onlyAssistantResponses: options?.onlyAssistantResponses ?? true,
      }
    );

    return this.processChunks(
      chunks.map((chunk) => ({
        text: chunk.text,
        score: chunk.score,
        promptId: chunk.message_id || '',
      })),
      minScore
    );
  }

  async getRelevantContext(
    accountId: string,
    aiAgentId: string,
    userQuery: string,
    topK = 100,
    minScore = 0.0
  ): Promise<IRagContext & { chunksCount: number }> {
    const chunks = await this.embeddingService.searchSimilarChunks(
      accountId,
      aiAgentId,
      userQuery,
      topK
    );

    return this.processChunks(chunks, minScore);
  }

  private processChunks(
    chunks: Array<{ text: string; score: number; promptId: string }>,
    minScore: number
  ): IRagContext & { chunksCount: number } {
    const relevantChunks = chunks.filter((chunk) => chunk.score >= minScore);

    const combinedContext = relevantChunks
      .map((chunk) => chunk.text)
      .join('\n\n---\n\n');

    return {
      chunks: relevantChunks,
      combinedContext,
      chunksCount: relevantChunks.length,
    };
  }

  async getAllAgentPrompts(
    accountId: string,
    aiAgentId: string
  ): Promise<string> {
    const prompts = await this.aiAgentPromptListerRepository.listAiAgentPrompts(
      { ai_agent_id: aiAgentId },
      accountId
    );

    const activePrompts = prompts.filter(
      (prompt) => prompt.status === EAiAgentStatus.active
    );

    if (activePrompts.length === 0) {
      return '';
    }

    const promptsByType = this.groupPromptsByType(activePrompts);

    return this.formatPromptsByType(promptsByType);
  }

  async generateBootstrapSummary(
    accountId: string,
    aiAgentId: string,
    baseUrl: string,
    apiKey: string,
    model: string,
    aiAgentTypeId: string
  ): Promise<string> {
    const allPrompts = await this.getAllAgentPrompts(accountId, aiAgentId);

    if (!allPrompts || allPrompts.trim().length === 0) {
      return '';
    }

    const summaryPrompt = this.buildBootstrapSummaryPrompt(allPrompts);

    try {
      const provider = this.summaryProviderFactory.getProvider(
        aiAgentTypeId,
        baseUrl
      );
      const summary = await provider.generateSummary(
        summaryPrompt,
        baseUrl,
        apiKey,
        model
      );
      return summary.trim();
    } catch (error) {
      console.error('[generateBootstrapSummary] Erro ao gerar summary:', error);
      return allPrompts.substring(0, 8000);
    }
  }

  async generateOrUpdateConversationSummary(
    previousSummary: string | null,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    baseUrl: string,
    apiKey: string,
    model: string,
    aiAgentTypeId: string,
    maxChars = 10000
  ): Promise<string> {
    const messagesText = this.formatMessagesForSummary(recentMessages);
    const summaryPrompt = this.buildConversationSummaryPrompt(
      previousSummary,
      messagesText
    );

    try {
      const provider = this.summaryProviderFactory.getProvider(
        aiAgentTypeId,
        baseUrl
      );
      const summary = await provider.generateSummary(
        summaryPrompt,
        baseUrl,
        apiKey,
        model
      );

      if (summary.length > maxChars) {
        return summary.substring(0, maxChars);
      }

      return summary.trim();
    } catch (error) {
      console.error(
        '[generateOrUpdateConversationSummary] Erro ao gerar summary:',
        error
      );
      return previousSummary || '';
    }
  }

  async enhancePromptWithRag(
    accountId: string,
    aiAgentId: string,
    systemPrompt: string,
    userQuery: string,
    options?: {
      topK?: number;
      minScore?: number;
      chatId?: string;
      includeChatHistory?: boolean;
      isBootstrap?: boolean;
      bootstrapSummary?: string | null;
      conversationSummary?: string | null;
      recentMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
      phone?: string;
    }
  ): Promise<{
    enhancedPrompt: string;
    contextUsed: boolean;
    chunksCount: number;
  }> {
    const isBootstrap = options?.isBootstrap ?? false;

    if (isBootstrap) {
      return this.buildBootstrapPrompt(accountId, aiAgentId);
    }

    const { contextParts, chunksCount, hasRelevantContext } =
      await this.buildContextParts(accountId, aiAgentId, userQuery, options);

    const enhancedPrompt = this.buildEnhancedPrompt(
      systemPrompt,
      contextParts,
      options?.bootstrapSummary,
      options?.conversationSummary,
      hasRelevantContext
    );

    return {
      enhancedPrompt,
      contextUsed: contextParts.length > 0,
      chunksCount,
    };
  }

  private groupPromptsByType(
    activePrompts: Array<{
      ai_agent_prompt_type: string;
      name: string;
      value: string;
    }>
  ): Record<string, string[]> {
    const promptsByType: Record<string, string[]> = {};

    for (const prompt of activePrompts) {
      const type = prompt.ai_agent_prompt_type;
      if (!promptsByType[type]) {
        promptsByType[type] = [];
      }
      if (prompt.value && prompt.value.trim().length > 0) {
        const formattedPrompt = prompt.name
          ? `${prompt.name}:\n${prompt.value}`
          : prompt.value;
        promptsByType[type].push(formattedPrompt);
      }
    }

    return promptsByType;
  }

  private formatPromptsByType(promptsByType: Record<string, string[]>): string {
    const sections: string[] = [];

    for (const [type, values] of Object.entries(promptsByType)) {
      if (values.length === 0) {
        continue;
      }

      const typeLabel =
        type === EAiAgentPromptType.file
          ? 'Regras e Conhecimento'
          : 'Configuração';
      sections.push(`### ${typeLabel}:\n${values.join('\n\n---\n\n')}`);
    }

    return sections.join('\n\n');
  }

  private buildBootstrapSummaryPrompt(allPrompts: string): string {
    return `Você é um assistente especializado em criar sumários concisos e estruturados de informações.

Com base nos prompts completos do agente abaixo, crie um sumário inicial estruturado (máximo 3000 tokens) que capture:
1. Regras essenciais e diretrizes
2. Perfil e personalidade do agente
3. Objetivos e responsabilidades
4. Informações críticas da base de conhecimento

Este sumário será usado como contexto permanente em todas as conversas. Seja preciso e inclua TODAS as regras importantes.

Prompts do agente:
${allPrompts}

Gere APENAS o sumário, sem introduções ou explicações adicionais.`;
  }

  private formatMessagesForSummary(
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  ): string {
    return recentMessages
      .map(
        (msg) =>
          `${msg.role === 'user' ? 'Usuário' : 'Assistente'}: ${msg.content}`
      )
      .join('\n\n');
  }

  private buildConversationSummaryPrompt(
    previousSummary: string | null,
    messagesText: string
  ): string {
    const updateInstruction = previousSummary
      ? 'Atualize o sumário anterior incorporando as novas informações. Mantenha o máximo de 3000 tokens e preserve informações importantes do sumário anterior.'
      : 'Crie um sumário inicial da conversa (máximo 3000 tokens) capturando os pontos principais discutidos.';

    return `Você é um assistente especializado em criar e atualizar sumários de conversas.

${previousSummary ? `Sumário anterior da conversa:\n${previousSummary}\n\n` : ''}

Novas mensagens da conversa:
${messagesText}

${updateInstruction}

Gere APENAS o sumário atualizado, sem introduções ou explicações adicionais.`;
  }

  private async buildBootstrapPrompt(
    accountId: string,
    aiAgentId: string
  ): Promise<{
    enhancedPrompt: string;
    contextUsed: boolean;
    chunksCount: number;
  }> {
    const allPrompts = await this.getAllAgentPrompts(accountId, aiAgentId);
    const bootstrapPrompt = `Você é um assistente virtual prestativo e educado.

### Regras, Perfil e Objetivos do Agente (Base Completa de Conhecimento):
${allPrompts || '(Nenhuma regra ou conhecimento configurado)'}

### Instruções Importantes:
- SIGA TODAS as regras acima em TODAS as suas respostas
- Mantenha o perfil e personalidade definidos
- Priorize os objetivos estabelecidos
- Use o conhecimento fornecido para responder com precisão

Agora, responda à pergunta do usuário seguindo TODAS as regras e diretrizes acima:`;

    return {
      enhancedPrompt: bootstrapPrompt,
      contextUsed: true,
      chunksCount: 0,
    };
  }

  private async buildContextParts(
    accountId: string,
    aiAgentId: string,
    userQuery: string,
    options?: {
      topK?: number;
      minScore?: number;
      chatId?: string;
      includeChatHistory?: boolean;
      bootstrapSummary?: string | null;
      conversationSummary?: string | null;
      recentMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
      phone?: string;
    }
  ): Promise<{
    contextParts: string[];
    chunksCount: number;
    hasRelevantContext: boolean;
  }> {
    const contextParts: string[] = [];
    let totalChunksCount = 0;
    let hasRelevantContext = false;

    if (
      options?.bootstrapSummary &&
      options.bootstrapSummary.trim().length > 0
    ) {
      contextParts.push(
        `### Regras e Conhecimento Base do Agente (Summary Inicial):\n${options.bootstrapSummary}`
      );
    }

    if (
      options?.conversationSummary &&
      options.conversationSummary.trim().length > 0
    ) {
      contextParts.push(
        `### Sumário da Conversa:\n${options.conversationSummary}`
      );
    }

    if (options?.recentMessages && options.recentMessages.length > 0) {
      const messagesText = this.formatRecentMessages(
        options.recentMessages.slice(-20)
      );
      contextParts.push(`### Últimas Mensagens da Conversa:\n${messagesText}`);
    }

    const topK = options?.topK ?? 12;
    const minScore = options?.minScore ?? 0.0;

    const relevantContext = await this.getRelevantContext(
      accountId,
      aiAgentId,
      userQuery,
      topK,
      minScore
    );

    if (
      relevantContext.combinedContext &&
      relevantContext.combinedContext.trim().length > 0
    ) {
      contextParts.push(
        `### Contexto Relevante da Base de Conhecimento (Top ${relevantContext.chunksCount} resultados):\n${relevantContext.combinedContext}`
      );
      totalChunksCount += relevantContext.chunksCount;
      hasRelevantContext = true;
    }

    if (options?.includeChatHistory && options?.chatId) {
      const chatHistoryContext = await this.getChatHistoryContext(
        accountId,
        options.chatId,
        aiAgentId,
        userQuery,
        15,
        minScore,
        options.phone
      );

      if (chatHistoryContext.combinedContext) {
        contextParts.push(
          `### Histórico de Conversação Relevante:\n${chatHistoryContext.combinedContext}`
        );
        totalChunksCount += chatHistoryContext.chunksCount;
        hasRelevantContext = true;
      }
    }

    return {
      contextParts,
      chunksCount: totalChunksCount,
      hasRelevantContext,
    };
  }

  private formatRecentMessages(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  ): string {
    return messages
      .map(
        (msg) =>
          `${msg.role === 'user' ? 'Usuário' : 'Assistente'}: ${msg.content}`
      )
      .join('\n');
  }

  private buildEnhancedPrompt(
    systemPrompt: string,
    contextParts: string[],
    bootstrapSummary?: string | null,
    conversationSummary?: string | null,
    hasRelevantContext = false
  ): string {
    const finalContext = contextParts.join('\n\n');
    const instructionsText = this.buildInstructionsText(
      contextParts,
      bootstrapSummary,
      conversationSummary,
      hasRelevantContext
    );

    return `${systemPrompt}

${finalContext || '(Nenhum contexto adicional disponível)'}

### Instruções Importantes:
${instructionsText || 'Responda à pergunta do usuário de forma clara e precisa.'}`;
  }

  private buildInstructionsText(
    contextParts: string[],
    bootstrapSummary?: string | null,
    conversationSummary?: string | null,
    hasRelevantContext = false
  ): string {
    let instructionsText = '';

    if (bootstrapSummary && bootstrapSummary.trim().length > 0) {
      instructionsText +=
        '- SIGA TODAS as regras do "Summary Inicial" em TODAS as suas respostas. Essas regras são permanentes e devem ser respeitadas sempre.\n';
    }

    if (conversationSummary && conversationSummary.trim().length > 0) {
      instructionsText +=
        '- Use o "Sumário da Conversa" para manter consistência e contexto da conversa.\n';
    }

    if (hasRelevantContext) {
      instructionsText +=
        '- Use o contexto acima para responder à pergunta do usuário. Sempre priorize as informações do contexto fornecido.\n';
      return instructionsText;
    }

    if (contextParts.length > 0) {
      instructionsText +=
        '- Use o contexto acima para responder à pergunta do usuário. Sempre priorize as informações do contexto fornecido.\n';
      instructionsText +=
        '- IMPORTANTE: Se a pergunta do usuário estiver fora do contexto ou tema da empresa/agente (não relacionada ao assunto tratado pela empresa), você deve educadamente informar que não pode responder sobre esse assunto e orientar o usuário a fazer perguntas relacionadas ao tema da empresa/agente. Seja prestativo e sugira exemplos de perguntas relevantes ao contexto da empresa.\n';
      return instructionsText;
    }

    instructionsText +=
      '- IMPORTANTE: Se a pergunta do usuário estiver fora do contexto ou tema da empresa/agente, você deve educadamente informar que não pode responder sobre esse assunto e orientar o usuário a fazer perguntas relacionadas ao tema da empresa/agente. Seja prestativo e sugira exemplos de perguntas relevantes ao contexto da empresa.\n';
    return instructionsText;
  }
}
