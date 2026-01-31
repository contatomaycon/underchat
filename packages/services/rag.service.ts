import { injectable } from 'tsyringe';
import { EmbeddingService } from './embedding.service';
import { IRagContext } from '@core/common/interfaces/IRagContext';
import { AiAgentPromptListerRepository } from '@core/repositories/aiAgent/AiAgentPromptLister.repository';
import { EAiAgentPromptType } from '@core/common/enums/EAiAgentPromptType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { SummaryProviderFactory } from './summary/summaryProviderFactory.service';

@injectable()
export class RagService {
  private readonly maxTopK = 100;
  private readonly maxChunkChars = 4000;
  private readonly maxCombinedContextChars = 20000;
  private readonly maxRecentMessageChars = 1500;
  private readonly maxSummaryChars = 12000;
  private readonly minContextScore = 0.2;
  private readonly minKeywordLength = 3;
  private readonly minKeywordMatchRatio = 0.4;
  private readonly keywordStopWords = new Set([
    'a',
    'o',
    'os',
    'as',
    'um',
    'uma',
    'uns',
    'umas',
    'de',
    'do',
    'da',
    'dos',
    'das',
    'e',
    'ou',
    'que',
    'como',
    'qual',
    'quais',
    'quando',
    'onde',
    'quem',
    'por',
    'porque',
    'pra',
    'para',
    'com',
    'sem',
    'nao',
    'sim',
    'se',
    'em',
    'no',
    'na',
    'nos',
    'nas',
    'sobre',
    'isso',
    'isto',
    'essa',
    'esse',
    'aquela',
    'aquele',
    'aqui',
    'ali',
    'ja',
    'so',
    'sou',
    'estou',
    'esta',
    'estao',
    'ser',
    'ter',
    'me',
    'minha',
    'meu',
    'meus',
    'minhas',
    'sua',
    'seu',
    'seus',
    'suas',
    'nosso',
    'nossa',
    'voces',
    'voce',
    'eu',
    'tu',
    'ele',
    'ela',
    'eles',
    'elas',
    'tudo',
    'mais',
    'menos',
    'tambem',
    'mesmo',
    'mesma',
    'ainda',
    'agora',
    'favor',
    'porfavor',
    'poderia',
    'pode',
    'poder',
    'quer',
    'quero',
    'gostaria',
    'usuario',
    'assistente',
    'atendente',
    'cliente',
  ]);

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
  ): Promise<
    IRagContext & { chunksCount: number; maxScore: number; rawMaxScore: number }
  > {
    try {
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
    } catch (error) {
      console.error(
        '[getChatHistoryContext] Erro ao buscar histórico de conversa:',
        error
      );
      return this.emptyContext();
    }
  }

  async getRelevantContext(
    accountId: string,
    aiAgentId: string,
    userQuery: string,
    topK = 100,
    minScore = 0.0
  ): Promise<
    IRagContext & { chunksCount: number; maxScore: number; rawMaxScore: number }
  > {
    try {
      const chunks = await this.embeddingService.searchSimilarChunks(
        accountId,
        aiAgentId,
        userQuery,
        topK
      );

      return this.processChunks(chunks, minScore);
    } catch (error) {
      console.error(
        '[getRelevantContext] Erro ao buscar contexto relevante:',
        error
      );
      return this.emptyContext();
    }
  }

  private processChunks(
    chunks: Array<{ text: string; score: number; promptId: string }>,
    minScore: number
  ): IRagContext & {
    chunksCount: number;
    maxScore: number;
    rawMaxScore: number;
  } {
    const safeMinScore = this.normalizeMinScore(minScore);
    const normalizedChunks = (Array.isArray(chunks) ? chunks : [])
      .map((chunk) => ({
        text: this.normalizeText(chunk?.text),
        score: this.normalizeScore(chunk?.score),
        promptId: typeof chunk?.promptId === 'string' ? chunk.promptId : '',
      }))
      .filter((chunk) => chunk.text.length > 0);

    const rawMaxScore = normalizedChunks.reduce(
      (maxScore, chunk) => Math.max(maxScore, chunk.score),
      0
    );

    const relevantChunks = normalizedChunks
      .filter((chunk) => chunk.score >= safeMinScore)
      .sort((a, b) => b.score - a.score);

    const uniqueChunks = this.dedupeChunksByText(relevantChunks);
    const { chunks: selectedChunks, combinedContext } =
      this.buildCombinedContext(uniqueChunks);
    const maxScore = selectedChunks.length > 0 ? selectedChunks[0].score : 0;

    return {
      chunks: selectedChunks,
      combinedContext,
      chunksCount: selectedChunks.length,
      maxScore,
      rawMaxScore,
    };
  }

  async getAllAgentPrompts(
    accountId: string,
    aiAgentId: string
  ): Promise<string> {
    let prompts: Array<{
      ai_agent_prompt_type: string;
      name: string;
      value: string;
      status: EAiAgentStatus;
    }> = [];
    try {
      prompts = await this.aiAgentPromptListerRepository.listAiAgentPrompts(
        { ai_agent_id: aiAgentId },
        accountId
      );
    } catch (error) {
      console.error('[getAllAgentPrompts] Erro ao listar prompts:', error);
      return '';
    }

    const activePrompts = prompts.filter(
      (prompt) => prompt.status === EAiAgentStatus.active
    );

    if (activePrompts.length === 0) {
      return '';
    }

    const promptsByType = this.groupPromptsByType(activePrompts);

    return this.formatPromptsByType(promptsByType);
  }

  async getAllAgentPromptsDetailed(
    accountId: string,
    aiAgentId: string
  ): Promise<
    Array<{ ai_agent_prompt_type: string; name: string; value: string }>
  > {
    try {
      const prompts =
        await this.aiAgentPromptListerRepository.listAiAgentPrompts(
          { ai_agent_id: aiAgentId },
          accountId
        );

      return prompts
        .filter((prompt) => prompt.status === EAiAgentStatus.active)
        .map((prompt) => ({
          ai_agent_prompt_type: prompt.ai_agent_prompt_type,
          name: prompt.name,
          value: prompt.value,
        }));
    } catch (error) {
      console.error(
        '[getAllAgentPromptsDetailed] Erro ao listar prompts:',
        error
      );
      return [];
    }
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
      includeBootstrapSummaryInPrompt?: boolean;
      maxPromptChars?: number;
      lastAgentMessage?: string | null;
    }
  ): Promise<{
    enhancedPrompt: string;
    contextUsed: boolean;
    chunksCount: number;
    contextAllowed: boolean;
    contextHints: string[];
  }> {
    const isBootstrap = options?.isBootstrap ?? false;

    if (isBootstrap) {
      const bootstrapPrompt = await this.buildBootstrapPrompt(
        accountId,
        aiAgentId
      );
      return {
        ...bootstrapPrompt,
        contextAllowed: true,
        contextHints: [],
      };
    }

    const includeBootstrapSummaryInPrompt =
      options?.includeBootstrapSummaryInPrompt ?? true;
    const {
      contextParts,
      chunksCount,
      knowledgeContextText,
      knowledgeMaxScore,
      knowledgeRawMaxScore,
      historyMaxScore,
      historyRawMaxScore,
      hasConversationContext,
      conversationContextText,
    } = await this.buildContextParts(accountId, aiAgentId, userQuery, {
      ...options,
      includeBootstrapSummaryInPrompt,
    });

    const promptBootstrapSummary = includeBootstrapSummaryInPrompt
      ? options?.bootstrapSummary
      : null;

    const maxPromptChars = options?.maxPromptChars;
    let adjustedContextParts = contextParts;
    let adjustedBootstrapSummary = promptBootstrapSummary;
    let adjustedConversationSummary = options?.conversationSummary ?? null;
    if (maxPromptChars && maxPromptChars > 0) {
      const trimmed = this.trimContextPartsToMaxChars(
        systemPrompt,
        contextParts,
        promptBootstrapSummary,
        options?.conversationSummary ?? null,
        maxPromptChars
      );
      adjustedContextParts = trimmed.contextParts;
      adjustedBootstrapSummary = trimmed.bootstrapSummary;
      adjustedConversationSummary = trimmed.conversationSummary;
    }

    let enhancedPrompt = this.buildEnhancedPrompt(
      systemPrompt,
      adjustedContextParts,
      adjustedBootstrapSummary,
      adjustedConversationSummary,
      adjustedContextParts.length > 0
    );

    if (maxPromptChars && enhancedPrompt.length > maxPromptChars) {
      const compactSystemPrompt = this.buildCompactSystemPrompt(
        systemPrompt,
        options?.bootstrapSummary ?? null
      );
      const compactTrimmed = this.trimContextPartsToMaxChars(
        compactSystemPrompt,
        contextParts,
        promptBootstrapSummary,
        options?.conversationSummary ?? null,
        maxPromptChars
      );
      const compactPrompt = this.buildEnhancedPrompt(
        compactSystemPrompt,
        compactTrimmed.contextParts,
        compactTrimmed.bootstrapSummary,
        compactTrimmed.conversationSummary,
        compactTrimmed.contextParts.length > 0
      );

      if (compactPrompt.length <= maxPromptChars) {
        enhancedPrompt = compactPrompt;
        adjustedContextParts = compactTrimmed.contextParts;
        adjustedBootstrapSummary = compactTrimmed.bootstrapSummary;
        adjustedConversationSummary = compactTrimmed.conversationSummary;
      } else {
        enhancedPrompt = this.truncateText(compactPrompt, maxPromptChars);
      }
    }

    const contextScoreThreshold = Math.max(
      this.minContextScore,
      this.normalizeMinScore(options?.minScore ?? this.minContextScore)
    );
    const contextAllowed = this.isQueryWithinContext(userQuery, {
      bootstrapSummary: options?.bootstrapSummary,
      knowledgeContextText,
      knowledgeMaxScore,
      knowledgeRawMaxScore,
      historyMaxScore,
      historyRawMaxScore,
      hasConversationContext,
      conversationContextText,
      scoreThreshold: contextScoreThreshold,
    });
    const contextHints = this.buildContextHints(
      options?.bootstrapSummary,
      knowledgeContextText
    );

    return {
      enhancedPrompt,
      contextUsed: adjustedContextParts.length > 0,
      chunksCount,
      contextAllowed,
      contextHints,
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
          ? 'Base de Conhecimento — Links e Arquivos'
          : 'Base de Conhecimento — Textos';
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
5. Conteúdo de TODOS os textos fornecidos — absorva cada informação
6. Referências a TODOS os links/URLs fornecidos — inclua os pontos-chave de cada um

IMPORTANTE: Absorva INTEGRALMENTE todo o conteúdo de cada prompt. Se houver links, identifique-os e inclua referência a eles no sumário. Se houver textos, extraia TODAS as informações relevantes sem omitir nenhuma.

Este sumário será usado como contexto permanente em todas as conversas. Seja preciso e inclua TODAS as regras e informações importantes.

Prompts do agente:
${allPrompts}

Gere APENAS o sumário, sem introduções ou explicações adicionais.`;
  }

  private formatMessagesForSummary(
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  ): string {
    return recentMessages
      .map((msg) => {
        const content = this.normalizeText(msg.content);
        if (!content) {
          return '';
        }
        return `${msg.role === 'user' ? 'Usuário' : 'Assistente'}: ${content}`;
      })
      .filter(Boolean)
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
    const bootstrapPrompt = `Você é um assistente virtual inteligente, prestativo e rigoroso.

### Base Completa de Conhecimento do Agente (Absorva INTEGRALMENTE):
${allPrompts || '(Nenhuma regra ou conhecimento configurado)'}

### Instruções Críticas:
- Absorva INTEGRALMENTE todo o conteúdo acima: cada texto, cada link, cada regra. Nada pode ser ignorado.
- SIGA TODAS as regras acima em TODAS as suas respostas sem exceção.
- Use apenas o contexto disponível para responder. Não invente informações que não estejam no contexto.
- Quando houver contexto suficiente, seja completo e útil, trazendo detalhes, exemplos e informações relevantes.
- Mantenha o perfil e personalidade definidos nos prompts.
- Priorize os objetivos estabelecidos nos prompts.
- Use todo o conhecimento fornecido para responder com a máxima precisão.

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
      includeBootstrapSummaryInPrompt?: boolean;
      maxPromptChars?: number;
      lastAgentMessage?: string | null;
    }
  ): Promise<{
    contextParts: string[];
    chunksCount: number;
    hasRelevantContext: boolean;
    knowledgeContextText: string;
    knowledgeMaxScore: number;
    knowledgeRawMaxScore: number;
    historyMaxScore: number;
    historyRawMaxScore: number;
    hasConversationContext: boolean;
    conversationContextText: string;
  }> {
    const contextParts: string[] = [];
    let totalChunksCount = 0;
    let hasRelevantContext = false;
    let knowledgeContextText = '';
    let knowledgeMaxScore = 0;
    let knowledgeRawMaxScore = 0;
    let historyMaxScore = 0;
    let historyRawMaxScore = 0;
    let conversationContextText = '';
    const normalizedQuery = this.normalizeText(userQuery);
    const hasConversationContext =
      !!(
        options?.conversationSummary &&
        options.conversationSummary.trim().length > 0
      ) ||
      !!(options?.recentMessages && options.recentMessages.length > 0) ||
      !!(
        options?.lastAgentMessage && options.lastAgentMessage.trim().length > 0
      );

    const includeBootstrapSummaryInPrompt =
      options?.includeBootstrapSummaryInPrompt ?? true;
    if (
      includeBootstrapSummaryInPrompt &&
      options?.bootstrapSummary &&
      options.bootstrapSummary.trim().length > 0
    ) {
      contextParts.push(
        `### Regras e Conhecimento Base do Agente (Summary Inicial):\n${this.truncateText(
          this.normalizeText(options.bootstrapSummary),
          this.maxSummaryChars
        )}`
      );
    }

    if (
      options?.conversationSummary &&
      options.conversationSummary.trim().length > 0
    ) {
      const normalizedSummary = this.normalizeText(options.conversationSummary);
      contextParts.push(
        `### Sumário da Conversa:\n${this.truncateText(
          normalizedSummary,
          this.maxSummaryChars
        )}`
      );
      if (normalizedSummary) {
        conversationContextText = normalizedSummary;
      }
    }

    const normalizedLastAgentMessage = this.normalizeText(
      options?.lastAgentMessage ?? ''
    );
    if (normalizedLastAgentMessage) {
      let lastAssistantMessage = '';
      if (options?.recentMessages && options.recentMessages.length > 0) {
        for (let i = options.recentMessages.length - 1; i >= 0; i -= 1) {
          const message = options.recentMessages[i];
          if (message.role === 'assistant') {
            lastAssistantMessage = this.normalizeText(message.content);
            break;
          }
        }
      }
      if (normalizedLastAgentMessage !== lastAssistantMessage) {
        contextParts.push(
          `### Última Resposta do Assistente:\n${normalizedLastAgentMessage}`
        );
        conversationContextText = [
          conversationContextText,
          normalizedLastAgentMessage,
        ]
          .filter(Boolean)
          .join(' ');
      }
    }

    if (options?.recentMessages && options.recentMessages.length > 0) {
      const messagesText = this.formatRecentMessages(
        options.recentMessages.slice(-20)
      );
      if (messagesText.trim().length > 0) {
        contextParts.push(
          `### Últimas Mensagens da Conversa:\n${messagesText}`
        );
        conversationContextText = [conversationContextText, messagesText]
          .filter(Boolean)
          .join(' ');
      }
    }

    const topK = this.normalizeTopK(options?.topK ?? 12);
    const minScore = this.normalizeMinScore(options?.minScore ?? 0.0);

    if (normalizedQuery.length > 0 && topK > 0) {
      const relevantContext = await this.getRelevantContext(
        accountId,
        aiAgentId,
        normalizedQuery,
        topK,
        minScore
      );
      knowledgeRawMaxScore = relevantContext.rawMaxScore;

      if (
        relevantContext.combinedContext &&
        relevantContext.combinedContext.trim().length > 0
      ) {
        contextParts.push(
          `### Contexto Relevante da Base de Conhecimento (Top ${relevantContext.chunksCount} resultados):\n${relevantContext.combinedContext}`
        );
        totalChunksCount += relevantContext.chunksCount;
        hasRelevantContext = true;
        knowledgeContextText = relevantContext.combinedContext;
        knowledgeMaxScore = relevantContext.maxScore;
      }
    }

    if (
      normalizedQuery.length > 0 &&
      options?.includeChatHistory &&
      options?.chatId
    ) {
      const chatHistoryContext = await this.getChatHistoryContext(
        accountId,
        options.chatId,
        aiAgentId,
        normalizedQuery,
        15,
        minScore,
        options.phone
      );
      historyRawMaxScore = chatHistoryContext.rawMaxScore;

      if (chatHistoryContext.combinedContext) {
        contextParts.push(
          `### Histórico de Conversação Relevante:\n${chatHistoryContext.combinedContext}`
        );
        totalChunksCount += chatHistoryContext.chunksCount;
        hasRelevantContext = true;
        historyMaxScore = chatHistoryContext.maxScore;
      }
    }

    return {
      contextParts,
      chunksCount: totalChunksCount,
      hasRelevantContext,
      knowledgeContextText,
      knowledgeMaxScore,
      knowledgeRawMaxScore,
      historyMaxScore,
      historyRawMaxScore,
      hasConversationContext,
      conversationContextText,
    };
  }

  private formatRecentMessages(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  ): string {
    return messages
      .map((msg) => {
        const content = this.truncateText(
          this.normalizeText(msg.content),
          this.maxRecentMessageChars
        );
        if (!content) {
          return '';
        }
        return `${msg.role === 'user' ? 'Usuário' : 'Assistente'}: ${content}`;
      })
      .filter(Boolean)
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

  private buildCompactSystemPrompt(
    systemPrompt: string,
    bootstrapSummary: string | null
  ): string {
    const instructions = this.extractCriticalInstructions(systemPrompt);
    const normalizedSummary = this.normalizeText(bootstrapSummary ?? '');
    const summaryText = normalizedSummary
      ? this.truncateText(normalizedSummary, this.maxSummaryChars)
      : this.buildFallbackSystemSummary(systemPrompt);

    const parts: string[] = [];
    if (instructions) {
      parts.push(instructions);
    }
    if (summaryText) {
      parts.push('### RESUMO CONSOLIDADO DA BASE:\n' + summaryText);
    }

    if (parts.length === 0) {
      return this.truncateText(systemPrompt, 4000);
    }

    parts.push(
      '### REGRA FUNDAMENTAL:',
      'Use o resumo acima como referência principal para responder. Não invente informações fora desse resumo.'
    );

    return parts.join('\n\n');
  }

  private extractCriticalInstructions(systemPrompt: string): string {
    if (!systemPrompt) {
      return '';
    }
    const startIndex = systemPrompt.indexOf(
      '### INSTRUÇÕES CRÍTICAS DE CONTEXTO:'
    );
    if (startIndex === -1) {
      return this.truncateText(systemPrompt, 2000);
    }

    const endCandidates = [
      systemPrompt.indexOf('### BASE DE CONHECIMENTO', startIndex),
      systemPrompt.indexOf('### REGRA FUNDAMENTAL', startIndex),
    ].filter((index) => index !== -1);
    const endIndex =
      endCandidates.length > 0
        ? Math.min(...endCandidates)
        : systemPrompt.length;
    const slice = systemPrompt.slice(0, endIndex).trim();
    return this.truncateText(slice, 4000);
  }

  private buildFallbackSystemSummary(systemPrompt: string): string {
    if (!systemPrompt) {
      return '';
    }
    const baseIndex = systemPrompt.indexOf('### BASE DE CONHECIMENTO');
    if (baseIndex === -1) {
      return this.truncateText(systemPrompt, 2000);
    }
    const slice = systemPrompt.slice(baseIndex);
    return this.truncateText(slice, 4000);
  }

  private trimContextPartsToMaxChars(
    systemPrompt: string,
    contextParts: string[],
    bootstrapSummary: string | null | undefined,
    conversationSummary: string | null | undefined,
    maxPromptChars: number
  ): {
    contextParts: string[];
    bootstrapSummary: string | null;
    conversationSummary: string | null;
    hasRelevantContext: boolean;
    trimmed: boolean;
  } {
    const parts = contextParts.map((part) => this.parseContextPart(part));
    let workingParts = [...parts];
    let trimmed = false;

    const rebuildPromptLength = (
      nextParts: Array<{
        type: string;
        header: string;
        content: string;
      }>
    ): number => {
      const nextContextParts = nextParts.map((item) =>
        this.buildContextPartText(item)
      );
      const includeBootstrap = nextParts.some(
        (item) => item.type === 'bootstrap_summary'
      );
      const includeConversation = nextParts.some(
        (item) => item.type === 'conversation_summary'
      );
      const effectiveBootstrap = includeBootstrap
        ? (bootstrapSummary ?? null)
        : null;
      const effectiveConversation = includeConversation
        ? (conversationSummary ?? null)
        : null;
      const effectiveHasRelevantContext = nextContextParts.length > 0;
      return this.buildEnhancedPrompt(
        systemPrompt,
        nextContextParts,
        effectiveBootstrap,
        effectiveConversation,
        effectiveHasRelevantContext
      ).length;
    };

    const currentLength = rebuildPromptLength(workingParts);
    if (currentLength <= maxPromptChars) {
      return {
        contextParts,
        bootstrapSummary: bootstrapSummary ?? null,
        conversationSummary: conversationSummary ?? null,
        hasRelevantContext: contextParts.length > 0,
        trimmed,
      };
    }

    const removeTypesInOrder = ['recent_messages', 'history_context'];
    for (const type of removeTypesInOrder) {
      const filtered = workingParts.filter((item) => item.type !== type);
      if (filtered.length !== workingParts.length) {
        workingParts = filtered;
        trimmed = true;
        if (rebuildPromptLength(workingParts) <= maxPromptChars) {
          break;
        }
      }
    }

    if (rebuildPromptLength(workingParts) > maxPromptChars) {
      const conversationPart = workingParts.find(
        (item) => item.type === 'conversation_summary'
      );
      if (conversationPart && conversationPart.content.length > 0) {
        const originalContent = conversationPart.content;
        const targetSizes = [
          Math.min(2000, originalContent.length),
          Math.min(1000, originalContent.length),
        ];
        let applied = false;
        for (const size of targetSizes) {
          if (size <= 0) {
            continue;
          }
          conversationPart.content = this.truncateText(originalContent, size);
          trimmed = true;
          applied = true;
          if (rebuildPromptLength(workingParts) <= maxPromptChars) {
            break;
          }
        }
        if (applied && rebuildPromptLength(workingParts) > maxPromptChars) {
          workingParts = workingParts.filter(
            (item) => item.type !== 'conversation_summary'
          );
        }
      }
    }

    if (rebuildPromptLength(workingParts) > maxPromptChars) {
      const knowledgePart = workingParts.find(
        (item) => item.type === 'knowledge_context'
      );
      if (knowledgePart && knowledgePart.content.length > 0) {
        const currentLengthAfter = rebuildPromptLength(workingParts);
        const excess = currentLengthAfter - maxPromptChars;
        const minChars = 500;
        const targetLength = Math.max(
          minChars,
          knowledgePart.content.length - excess - 200
        );
        if (targetLength < knowledgePart.content.length) {
          knowledgePart.content = this.truncateText(
            knowledgePart.content,
            targetLength
          );
          trimmed = true;
        }
      }
    }

    if (rebuildPromptLength(workingParts) > maxPromptChars) {
      const lastMessagePart = workingParts.find(
        (item) => item.type === 'last_agent_message'
      );
      if (lastMessagePart && lastMessagePart.content.length > 0) {
        const currentLengthAfter = rebuildPromptLength(workingParts);
        const excess = currentLengthAfter - maxPromptChars;
        const minChars = 300;
        const targetLength = Math.max(
          minChars,
          lastMessagePart.content.length - excess - 200
        );
        if (targetLength < lastMessagePart.content.length) {
          lastMessagePart.content = this.truncateText(
            lastMessagePart.content,
            targetLength
          );
          trimmed = true;
        }
      }
    }

    if (rebuildPromptLength(workingParts) > maxPromptChars) {
      const filtered = workingParts.filter(
        (item) => item.type !== 'knowledge_context'
      );
      if (filtered.length !== workingParts.length) {
        workingParts = filtered;
        trimmed = true;
      }
    }

    const finalContextParts = workingParts.map((item) =>
      this.buildContextPartText(item)
    );
    const includeBootstrap = workingParts.some(
      (item) => item.type === 'bootstrap_summary'
    );
    const includeConversation = workingParts.some(
      (item) => item.type === 'conversation_summary'
    );
    const effectiveBootstrap = includeBootstrap
      ? (bootstrapSummary ?? null)
      : null;
    const effectiveConversation = includeConversation
      ? (conversationSummary ?? null)
      : null;
    const effectiveHasRelevantContext = finalContextParts.length > 0;

    return {
      contextParts: finalContextParts,
      bootstrapSummary: effectiveBootstrap,
      conversationSummary: effectiveConversation,
      hasRelevantContext: effectiveHasRelevantContext,
      trimmed,
    };
  }

  private parseContextPart(part: string): {
    type:
      | 'bootstrap_summary'
      | 'conversation_summary'
      | 'recent_messages'
      | 'last_agent_message'
      | 'knowledge_context'
      | 'history_context'
      | 'other';
    header: string;
    content: string;
  } {
    const [header, ...rest] = part.split('\n');
    const content = rest.join('\n');
    const normalizedHeader = header.trim().toLowerCase();
    let type:
      | 'bootstrap_summary'
      | 'conversation_summary'
      | 'recent_messages'
      | 'last_agent_message'
      | 'knowledge_context'
      | 'history_context'
      | 'other' = 'other';

    if (
      normalizedHeader.startsWith('### regras e conhecimento base do agente')
    ) {
      type = 'bootstrap_summary';
    } else if (normalizedHeader.startsWith('### sumário da conversa')) {
      type = 'conversation_summary';
    } else if (
      normalizedHeader.startsWith('### últimas mensagens da conversa')
    ) {
      type = 'recent_messages';
    } else if (
      normalizedHeader.startsWith('### última resposta do assistente')
    ) {
      type = 'last_agent_message';
    } else if (
      normalizedHeader.startsWith(
        '### contexto relevante da base de conhecimento'
      )
    ) {
      type = 'knowledge_context';
    } else if (
      normalizedHeader.startsWith('### histórico de conversação relevante')
    ) {
      type = 'history_context';
    }

    return {
      type,
      header,
      content,
    };
  }

  private buildContextPartText(part: {
    header: string;
    content: string;
  }): string {
    if (!part.content) {
      return part.header;
    }
    return `${part.header}\n${part.content}`;
  }

  private buildInstructionsText(
    contextParts: string[],
    bootstrapSummary?: string | null,
    conversationSummary?: string | null,
    hasRelevantContext = false
  ): string {
    let instructionsText =
      '- Responda usando apenas o contexto fornecido (prompts, RAG e histórico). Se algo não estiver no contexto, seja transparente e direcione o usuário para os temas que você pode cobrir.\n';
    instructionsText +=
      '- Quando houver contexto suficiente, seja completo e útil, trazendo detalhes, exemplos e informações relevantes.\n';
    instructionsText +=
      '- Responda de forma natural e humana, como se você fosse uma pessoa real respondendo. Evite mencionar "contexto fornecido", "com base no contexto" ou qualquer referência explícita a limitações técnicas.\n';
    instructionsText +=
      '- Quando a pergunta estiver fora do escopo, crie uma resposta original e educada redirecionando o usuário para os temas que você pode ajudar. NÃO use frases fixas ou genéricas — cada resposta deve ser única, natural e contextualizada ao que o usuário perguntou.\n';

    if (bootstrapSummary && bootstrapSummary.trim().length > 0) {
      instructionsText +=
        '- SIGA TODAS as regras do "Summary Inicial" e dos prompts do agente em TODAS as suas respostas. Essas regras são permanentes e devem ser respeitadas sempre.\n';
    }

    if (conversationSummary && conversationSummary.trim().length > 0) {
      instructionsText +=
        '- Use o "Sumário da Conversa" para manter consistência e contexto da conversa.\n';
    }

    if (hasRelevantContext || contextParts.length > 0) {
      instructionsText +=
        '- Absorva e utilize TODA a base de conhecimento disponível: prompts de texto, conteúdo de links/arquivos, contexto RAG e histórico de conversa. Combine todas essas fontes para entregar a resposta mais completa e precisa possível.\n';
      instructionsText +=
        '- Se a pergunta do usuário não se encaixar nos temas do agente, informe isso de forma breve e oriente o usuário para os assuntos em que você pode ajudar.\n';
    }

    return instructionsText;
  }

  private isQueryWithinContext(
    userQuery: string,
    options: {
      bootstrapSummary?: string | null;
      knowledgeContextText: string;
      knowledgeMaxScore: number;
      knowledgeRawMaxScore: number;
      historyMaxScore: number;
      historyRawMaxScore: number;
      hasConversationContext: boolean;
      conversationContextText: string;
      scoreThreshold: number;
    }
  ): boolean {
    const queryKeywords = this.extractKeywords(userQuery);
    const hasKnowledgeText =
      (options.bootstrapSummary &&
        options.bootstrapSummary.trim().length > 0) ||
      options.knowledgeContextText.trim().length > 0;
    const hasConversationText =
      options.conversationContextText &&
      options.conversationContextText.trim().length > 0;

    if (queryKeywords.length === 0) {
      return (
        options.hasConversationContext ||
        hasConversationText ||
        hasKnowledgeText
      );
    }

    const highConfidenceScore =
      options.knowledgeMaxScore >= options.scoreThreshold ||
      options.historyMaxScore >= options.scoreThreshold;

    if (highConfidenceScore) {
      return true;
    }

    const conversationKeywords = this.extractKeywords(
      options.conversationContextText ?? ''
    );
    const conversationKeywordSet = new Set(conversationKeywords);

    const contextText = [
      options.bootstrapSummary ?? '',
      options.knowledgeContextText ?? '',
      options.conversationContextText ?? '',
    ]
      .map((text) => this.normalizeText(text))
      .filter(Boolean)
      .join(' ');

    if (!contextText) {
      return false;
    }

    const contextKeywords = this.extractKeywords(contextText);
    if (contextKeywords.length === 0) {
      return false;
    }

    const contextKeywordSet = new Set(contextKeywords);
    if (queryKeywords.length === 1) {
      const token = queryKeywords[0];
      if (hasConversationText && conversationKeywordSet.has(token)) {
        return true;
      }
      return false;
    }

    const matchCount = queryKeywords.filter((token) =>
      contextKeywordSet.has(token)
    ).length;

    const conversationMatchCount = queryKeywords.filter((token) =>
      conversationKeywordSet.has(token)
    ).length;
    const conversationMatchRatio =
      conversationMatchCount / queryKeywords.length;

    const matchRatio = matchCount / queryKeywords.length;
    const requiredRatio = Math.max(this.minKeywordMatchRatio, 0.4);
    if (matchCount >= 3) {
      return true;
    }
    if (matchCount >= 2 && matchRatio >= requiredRatio) {
      return true;
    }

    if (!hasKnowledgeText && hasConversationText) {
      if (conversationMatchCount >= 1 && conversationMatchRatio >= 0.25) {
        return true;
      }
    }

    return false;
  }

  private buildContextHints(
    bootstrapSummary?: string | null,
    knowledgeContextText?: string
  ): string[] {
    const baseText = [bootstrapSummary ?? '', knowledgeContextText ?? '']
      .map((text) => this.normalizeText(text))
      .filter(Boolean)
      .join(' ');

    if (!baseText) {
      return [];
    }

    const keywords = this.extractKeywords(baseText);
    const seen = new Set<string>();
    const hints: string[] = [];

    for (const keyword of keywords) {
      if (seen.has(keyword)) {
        continue;
      }
      seen.add(keyword);
      hints.push(keyword);
      if (hints.length >= 6) {
        break;
      }
    }

    return hints;
  }

  private extractKeywords(text: string): string[] {
    const normalized = this.normalizeTextForComparison(text);
    if (!normalized) {
      return [];
    }

    return normalized
      .split(' ')
      .filter(
        (token) =>
          token.length >= this.minKeywordLength &&
          !this.keywordStopWords.has(token)
      );
  }

  private normalizeTextForComparison(text: string): string {
    if (!text) {
      return '';
    }

    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private emptyContext(): IRagContext & {
    chunksCount: number;
    maxScore: number;
    rawMaxScore: number;
  } {
    return {
      chunks: [],
      combinedContext: '',
      chunksCount: 0,
      maxScore: 0,
      rawMaxScore: 0,
    };
  }

  private normalizeText(text: unknown): string {
    if (typeof text !== 'string') {
      return '';
    }
    return text.trim();
  }

  private normalizeScore(score: unknown): number {
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      return 0;
    }
    return score;
  }

  private normalizeMinScore(minScore: number): number {
    if (!Number.isFinite(minScore)) {
      return 0;
    }
    return minScore;
  }

  private normalizeTopK(topK: number): number {
    if (!Number.isFinite(topK)) {
      return 0;
    }
    const normalized = Math.floor(topK);
    if (normalized <= 0) {
      return 0;
    }
    return Math.min(normalized, this.maxTopK);
  }

  private dedupeChunksByText(
    chunks: Array<{ text: string; score: number; promptId: string }>
  ): Array<{ text: string; score: number; promptId: string }> {
    const seen = new Set<string>();
    const result: Array<{ text: string; score: number; promptId: string }> = [];

    for (const chunk of chunks) {
      const key = chunk.text.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(chunk);
    }

    return result;
  }

  private truncateText(text: string, maxChars: number): string {
    if (maxChars <= 0) {
      return '';
    }
    if (text.length <= maxChars) {
      return text;
    }
    return text.slice(0, maxChars);
  }

  private buildCombinedContext(
    chunks: Array<{ text: string; score: number; promptId: string }>
  ): {
    chunks: Array<{ text: string; score: number; promptId: string }>;
    combinedContext: string;
  } {
    if (this.maxCombinedContextChars <= 0) {
      return { chunks: [], combinedContext: '' };
    }

    const selectedChunks: Array<{
      text: string;
      score: number;
      promptId: string;
    }> = [];
    const separator = '\n\n---\n\n';
    let currentLength = 0;

    for (const chunk of chunks) {
      const text = this.truncateText(chunk.text, this.maxChunkChars);
      if (!text) {
        continue;
      }

      const partLength =
        (selectedChunks.length > 0 ? separator.length : 0) + text.length;
      if (currentLength + partLength > this.maxCombinedContextChars) {
        const remaining = this.maxCombinedContextChars - currentLength;
        const allowedTextLength =
          remaining - (selectedChunks.length > 0 ? separator.length : 0);
        if (allowedTextLength <= 0) {
          break;
        }

        const trimmed = this.truncateText(text, allowedTextLength);
        if (!trimmed) {
          break;
        }

        selectedChunks.push({ ...chunk, text: trimmed });
        currentLength +=
          (selectedChunks.length > 1 ? separator.length : 0) + trimmed.length;
        break;
      }

      selectedChunks.push({ ...chunk, text });
      currentLength += partLength;
    }

    return {
      chunks: selectedChunks,
      combinedContext: selectedChunks
        .map((chunk) => chunk.text)
        .join(separator),
    };
  }
}
