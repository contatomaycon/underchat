import { injectable, inject } from 'tsyringe';
import { ChatService } from './chat.service';
import { AiAgentService } from './aiAgent.service';
import { VoiceIaService } from './voiceIa.service';
import { VoiceIaIntegrationService } from './voiceIaIntegration.service';
import { OpenAIAssistantService } from './openaiAssistant.service';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { WorkerConfigViewerRepository } from '@core/repositories/worker/WorkerConfigViewer.repository';
import { AiAgentUsageCreatorRepository } from '@core/repositories/aiAgent/AiAgentUsageCreator.repository';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { GenerateAiReplyResponse } from '@core/schema/chat/generateAiReply/response.schema';
import { ViewAiAgentResponse } from '@core/schema/aiAgent/viewAiAgent/response.schema';

@injectable()
export class AiReplyService {
  private readonly MAX_CONTEXT_MESSAGES = 30;

  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService,
    @inject(VoiceIaService)
    private readonly voiceIaService: VoiceIaService,
    @inject(VoiceIaIntegrationService)
    private readonly voiceIaIntegrationService: VoiceIaIntegrationService,
    @inject(OpenAIAssistantService)
    private readonly openAIAssistantService: OpenAIAssistantService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(WorkerConfigViewerRepository)
    private readonly workerConfigViewerRepository: WorkerConfigViewerRepository,
    @inject(AiAgentUsageCreatorRepository)
    private readonly aiAgentUsageCreatorRepository: AiAgentUsageCreatorRepository
  ) {}

  async generateReply(
    chatId: string,
    messageId: string,
    responseType: 'text' | 'audio',
    accountId: string,
    instructions?: string | null
  ): Promise<GenerateAiReplyResponse> {
    const chat = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chat) {
      throw new Error('Chat não encontrado.');
    }

    const workerId = chat.worker?.id;
    if (!workerId) {
      throw new Error('Canal do chat não encontrado.');
    }

    const aiAgentConfig =
      await this.workerConfigViewerRepository.fetchAiAgentValue(workerId);

    if (!aiAgentConfig.aiAgentId) {
      throw new Error('Nenhum agente de IA configurado neste canal.');
    }

    const aiAgent = await this.aiAgentService.viewAiAgent(
      aiAgentConfig.aiAgentId,
      accountId
    );

    if (!aiAgent) {
      throw new Error('Agente de IA não encontrado.');
    }

    if (!aiAgent.base_url || !aiAgent.api_key || !aiAgent.model) {
      throw new Error(
        'Agente de IA não está corretamente configurado (base_url, api_key ou model ausente).'
      );
    }

    const targetMessage = await this.chatService.findMessageByMessageId(
      accountId,
      messageId
    );

    if (!targetMessage) {
      throw new Error('Mensagem não encontrada.');
    }

    const contextMessages = await this.fetchContextMessages(
      accountId,
      chatId,
      this.MAX_CONTEXT_MESSAGES
    );

    const history = this.buildHistory(contextMessages);
    const userQuery = this.buildUserQuery(targetMessage, instructions);
    const prompt = this.buildPrompt(aiAgent, instructions);

    const generatedText = await this.callAiAgent(
      aiAgent,
      prompt,
      userQuery,
      history,
      { accountId, chatId, aiAgentId: aiAgent.ai_agent_id }
    );

    if (responseType === 'audio') {
      if (!aiAgent.voice_ia_id) {
        throw new Error(
          'O agente de IA não possui Voice IA configurado para gerar áudio.'
        );
      }

      const voiceIaConfig = await this.voiceIaService.viewVoiceIa(
        aiAgent.voice_ia_id,
        accountId
      );

      if (!voiceIaConfig) {
        throw new Error('Configuração de Voice IA não encontrada.');
      }

      const speechResult =
        await this.voiceIaIntegrationService.generateSpeechAndUpload(
          generatedText,
          voiceIaConfig,
          accountId
        );

      if (!speechResult) {
        throw new Error('Falha ao gerar áudio a partir do texto.');
      }

      return {
        text: generatedText,
        audio_url: speechResult.url,
        audio_duration: null,
      };
    }

    return { text: generatedText };
  }

  private async fetchContextMessages(
    accountId: string,
    chatId: string,
    limit: number
  ): Promise<IChatMessage[]> {
    const queryElastic = {
      size: limit,
      sort: [{ date: { order: 'desc' as const } }],
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: { term: { 'account.id': accountId } },
              },
            },
          ],
          filter: [{ term: { chat_id: chatId } }],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<IChatMessage>(
      EElasticIndex.message,
      queryElastic
    );

    const messages = (
      result?.hits?.hits
        ?.map((hit) => hit._source)
        .filter((source): source is IChatMessage => !!source) ?? []
    ).reverse();

    return messages;
  }

  private buildHistory(
    messages: IChatMessage[]
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    return messages
      .filter(
        (msg) => msg.content?.type === 'text' || msg.content?.type === 'audio'
      )
      .map((msg) => {
        const role: 'user' | 'assistant' =
          msg.type_user === 'client' ? 'user' : 'assistant';
        const content =
          msg.content?.message ||
          msg.content?.audio?.transcription ||
          '[mensagem sem texto]';

        return { role, content };
      });
  }

  private buildUserQuery(
    targetMessage: IChatMessage,
    instructions?: string | null
  ): string {
    const messageText =
      targetMessage.content?.message ||
      targetMessage.content?.audio?.transcription ||
      '[mensagem de áudio/mídia]';

    let query = `Responda à seguinte mensagem do cliente:\n\n"${messageText}"`;

    if (instructions?.trim()) {
      query += `\n\nOrientações adicionais do operador: ${instructions.trim()}`;
    }

    return query;
  }

  private buildPrompt(
    aiAgent: ViewAiAgentResponse,
    instructions?: string | null
  ): string {
    let prompt = aiAgent.system_prompt || '';

    prompt += `\n\nVocê está sendo usado por um operador humano para gerar uma resposta a uma mensagem específica de um cliente. Gere uma resposta direta e natural para ser enviada ao cliente. Não inclua saudações desnecessárias se o contexto não exigir. Seja objetivo e profissional.`;

    if (instructions?.trim()) {
      prompt += `\n\nO operador forneceu as seguintes orientações para esta resposta: ${instructions.trim()}`;
    }

    return prompt;
  }

  private async callAiAgent(
    aiAgent: ViewAiAgentResponse,
    prompt: string,
    userQuery: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    usageContext: { accountId: string; chatId: string; aiAgentId: string }
  ): Promise<string> {
    const { ai_agent_type_id } = aiAgent;
    const baseUrl = aiAgent.base_url as string;
    const apiKey = aiAgent.api_key as string;
    const modelName = aiAgent.model as string;

    if (
      ai_agent_type_id === EAiAgentType.gpt &&
      aiAgent.openai_vector_store_id
    ) {
      const result =
        await this.openAIAssistantService.createResponseWithFileSearch(
          apiKey,
          baseUrl,
          modelName,
          prompt,
          userQuery,
          aiAgent.openai_vector_store_id,
          history
        );

      await this.saveUsage(
        usageContext,
        result,
        modelName,
        'responses_file_search'
      );
      return result.text;
    }

    if (ai_agent_type_id === EAiAgentType.gemini) {
      const result = await this.callGeminiChatApi(
        baseUrl,
        apiKey,
        modelName,
        prompt,
        userQuery,
        history
      );

      await this.saveUsage(usageContext, result, modelName, 'chat');
      return result.text;
    }

    const result = await this.callOpenAiChatApi(
      baseUrl,
      apiKey,
      modelName,
      prompt,
      userQuery,
      history
    );

    await this.saveUsage(usageContext, result, modelName, 'chat');
    return result.text;
  }

  private async callOpenAiChatApi(
    baseUrl: string,
    apiKey: string,
    model: string,
    prompt: string,
    userQuery: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{
    text: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    latency_ms?: number;
  }> {
    const startMs = Date.now();

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: prompt },
          ...(history || []).map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          { role: 'user', content: userQuery },
        ],
      }),
    });

    const latency_ms = Date.now() - startMs;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI Agent API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const text =
      data.choices?.[0]?.message?.content ||
      'Desculpe, não consegui processar sua solicitação.';

    return { text, usage: data.usage, latency_ms };
  }

  private async callGeminiChatApi(
    baseUrl: string,
    apiKey: string,
    model: string,
    prompt: string,
    userQuery: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{
    text: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    latency_ms?: number;
  }> {
    const startMs = Date.now();
    const url = `${baseUrl.replace('/v1', '/v1beta')}/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const contents: Array<{
      role: 'user' | 'model';
      parts: Array<{ text: string }>;
    }> = [];

    if (history && history.length > 0) {
      for (const msg of history) {
        contents.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }],
        });
      }
    }

    contents.push({ role: 'user', parts: [{ text: userQuery }] });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: prompt }] },
      }),
    });

    const latency_ms = Date.now() - startMs;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI Agent API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      'Desculpe, não consegui processar sua solicitação.';

    const usage = data.usageMetadata
      ? {
          prompt_tokens: data.usageMetadata.promptTokenCount,
          completion_tokens: data.usageMetadata.candidatesTokenCount,
          total_tokens: data.usageMetadata.totalTokenCount,
        }
      : undefined;

    return { text, usage, latency_ms };
  }

  private async saveUsage(
    ctx: { accountId: string; chatId: string; aiAgentId: string },
    result: {
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
      latency_ms?: number;
    },
    model: string,
    requestType: string
  ): Promise<void> {
    try {
      await this.aiAgentUsageCreatorRepository.create({
        ai_agent_id: ctx.aiAgentId,
        account_id: ctx.accountId,
        chat_id: ctx.chatId,
        prompt_tokens: result.usage?.prompt_tokens ?? null,
        completion_tokens: result.usage?.completion_tokens ?? null,
        total_tokens: result.usage?.total_tokens ?? null,
        model: model ?? null,
        latency_ms: result.latency_ms ?? null,
        success: true,
        request_type: requestType,
      });
    } catch {
      // silently ignore usage logging errors
    }
  }
}
