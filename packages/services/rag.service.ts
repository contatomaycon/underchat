import { injectable, inject } from 'tsyringe';
import { EmbeddingService } from './embedding.service';
import { IRagContext } from '@core/common/interfaces/IRagContext';
import { AiAgentPromptListerRepository } from '@core/repositories/aiAgent/AiAgentPromptLister.repository';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { SummaryProviderFactory } from './summary/summaryProviderFactory.service';

@injectable()
export class RagService {
  private readonly maxTopK = 100;
  private readonly maxChunkChars = 4000;
  private readonly maxCombinedContextChars = 28000;
  private readonly retrievalQuerySummarySnippetChars = 400;
  private readonly maxRecentMessageChars = 1500;
  private readonly maxSummaryChars = 12000;
  private readonly minContextScore = 0.35;
  private readonly minKeywordLength = 3;
  private readonly minKeywordMatchRatio = 0.4;
  private readonly hybridVectorWeight = 0.55;
  private readonly hybridLexicalWeight = 0.45;
  private readonly exactFaqMinScore = 0.62;
  private readonly hybridEvidenceMinScore = 0.42;
  private readonly hybridCandidateMultiplier = 3;
  private readonly maxFaqAnswerChars = 1400;
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
  private readonly contextHintStopWords = new Set([
    'sumario',
    'resumo',
    'contexto',
    'prompt',
    'rag',
    'arquivo',
    'arquivos',
    'link',
    'links',
    'documento',
    'documentos',
    'fonte',
    'fontes',
    'sistema',
    'modelo',
    'assistente',
    'assistant',
    'mensagem',
    'mensagens',
    'conversa',
    'historico',
    'historia',
    'chat',
    'chatbot',
    'bot',
    'agente',
    'agent',
    'ia',
    'inteligencia',
    'artificial',
  ]);

