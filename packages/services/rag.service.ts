import { injectable } from 'tsyringe';
import { EmbeddingService } from './embedding.service';
import { IRagContext } from '@core/common/interfaces/IRagContext';
import { AiAgentPromptListerRepository } from '@core/repositories/aiAgent/AiAgentPromptLister.repository';
import { EAiAgentPromptType } from '@core/common/enums/EAiAgentPromptType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

@injectable()
export class RagService {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly aiAgentPromptListerRepository: AiAgentPromptListerRepository
  ) {}

  async getChatHistoryContext(
    accountId: string,
    chatId: string,
    aiAgentId: string,
    userQuery: string,
    topK = 10,
    minScore = 0.0
  ): Promise<IRagContext> {
    const chunks = await this.embeddingService.searchChatHistory(
      accountId,
      chatId,
      aiAgentId,
      userQuery,
      topK
    );

    const relevantChunks = chunks.filter((chunk) => chunk.score >= minScore);

    const combinedContext = relevantChunks
      .map((chunk) => chunk.text)
      .join('\n\n---\n\n');

    return {
      chunks: relevantChunks.map((chunk) => ({
        text: chunk.text,
        score: chunk.score,
        promptId: chunk.message_id || '',
      })),
      combinedContext,
    };
  }

  async getRelevantContext(
    accountId: string,
    aiAgentId: string,
    userQuery: string,
    topK = 100,
    minScore = 0.0
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
      const summary = await this.callAiApiForSummary(
        baseUrl,
        apiKey,
        model,
        aiAgentTypeId,
        summaryPrompt
      );
      return summary.trim();
    } catch (error) {
      console.error('[generateBootstrapSummary] Erro ao gerar summary:', error);
      return allPrompts.substring(0, 2000);
    }
  }

  async generateOrUpdateConversationSummary(
    accountId: string,
    chatId: string,
    aiAgentId: string,
    previousSummary: string | null,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    baseUrl: string,
    apiKey: string,
    model: string,
    aiAgentTypeId: string,
    maxTokens = 2000
  ): Promise<string> {
    const messagesText = this.formatMessagesForSummary(recentMessages);
    const summaryPrompt = this.buildConversationSummaryPrompt(
      previousSummary,
      messagesText
    );

    try {
      const summary = await this.callAiApiForSummary(
        baseUrl,
        apiKey,
        model,
        aiAgentTypeId,
        summaryPrompt
      );

      if (summary.length > maxTokens) {
        return summary.substring(0, maxTokens);
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

    const contextParts = await this.buildContextParts(
      accountId,
      aiAgentId,
      userQuery,
      options
    );

    const totalChunks = this.countChunks(contextParts, options);

    const enhancedPrompt = this.buildEnhancedPrompt(
      systemPrompt,
      contextParts,
      options?.bootstrapSummary,
      options?.conversationSummary
    );

    return {
      enhancedPrompt,
      contextUsed: contextParts.length > 0,
      chunksCount: totalChunks,
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

Com base nos prompts completos do agente abaixo, crie um sumário inicial estruturado (máximo 2000 tokens) que capture:
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
      ? 'Atualize o sumário anterior incorporando as novas informações. Mantenha o máximo de 2000 tokens e preserve informações importantes do sumário anterior.'
      : 'Crie um sumário inicial da conversa (máximo 2000 tokens) capturando os pontos principais discutidos.';

    return `Você é um assistente especializado em criar e atualizar sumários de conversas.

${previousSummary ? `Sumário anterior da conversa:\n${previousSummary}\n\n` : ''}

Novas mensagens da conversa:
${messagesText}

${updateInstruction}

Gere APENAS o sumário atualizado, sem introduções ou explicações adicionais.`;
  }

  private async callAiApiForSummary(
    baseUrl: string,
    apiKey: string,
    model: string,
    aiAgentTypeId: string,
    prompt: string
  ): Promise<string> {
    const isGemini =
      aiAgentTypeId.includes('gemini') || baseUrl.includes('google');

    if (isGemini) {
      return this.callGeminiApiForSummary(baseUrl, apiKey, model, prompt);
    }

    return this.callOpenAiApiForSummary(baseUrl, apiKey, model, prompt);
  }

  private async callGeminiApiForSummary(
    baseUrl: string,
    apiKey: string,
    model: string,
    prompt: string
  ): Promise<string> {
    const apiVersion = baseUrl.replace('/v1', '/v1beta');
    const url = `${apiVersion}/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.3,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    return (
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      'Erro ao gerar sumário.'
    );
  }

  private async callOpenAiApiForSummary(
    baseUrl: string,
    apiKey: string,
    model: string,
    prompt: string
  ): Promise<string> {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Você é um assistente especializado em criar sumários concisos.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 2048,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    return data.choices?.[0]?.message?.content || 'Erro ao gerar sumário.';
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
    }
  ): Promise<string[]> {
    const contextParts: string[] = [];

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

    const topK = options?.topK ?? 8;
    const minScore = options?.minScore ?? 0.0;

    const { chunks, combinedContext } = await this.getRelevantContext(
      accountId,
      aiAgentId,
      userQuery,
      topK,
      minScore
    );

    if (combinedContext && combinedContext.trim().length > 0) {
      contextParts.push(
        `### Contexto Relevante da Base de Conhecimento (Top ${chunks.length} resultados):\n${combinedContext}`
      );
    }

    if (options?.includeChatHistory && options?.chatId) {
      const chatHistoryContext = await this.getChatHistoryContext(
        accountId,
        options.chatId,
        aiAgentId,
        userQuery,
        10,
        minScore
      );

      if (chatHistoryContext.combinedContext) {
        contextParts.push(
          `### Histórico de Conversação Relevante:\n${chatHistoryContext.combinedContext}`
        );
      }
    }

    return contextParts;
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

  private countChunks(
    contextParts: string[],
    options?: {
      chatId?: string;
      includeChatHistory?: boolean;
    }
  ): number {
    if (contextParts.length === 0) {
      return 0;
    }

    const baseChunks = this.extractBaseChunksCount(contextParts);

    if (!options?.includeChatHistory || !options?.chatId) {
      return baseChunks;
    }

    const hasChatHistory = contextParts.some((part) =>
      part.includes('Histórico de Conversação Relevante')
    );

    if (!hasChatHistory) {
      return baseChunks;
    }

    return baseChunks + 10;
  }

  private extractBaseChunksCount(contextParts: string[]): number {
    const ragPart = contextParts.find((part) =>
      part.includes('Contexto Relevante da Base de Conhecimento')
    );

    if (!ragPart) {
      return 0;
    }

    const match = ragPart.match(/Top (\d+) resultados/);
    if (!match) {
      return 0;
    }

    return Number.parseInt(match[1], 10) || 0;
  }

  private buildEnhancedPrompt(
    systemPrompt: string,
    contextParts: string[],
    bootstrapSummary?: string | null,
    conversationSummary?: string | null
  ): string {
    const finalContext = contextParts.join('\n\n');
    const instructionsText = this.buildInstructionsText(
      contextParts,
      bootstrapSummary,
      conversationSummary
    );

    return `${systemPrompt}

${finalContext || '(Nenhum contexto adicional disponível)'}

### Instruções Importantes:
${instructionsText || 'Responda à pergunta do usuário de forma clara e precisa.'}`;
  }

  private buildInstructionsText(
    contextParts: string[],
    bootstrapSummary?: string | null,
    conversationSummary?: string | null
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

    if (contextParts.length > 0) {
      instructionsText +=
        '- Use o contexto acima para responder à pergunta do usuário. Sempre priorize as informações do contexto fornecido.\n';
      return instructionsText;
    }

    instructionsText += '- Responda com base no seu conhecimento geral.';
    return instructionsText;
  }
}
