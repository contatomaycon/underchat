import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { mensageMappings } from '@core/mappings/mensage.mappings';
import { IChat } from '@core/common/interfaces/IChat';
import { chatMappings } from '@core/mappings/chat.mappings';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { WorkerConfigForChatViewerRepository } from '@core/repositories/chat/WorkerConfigForChatViewer.repository';
import { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';

type ElasticHit<T> = {
  _source?: T;
};

@injectable()
export class ChatService {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly workerConfigForChatViewerRepository: WorkerConfigForChatViewerRepository
  ) {}

  saveMessageChat = async (messageChat: IChatMessage): Promise<boolean> => {
    const mappings = mensageMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.message,
      mappings
    );

    if (!result || !messageChat) {
      return false;
    }

    return this.elasticDatabaseService.update(
      EElasticIndex.message,
      messageChat,
      messageChat.message_id
    );
  };

  saveChat = async (chat: IChat): Promise<boolean> => {
    const mappings = chatMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.chat,
      mappings
    );

    if (!result || !chat) {
      return false;
    }

    return this.elasticDatabaseService.update(
      EElasticIndex.chat,
      chat,
      chat.chat_id
    );
  };

  findChatByChatId = async (
    accountId: string,
    chatId: string
  ): Promise<IChat | null> => {
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
    const chat = hit?._source ?? null;

    if (chat && Array.isArray(chat.summary)) {
      chat.summary = chat.summary[0] as IChat['summary'];
    }

    return chat;
  };

  updateChatStatus = async (
    chatId: string,
    status: IChat['status'],
    user?: IChat['user'] | null,
    startedAt?: string | null,
    closedAt?: string | null
  ): Promise<boolean> => {
    const updateData: {
      status: IChat['status'];
      user?: IChat['user'] | null;
      started_at?: string | null;
      closed_at?: string | null;
    } = {
      status,
    };

    if (user !== undefined) {
      updateData.user = user;
    }

    if (startedAt !== undefined) {
      updateData.started_at = startedAt;
    }

    if (closedAt !== undefined) {
      updateData.closed_at = closedAt;
    }

    return this.elasticDatabaseService.update(
      EElasticIndex.chat,
      updateData,
      chatId
    );
  };

  updateChatUserAndSector = async (
    chatId: string,
    user?: IChat['user'] | null,
    sector?: IChat['sector'] | null
  ): Promise<boolean> => {
    const updateData: {
      user?: IChat['user'] | null;
      sector?: IChat['sector'] | null;
    } = {};

    if (user !== undefined) {
      updateData.user = user;
    }

    if (sector !== undefined) {
      updateData.sector = sector;
    }

    return this.elasticDatabaseService.update(
      EElasticIndex.chat,
      updateData,
      chatId
    );
  };

  updateChatSummary = async (
    chatId: string,
    summary: IChat['summary']
  ): Promise<boolean> => {
    try {
      const summaryToUpdate = Array.isArray(summary) ? summary[0] : summary;

      return await this.elasticDatabaseService.update(
        EElasticIndex.chat,
        { summary: summaryToUpdate },
        chatId
      );
    } catch (error) {
      console.error('Error updating chat summary:', error);
      return false;
    }
  };

  clearChatSummary = async (
    chatId: string,
    accountId: string
  ): Promise<boolean> => {
    try {
      const chat = await this.findChatByChatId(accountId, chatId);

      if (!chat) return false;

      const summary: IChat['summary'] = {
        last_message: chat.summary?.last_message ?? null,
        last_date: chat.summary?.last_date ?? new Date().toISOString(),
        unread_count: 0,
      };

      return await this.updateChatSummary(chatId, summary);
    } catch (error) {
      console.error('Error clearing chat summary:', error);
      return false;
    }
  };

  findChatByPhone = async (
    accountId: string,
    workerId: string,
    phone: string
  ): Promise<IChat | null> => {
    const candidates = buildCandidates(phone);
    const shouldClauses: any[] = [];

    if (Array.isArray(candidates) && candidates.length) {
      shouldClauses.push({ terms: { phone: candidates } });
    }

    const queryElastic = {
      size: 1,
      _source: true,
      query: {
        bool: {
          filter: [
            {
              nested: {
                path: 'account',
                query: { term: { 'account.id': accountId } },
              },
            },
            {
              nested: {
                path: 'worker',
                query: { term: { 'worker.id': workerId } },
              },
            },
            {
              terms: {
                status: [
                  EChatStatus.in_chat,
                  EChatStatus.queue,
                  EChatStatus.ura,
                ],
              },
            },
          ],
          ...(shouldClauses.length
            ? {
                must: [
                  { bool: { should: shouldClauses, minimum_should_match: 1 } },
                ],
              }
            : {}),
        },
      },
    };

    const result = await this.elasticDatabaseService.select<IChat>(
      EElasticIndex.chat,
      queryElastic
    );

    const hit = result?.hits?.hits?.[0] as ElasticHit<IChat> | undefined;
    const chat = hit?._source ?? null;

    if (chat && Array.isArray(chat.summary)) {
      chat.summary = chat.summary[0] as IChat['summary'];
    }

    return chat;
  };

  updateChatSector = async (
    chatId: string,
    sector: IChat['sector']
  ): Promise<boolean> => {
    return this.elasticDatabaseService.update(
      EElasticIndex.chat,
      { sector },
      chatId
    );
  };

  updateChatWorker = async (
    chatId: string,
    worker: IChat['worker']
  ): Promise<boolean> => {
    return this.elasticDatabaseService.update(
      EElasticIndex.chat,
      { worker },
      chatId
    );
  };

  findChatsByContactId = async (
    accountId: string,
    contactId: string
  ): Promise<IChat[]> => {
    const queryElastic = {
      size: 1000,
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
            {
              nested: {
                path: 'contact',
                query: {
                  term: {
                    'contact.id': contactId,
                  },
                },
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

    const chats =
      result?.hits?.hits?.map((hit) => {
        const chat = (hit as ElasticHit<IChat>)._source;
        if (chat && Array.isArray(chat.summary)) {
          chat.summary = chat.summary[0] as IChat['summary'];
        }
        return chat;
      }) ?? [];

    return chats.filter((chat): chat is IChat => chat !== undefined);
  };

  findMessageByMessageId = async (
    accountId: string,
    messageId: string
  ): Promise<IChatMessage | null> => {
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
            {
              term: {
                message_id: messageId,
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

    const hit = result?.hits?.hits?.[0] as ElasticHit<IChatMessage> | undefined;
    return hit?._source ?? null;
  };

  updateMessageContent = async (
    messageId: string,
    content: IChatMessage['content']
  ): Promise<boolean> => {
    return this.elasticDatabaseService.update(
      EElasticIndex.message,
      { content },
      messageId
    );
  };

  viewWorkerConfigForChat = async (
    workerId: string
  ): Promise<ViewWorkerConfigForChatResponse> => {
    return this.workerConfigForChatViewerRepository.viewWorkerConfigForChatByWorkerId(
      workerId
    );
  };
}