  constructor(
    @inject(EmbeddingService)
    private readonly embeddingService: EmbeddingService,
    @inject(AiAgentPromptListerRepository)
    private readonly aiAgentPromptListerRepository: AiAgentPromptListerRepository,
    @inject(SummaryProviderFactory)
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
    minScore = 0.0,
    options?: {
      allowedPromptIds?: string[];
    }
  ): Promise<
    IRagContext & {
      chunksCount: number;
      maxScore: number;
      rawMaxScore: number;
      exactMatchFound: boolean;
      exactMatchScore: number;
      lexicalCoverage: number;
    }
  > {
    try {
      const candidateTopK = Math.max(
        topK,
        topK * this.hybridCandidateMultiplier
      );
      const chunks = await this.embeddingService.searchSimilarChunks(
        accountId,
        aiAgentId,
        userQuery,
        candidateTopK,
        {
          allowedPromptIds: options?.allowedPromptIds,
        }
      );
      const hybridChunks = this.rerankChunksWithHybridSignals(
        userQuery,
        chunks
      );
      const topHybridChunk = hybridChunks[0];
      const exactMatch = this.findBestFaqSectionMatch(userQuery, hybridChunks);
      const chunksWithExactMatch = exactMatch
        ? [
            {
              text: exactMatch.contextText,
              score: exactMatch.score,
              promptId: exactMatch.promptId,
            },
            ...hybridChunks,
          ]
        : hybridChunks;

      const processed = this.processChunks(chunksWithExactMatch, minScore);

      return {
        ...processed,
        exactMatchFound: !!exactMatch,
        exactMatchScore: exactMatch?.score ?? 0,
        lexicalCoverage: topHybridChunk?.lexicalCoverage ?? 0,
      };
    } catch (error) {
      console.error(
        '[getRelevantContext] Erro ao buscar contexto relevante:',
        error
      );
      return {
        ...this.emptyContext(),
        exactMatchFound: false,
        exactMatchScore: 0,
        lexicalCoverage: 0,
      };
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

    return this.formatFilePrompts(activePrompts);
  }

  async getAllAgentPromptsDetailed(
    accountId: string,
    aiAgentId: string
  ): Promise<
    Array<{
      ai_agent_prompt_id: string;
      value: string;
      status: EAiAgentStatus;
      updated_at: string | null;
    }>
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
          ai_agent_prompt_id: prompt.ai_agent_prompt_id,
          value: prompt.value,
          status: prompt.status,
          updated_at: prompt.updated_at,
        }));
    } catch (error) {
      console.error(
        '[getAllAgentPromptsDetailed] Erro ao listar prompts:',
        error
      );
      return [];
    }
  }

  buildPromptsTextFromDetailed(prompts: Array<{ value: string }>): string {
    if (!prompts || prompts.length === 0) {
      return '';
    }
    const filtered = prompts.filter(
      (prompt) => prompt.value && prompt.value.trim().length > 0
    );
    if (filtered.length === 0) {
      return '';
    }
    return this.formatFilePrompts(filtered);
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

    return this.generateBootstrapSummaryFromPrompts(
      allPrompts,
      baseUrl,
      apiKey,
      model,
      aiAgentTypeId
    );
  }

  async generateBootstrapSummaryFromPrompts(
    allPrompts: string,
    baseUrl: string,
    apiKey: string,
    model: string,
    aiAgentTypeId: string
  ): Promise<string> {
    if (!allPrompts || allPrompts.trim().length === 0) {
      return '';
    }

    const normalizedPrompts = allPrompts.trim();
    const maxChunkChars = 12000;
    const chunks = this.splitTextIntoChunks(
      normalizedPrompts,
      maxChunkChars,
      12
    );

    if (chunks.length === 1) {
      const summaryPrompt = this.buildBootstrapSummaryPrompt(normalizedPrompts);
      const summary = await this.generateSummaryWithProvider(
        summaryPrompt,
        baseUrl,
        apiKey,
        model,
        aiAgentTypeId
      );
      return summary || normalizedPrompts.substring(0, 8000);
    }

    const partialSummaries: string[] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const chunkPrompt = this.buildBootstrapSummaryChunkPrompt(
        chunks[i],
        i + 1,
        chunks.length
      );
      const partial = await this.generateSummaryWithProvider(
        chunkPrompt,
        baseUrl,
        apiKey,
        model,
        aiAgentTypeId
      );
      if (partial) {
        partialSummaries.push(partial);
      } else {
        partialSummaries.push(this.truncateText(chunks[i], 2000));
      }
    }

    const combined = partialSummaries.join('\n\n');
    const mergePrompt = this.buildBootstrapSummaryMergePrompt(combined);
    const merged = await this.generateSummaryWithProvider(
      mergePrompt,
      baseUrl,
      apiKey,
      model,
      aiAgentTypeId
    );

    if (merged) {
      return merged;
    }

    return this.truncateText(combined, this.maxSummaryChars);
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
      historyTopK?: number;
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
    contextParts: string[];
    contextUsed: boolean;
    chunksCount: number;
    contextAllowed: boolean;
    contextHints: string[];
    evidence: {
      hasEvidence: boolean;
      decisionPath: 'exact_match' | 'hybrid_retrieval' | 'out_of_context';
      knowledgeScore: number;
      historyScore: number;
      lexicalCoverage: number;
      exactMatchScore: number;
    };
  }> {
    const isBootstrap = options?.isBootstrap ?? false;

    if (isBootstrap) {
      const bootstrapPrompt = await this.buildBootstrapPrompt(
        accountId,
        aiAgentId
      );
      return {
        ...bootstrapPrompt,
        contextParts: [],
        contextAllowed: true,
        contextHints: [],
        evidence: {
          hasEvidence: true,
          decisionPath: 'hybrid_retrieval',
          knowledgeScore: 1,
          historyScore: 0,
          lexicalCoverage: 1,
          exactMatchScore: 0,
        },
      };
    }

    const includeBootstrapSummaryInPrompt =
      options?.includeBootstrapSummaryInPrompt ?? true;
    const {
      contextParts,
      chunksCount,
      knowledgeMaxScore,
      knowledgeRawMaxScore,
      knowledgeExactMatchFound,
      knowledgeExactMatchScore,
      knowledgeLexicalCoverage,
      historyMaxScore,
      historyRawMaxScore,
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

    const effectiveSignals =
      this.buildContextSignalsFromParts(adjustedContextParts);
    const effectiveKnowledgeContextText = effectiveSignals.knowledgeContextText;
    const effectiveConversationContextText =
      effectiveSignals.conversationContextText;
    const effectiveKnowledgeMaxScore = effectiveSignals.hasKnowledgeContext
      ? knowledgeMaxScore
      : 0;
    const effectiveKnowledgeRawMaxScore = effectiveSignals.hasKnowledgeContext
      ? knowledgeRawMaxScore
      : 0;
    const effectiveHistoryMaxScore = effectiveSignals.hasHistoryContext
      ? historyMaxScore
      : 0;
    const effectiveHistoryRawMaxScore = effectiveSignals.hasHistoryContext
      ? historyRawMaxScore
      : 0;
    const effectiveHasConversationContext =
      effectiveSignals.hasConversationContext;
    const contextScoreThreshold = Math.max(
      this.minContextScore,
      this.normalizeMinScore(options?.minScore ?? this.minContextScore)
    );
    const contextAllowedByQueryAndContext = this.isQueryWithinContext(
      userQuery,
      {
        bootstrapSummary: null,
        knowledgeContextText: effectiveKnowledgeContextText,
        knowledgeMaxScore: effectiveKnowledgeMaxScore,
        knowledgeRawMaxScore: effectiveKnowledgeRawMaxScore,
        historyMaxScore: effectiveHistoryMaxScore,
        historyRawMaxScore: effectiveHistoryRawMaxScore,
        hasConversationContext: effectiveHasConversationContext,
        conversationContextText: effectiveConversationContextText,
        scoreThreshold: contextScoreThreshold,
      }
    );
    const evidenceByScores =
      knowledgeExactMatchFound ||
      effectiveKnowledgeMaxScore >= contextScoreThreshold ||
      effectiveHistoryMaxScore >= contextScoreThreshold ||
      (knowledgeLexicalCoverage >= 0.5 &&
        effectiveKnowledgeMaxScore >= this.hybridEvidenceMinScore);
    const contextAllowed = knowledgeExactMatchFound
      ? true
      : contextAllowedByQueryAndContext && evidenceByScores;
    const decisionPath: 'exact_match' | 'hybrid_retrieval' | 'out_of_context' =
      knowledgeExactMatchFound
        ? 'exact_match'
        : contextAllowed
          ? 'hybrid_retrieval'
          : 'out_of_context';
    const contextHints = this.buildContextHints(
      options?.bootstrapSummary,
      effectiveKnowledgeContextText
    );

    return {
      enhancedPrompt,
      contextParts: adjustedContextParts,
      contextUsed: adjustedContextParts.length > 0,
      chunksCount,
      contextAllowed,
      contextHints,
      evidence: {
        hasEvidence: contextAllowed,
        decisionPath,
        knowledgeScore: effectiveKnowledgeMaxScore,
        historyScore: effectiveHistoryMaxScore,
        lexicalCoverage: knowledgeLexicalCoverage,
        exactMatchScore: knowledgeExactMatchScore,
      },
    };
  }

  buildEnhancedPromptFromCachedParts(
    systemPrompt: string,
    contextParts: string[],
    contextAllowed: boolean,
    contextHints: string[]
  ): {
    enhancedPrompt: string;
    contextAllowed: boolean;
    contextHints: string[];
  } {
    const enhancedPrompt = this.buildEnhancedPrompt(
      systemPrompt,
      contextParts,
      undefined,
      undefined,
      contextParts.length > 0
    );
    return { enhancedPrompt, contextAllowed, contextHints };
  }

  private formatFilePrompts(activePrompts: Array<{ value: string }>): string {
    const values = activePrompts
      .filter((prompt) => prompt.value && prompt.value.trim().length > 0)
      .map((prompt) => prompt.value.trim())
      .filter((value) => !this.looksLikeUrl(value));

    if (values.length === 0) {
      return '';
    }

    return `### Base de Conhecimento — Arquivos:\n${values.join('\n\n---\n\n')}`;
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

  private buildBootstrapSummaryChunkPrompt(
    chunk: string,
    index: number,
    total: number
  ): string {
    return `Você é um assistente especializado em criar sumários concisos e estruturados de informações.

Este é um trecho (${index}/${total}) da base de conhecimento do agente.
Resuma o conteúdo abaixo preservando TODAS as regras, fatos, requisitos, fluxos e restrições.
Não invente informações e não omita detalhes críticos.

Trecho:
${chunk}

Gere APENAS o sumário desse trecho, sem introduções ou explicações adicionais.`;
  }

  private buildBootstrapSummaryMergePrompt(partialSummaries: string): string {
    return `Você é um assistente especializado em consolidar sumários.

Combine os resumos parciais abaixo em um único sumário completo e organizado, preservando TODAS as regras, fatos e informações críticas.
Evite duplicações e mantenha o máximo de 3000 tokens.

Resumos parciais:
${partialSummaries}

Gere APENAS o sumário consolidado, sem introduções ou explicações adicionais.`;
  }

  private async generateSummaryWithProvider(
    summaryPrompt: string,
    baseUrl: string,
    apiKey: string,
    model: string,
    aiAgentTypeId: string
  ): Promise<string> {
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
      return '';
    }
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
      historyTopK?: number;
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
    knowledgeExactMatchFound: boolean;
    knowledgeExactMatchScore: number;
    knowledgeLexicalCoverage: number;
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
    let knowledgeExactMatchFound = false;
    let knowledgeExactMatchScore = 0;
    let knowledgeLexicalCoverage = 0;
    let historyMaxScore = 0;
    let historyRawMaxScore = 0;
    let conversationContextText = '';
    const activePrompts = await this.getAllAgentPromptsDetailed(
      accountId,
      aiAgentId
    );
    const activePromptIds = activePrompts.map(
      (prompt) => prompt.ai_agent_prompt_id
    );
    const normalizedQuery = this.normalizeText(userQuery);
    const summarySnippet =
      options?.conversationSummary &&
      options.conversationSummary.trim().length > 0
        ? this.truncateText(
            this.normalizeText(options.conversationSummary),
            this.retrievalQuerySummarySnippetChars
          )
        : '';
    const retrievalQuery = [normalizedQuery, summarySnippet]
      .filter(Boolean)
      .join(' ')
      .trim();
    const queryForRetrieval =
      retrievalQuery.length > 0 ? retrievalQuery : normalizedQuery;
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
    const historyTopK = this.normalizeTopK(options?.historyTopK ?? 20);
    const minScore = this.normalizeMinScore(options?.minScore ?? 0.0);

    if (queryForRetrieval.length > 0 && topK > 0) {
      const relevantContext = await this.getRelevantContext(
        accountId,
        aiAgentId,
        queryForRetrieval,
        topK,
        minScore,
        {
          allowedPromptIds: activePromptIds,
        }
      );
      knowledgeRawMaxScore = relevantContext.rawMaxScore;
      knowledgeExactMatchFound = relevantContext.exactMatchFound;
      knowledgeExactMatchScore = relevantContext.exactMatchScore;
      knowledgeLexicalCoverage = relevantContext.lexicalCoverage;

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
      queryForRetrieval.length > 0 &&
      options?.includeChatHistory &&
      options?.chatId
    ) {
      const chatHistoryContext = await this.getChatHistoryContext(
        accountId,
        options.chatId,
        aiAgentId,
        queryForRetrieval,
        historyTopK,
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
      knowledgeExactMatchFound,
      knowledgeExactMatchScore,
      knowledgeLexicalCoverage,
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
    const matchesKeyword = (
      token: string,
      keywordSet: Set<string>,
      keywords: string[]
    ): boolean => {
      if (keywordSet.has(token)) {
        return true;
      }
      if (token.length < this.minKeywordLength) {
        return false;
      }
      for (const keyword of keywords) {
        if (keyword.startsWith(token) || token.startsWith(keyword)) {
          return true;
        }
      }
      return false;
    };
    if (queryKeywords.length === 1) {
      const token = queryKeywords[0];
      if (
        hasConversationText &&
        matchesKeyword(token, conversationKeywordSet, conversationKeywords)
      ) {
        return true;
      }
      if (matchesKeyword(token, contextKeywordSet, contextKeywords)) {
        return true;
      }
      return false;
    }

    const matchCount = queryKeywords.filter((token) =>
      matchesKeyword(token, contextKeywordSet, contextKeywords)
    ).length;

    const conversationMatchCount = queryKeywords.filter((token) =>
      matchesKeyword(token, conversationKeywordSet, conversationKeywords)
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
      if (this.contextHintStopWords.has(keyword)) {
        continue;
      }
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

  private buildContextSignalsFromParts(contextParts: string[]): {
    knowledgeContextText: string;
    historyContextText: string;
    conversationContextText: string;
    hasKnowledgeContext: boolean;
    hasHistoryContext: boolean;
    hasConversationContext: boolean;
  } {
    const parsed = contextParts.map((part) => this.parseContextPart(part));
    const knowledgeParts: string[] = [];
    const historyParts: string[] = [];
    const conversationParts: string[] = [];

    for (const part of parsed) {
      const content = this.normalizeText(part.content);
      if (!content) {
        continue;
      }
      if (part.type === 'knowledge_context') {
        knowledgeParts.push(content);
      } else if (part.type === 'history_context') {
        historyParts.push(content);
      } else if (
        part.type === 'conversation_summary' ||
        part.type === 'recent_messages' ||
        part.type === 'last_agent_message'
      ) {
        conversationParts.push(content);
      }
    }

    const knowledgeContextText = knowledgeParts.join(' ');
    const historyContextText = historyParts.join(' ');
    const conversationContextText = conversationParts.join(' ');

    return {
      knowledgeContextText,
      historyContextText,
      conversationContextText,
      hasKnowledgeContext: knowledgeContextText.length > 0,
      hasHistoryContext: historyContextText.length > 0,
      hasConversationContext: conversationContextText.length > 0,
    };
  }

  private rerankChunksWithHybridSignals(
    userQuery: string,
    chunks: Array<{ text: string; score: number; promptId: string }>
  ): Array<{
    text: string;
    score: number;
    promptId: string;
    lexicalCoverage: number;
  }> {
    const queryKeywords = this.extractKeywords(userQuery);
    const normalizedQuery = this.normalizeTextForComparison(userQuery);
    const queryKeywordCount = Math.max(queryKeywords.length, 1);

    return chunks
      .map((chunk) => {
        const normalizedText = this.normalizeTextForComparison(chunk.text);
        const chunkKeywords = this.extractKeywords(chunk.text);
        const chunkKeywordSet = new Set(chunkKeywords);

        const overlapCount = queryKeywords.filter(
          (keyword) =>
            chunkKeywordSet.has(keyword) ||
            chunkKeywords.some(
              (chunkKeyword) =>
                chunkKeyword.startsWith(keyword) ||
                keyword.startsWith(chunkKeyword)
            )
        ).length;
        const lexicalCoverage = overlapCount / queryKeywordCount;
        const phraseBoost =
          normalizedQuery.length > 8 &&
          (normalizedText.includes(normalizedQuery) ||
            normalizedQuery.includes(
              normalizedText.slice(0, normalizedQuery.length)
            ))
            ? 0.2
            : 0;
        const vectorScore = this.normalizeToUnit(chunk.score);
        const hybridScore = Math.min(
          1,
          vectorScore * this.hybridVectorWeight +
            lexicalCoverage * this.hybridLexicalWeight +
            phraseBoost
        );

        return {
          ...chunk,
          score: hybridScore,
          lexicalCoverage,
        };
      })
      .filter((chunk) => {
        if (queryKeywords.length === 0) {
          return true;
        }
        if (chunk.score >= this.hybridEvidenceMinScore) {
          return true;
        }
        return chunk.lexicalCoverage >= 0.25;
      })
      .sort((a, b) => b.score - a.score);
  }

  private findBestFaqSectionMatch(
    userQuery: string,
    chunks: Array<{
      text: string;
      score: number;
      promptId: string;
      lexicalCoverage: number;
    }>
  ): { contextText: string; promptId: string; score: number } | null {
    const queryKeywords = this.extractKeywords(userQuery);
    if (queryKeywords.length === 0) {
      return null;
    }

    const normalizedQuery = this.normalizeTextForComparison(userQuery);
    let bestMatch: {
      contextText: string;
      promptId: string;
      score: number;
    } | null = null;

    for (const chunk of chunks) {
      const faqSections = this.extractFaqSections(chunk.text);
      if (faqSections.length === 0) {
        continue;
      }

      for (const section of faqSections) {
        const questionKeywords = this.extractKeywords(section.question);
        if (questionKeywords.length === 0) {
          continue;
        }

        const questionKeywordSet = new Set(questionKeywords);
        const overlapCount = queryKeywords.filter((keyword) =>
          questionKeywordSet.has(keyword)
        ).length;

        const questionCoverage = overlapCount / queryKeywords.length;
        const recallCoverage = overlapCount / questionKeywords.length;
        const exactBoost =
          normalizedQuery.length > 8 &&
          (this.normalizeTextForComparison(section.question).includes(
            normalizedQuery
          ) ||
            normalizedQuery.includes(
              this.normalizeTextForComparison(section.question)
            ))
            ? 0.25
            : 0;
        const score = Math.min(
          1,
          questionCoverage * 0.65 + recallCoverage * 0.35 + exactBoost
        );

        if (score < this.exactFaqMinScore) {
          continue;
        }

        const contextText = [
          `Pergunta encontrada na base: ${section.question}`,
          `Resposta oficial: ${this.truncateText(section.answer, this.maxFaqAnswerChars)}`,
        ].join('\n');

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = {
            contextText,
            promptId: chunk.promptId,
            score,
          };
        }
      }
    }

    return bestMatch;
  }

  private extractFaqSections(
    text: string
  ): Array<{ question: string; answer: string }> {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return [];
    }

    const sections: Array<{ question: string; answer: string }> = [];
    let currentQuestion = '';
    let currentAnswerLines: string[] = [];

    const flushCurrent = (): void => {
      if (!currentQuestion || currentAnswerLines.length === 0) {
        return;
      }
      sections.push({
        question: currentQuestion,
        answer: currentAnswerLines.join('\n').trim(),
      });
    };

    for (const line of lines) {
      if (this.isLikelyFaqQuestion(line)) {
        flushCurrent();
        currentQuestion = line;
        currentAnswerLines = [];
        continue;
      }

      if (!currentQuestion) {
        continue;
      }

      currentAnswerLines.push(line);
    }

    flushCurrent();
    return sections;
  }

  private isLikelyFaqQuestion(line: string): boolean {
    if (!line) {
      return false;
    }

    const normalized = line.trim();
    if (normalized.length < 10 || normalized.length > 260) {
      return false;
    }

    if (normalized.endsWith('?')) {
      return true;
    }

    return /^(pergunta|q)[:\-]/i.test(normalized);
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

  private looksLikeUrl(value: string): boolean {
    return /^https?:\/\//i.test(value.trim());
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

  private normalizeToUnit(score: number): number {
    if (!Number.isFinite(score)) {
      return 0;
    }
    if (score >= 0 && score <= 1) {
      return score;
    }
    return Math.max(0, Math.min(1, (score + 1) / 2));
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

  private splitTextIntoChunks(
    text: string,
    maxChars: number,
    maxChunks: number
  ): string[] {
    if (!text) {
      return [];
    }
    if (text.length <= maxChars) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0 && chunks.length < maxChunks) {
      if (remaining.length <= maxChars) {
        chunks.push(remaining);
        break;
      }

      let sliceEnd = maxChars;
      const slice = remaining.slice(0, maxChars);
      const lastParagraph = slice.lastIndexOf('\n\n');
      const lastLine = slice.lastIndexOf('\n');
      const candidate =
        lastParagraph > maxChars * 0.5
          ? lastParagraph
          : lastLine > maxChars * 0.5
            ? lastLine
            : -1;

      if (candidate > 0) {
        sliceEnd = candidate;
      }

      const chunk = remaining.slice(0, sliceEnd).trim();
      if (chunk) {
        chunks.push(chunk);
      }

      remaining = remaining.slice(sliceEnd).trim();
    }

    if (remaining.length > 0 && chunks.length === maxChunks) {
      const lastIndex = chunks.length - 1;
      chunks[lastIndex] = this.truncateText(
        `${chunks[lastIndex]}\n\n${remaining}`,
        maxChars
      );
    }

    return chunks;
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
