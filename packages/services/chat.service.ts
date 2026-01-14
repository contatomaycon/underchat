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
import { ChatQuickMessageTemplatesListerRepository } from '@core/repositories/chat/ChatQuickMessageTemplatesLister.repository';
import { ListQuickMessageTemplatesResponse } from '@core/schema/chat/listQuickMessageTemplates/response.schema';
import { ListQuickMessageTemplatesRequest } from '@core/schema/chat/listQuickMessageTemplates/request.schema';
import { IChatSummary } from '@core/common/interfaces/IChatSummaryUpdate';
import { buildMessageDocumentId } from '@core/common/functions/buildMessageDocumentId';

type ElasticHit<T> = {
  _source?: T;
};

@injectable()
export class ChatService {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly workerConfigForChatViewerRepository: WorkerConfigForChatViewerRepository,
    private readonly chatQuickMessageTemplatesListerRepository: ChatQuickMessageTemplatesListerRepository
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

  createMessageIdempotent = async (
    messageChat: IChatMessage,
    accountId: string,
    workerId: string,
    messageId: string
  ): Promise<{ created: boolean }> => {
    const mappings = mensageMappings();

    const indicesResult = await this.elasticDatabaseService.indices(
      EElasticIndex.message,
      mappings
    );

    if (!indicesResult || !messageChat) {
      return { created: false };
    }

    const documentId = buildMessageDocumentId(accountId, workerId, messageId);
    const createResult = await this.elasticDatabaseService.createDocument(
      EElasticIndex.message,
      documentId,
      messageChat
    );

    return { created: createResult === 'created' };
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

  updateChatLabel = async (
    chatId: string,
    label?: IChat['label'] | null
  ): Promise<boolean> => {
    const updateData: {
      label?: IChat['label'] | null;
    } = {};

    if (label !== undefined) {
      updateData.label = label;
    }

    return this.elasticDatabaseService.update(
      EElasticIndex.chat,
      updateData,
      chatId
    );
  };

  updateChatProtocol = async (
    chatId: string,
    protocolType: 'protocol_ura' | 'protocol_start' | 'protocol_transfer',
    protocol: string
  ): Promise<boolean> => {
    return this.elasticDatabaseService.updateArrayField(
      EElasticIndex.chat,
      chatId,
      protocolType,
      protocol
    );
  };

  countInChatChatsByUserId = async (
    accountId: string,
    workerId: string,
    userId: string
  ): Promise<number> => {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const startOfTodayIso = startOfToday.toISOString();

    const queryElastic = {
      size: 0,
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
                path: 'worker',
                query: {
                  term: {
                    'worker.id': workerId,
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
            {
              term: {
                status: EChatStatus.in_chat,
              },
            },
            {
              range: {
                started_at: {
                  gte: startOfTodayIso,
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

    const total = result?.hits?.total;
    if (typeof total === 'number') {
      return total;
    }

    return total?.value ?? 0;
  };

  countQueueChatsByUserId = async (
    accountId: string,
    workerId: string,
    userId: string
  ): Promise<number> => {
    const queryElastic = {
      size: 0,
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
                path: 'worker',
                query: {
                  term: {
                    'worker.id': workerId,
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
            {
              term: {
                status: EChatStatus.queue,
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

    const total = result?.hits?.total;
    if (typeof total === 'number') {
      return total;
    }

    return total?.value ?? 0;
  };

  countTotalChatsByUserId = async (
    accountId: string,
    workerId: string,
    userId: string
  ): Promise<{ inChat: number; queue: number; total: number }> => {
    const [inChat, queue] = await Promise.all([
      this.countInChatChatsByUserId(accountId, workerId, userId),
      this.countQueueChatsByUserId(accountId, workerId, userId),
    ]);

    return {
      inChat,
      queue,
      total: inChat + queue,
    };
  };

  countOpenChatsByWorkerId = async (
    accountId: string,
    workerId: string
  ): Promise<number> => {
    const queryElastic = {
      size: 0,
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
                path: 'worker',
                query: {
                  term: {
                    'worker.id': workerId,
                  },
                },
              },
            },
          ],
          must_not: [
            {
              term: {
                status: EChatStatus.closed,
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

    const total = result?.hits?.total;
    if (typeof total === 'number') {
      return total;
    }

    return total?.value ?? 0;
  };

  updateChatSummary = async (
    chatId: string,
    summary: IChat['summary']
  ): Promise<boolean> => {
    try {
      const summaryToUpdate = Array.isArray(summary) ? summary[0] : summary;

      if (!summaryToUpdate) {
        return false;
      }

      const scriptSource = this.buildUpdateChatSummaryScript();
      const scriptParams =
        this.buildUpdateChatSummaryScriptParams(summaryToUpdate);
      const upsert = this.buildUpdateChatSummaryUpsert(summaryToUpdate);

      const result = await this.elasticDatabaseService.updateWithScript(
        EElasticIndex.chat,
        chatId,
        {
          source: scriptSource,
          params: scriptParams,
        },
        {
          retry_on_conflict: 10,
          upsert,
        }
      );

      return result === 'updated' || result === 'created' || result === 'noop';
    } catch (error) {
      console.error('Error updating chat summary:', error);
      return false;
    }
  };

  private buildUpdateChatSummaryScript(): string {
    return `
      if (ctx._source.summary == null) {
        ctx._source.summary = params.baseline;
        return;
      }
      
      def summary = ctx._source.summary;
      
      if (params.last_message != null || params.last_date != null) {
        def currentLastDate = summary.last_date;
        def newLastDate = params.last_date;
        
        def shouldUpdateMessage = false;
        
        if (currentLastDate == null || newLastDate == null) {
          shouldUpdateMessage = newLastDate != null;
        } else {
          if (currentLastDate instanceof String && newLastDate instanceof String) {
            shouldUpdateMessage = newLastDate.compareTo(currentLastDate) > 0;
          }
        }
        
        if (shouldUpdateMessage) {
          summary.last_message = params.last_message;
          summary.last_date = newLastDate;
        }
      }
      
      if (params.unread_count_absolute != null) {
        def newUnreadCount = params.unread_count_absolute;
        if (newUnreadCount < 0) {
          newUnreadCount = 0;
        }
        summary.unread_count = newUnreadCount;
      } else if (params.unread_count_delta != null) {
        def currentUnreadCount = summary.unread_count != null ? summary.unread_count : 0;
        def newUnreadCount = currentUnreadCount + params.unread_count_delta;
        if (newUnreadCount < 0) {
          newUnreadCount = 0;
        }
        summary.unread_count = newUnreadCount;
      }
    `;
  }

  private buildUpdateChatSummaryScriptParams(
    summary: IChatSummary
  ): Record<string, unknown> {
    const baseline: IChatSummary = {
      last_message: summary.last_message,
      last_date: summary.last_date,
      unread_count: summary.unread_count,
    };

    return {
      baseline,
      last_message: summary.last_message,
      last_date: summary.last_date,
      unread_count_absolute: summary.unread_count,
    };
  }

  private buildUpdateChatSummaryUpsert(
    summary: IChatSummary
  ): Record<string, unknown> {
    return {
      summary: {
        last_message: summary.last_message,
        last_date: summary.last_date,
        unread_count: summary.unread_count,
      },
    };
  }

  updateChatSummaryAtomically = async (
    chatId: string,
    lastMessage: string | null,
    lastDate: string,
    incrementUnreadCount: boolean
  ): Promise<boolean> => {
    try {
      const scriptSource = this.buildChatSummaryAtomicUpdateScript();
      const baseline = this.createChatSummaryBaseline(lastMessage, lastDate);
      const scriptParams = this.buildChatSummaryAtomicScriptParams(
        baseline,
        lastMessage,
        lastDate,
        incrementUnreadCount
      );
      const upsert = this.buildChatSummaryAtomicUpsert(
        lastMessage,
        lastDate,
        incrementUnreadCount
      );
      const result = await this.elasticDatabaseService.updateWithScript(
        EElasticIndex.chat,
        chatId,
        {
          source: scriptSource,
          params: scriptParams,
        },
        {
          retry_on_conflict: 10,
          upsert,
        }
      );

      return result === 'updated' || result === 'created' || result === 'noop';
    } catch (error) {
      console.error('Error updating chat summary atomically:', error);
      return false;
    }
  };

  private buildChatSummaryAtomicUpdateScript(): string {
    return `
      if (ctx._source.summary == null) {
        ctx._source.summary = params.baseline;
        return;
      }
      
      def summary = ctx._source.summary;
      
      def currentLastDate = summary.last_date;
      def newLastDate = params.last_date;
      
      def shouldUpdateMessage = false;
      
      if (currentLastDate == null || newLastDate == null) {
        shouldUpdateMessage = newLastDate != null;
      } else {
        if (currentLastDate instanceof String && newLastDate instanceof String) {
          shouldUpdateMessage = newLastDate.compareTo(currentLastDate) > 0;
        }
      }
      
      if (shouldUpdateMessage) {
        summary.last_message = params.last_message;
        summary.last_date = newLastDate;
      }
      
      if (params.increment_unread_count) {
        def currentUnreadCount = summary.unread_count != null ? summary.unread_count : 0;
        summary.unread_count = currentUnreadCount + 1;
      } else {
        if (summary.unread_count == null) {
          summary.unread_count = 0;
        }
      }
    `;
  }

  private createChatSummaryBaseline(
    lastMessage: string | null,
    lastDate: string
  ): IChatSummary {
    return {
      last_message: lastMessage,
      last_date: lastDate,
      unread_count: 0,
    };
  }

  private buildChatSummaryAtomicScriptParams(
    baseline: IChatSummary,
    lastMessage: string | null,
    lastDate: string,
    incrementUnreadCount: boolean
  ): Record<string, unknown> {
    return {
      baseline,
      last_message: lastMessage,
      last_date: lastDate,
      increment_unread_count: incrementUnreadCount,
    };
  }

  private buildChatSummaryAtomicUpsert(
    lastMessage: string | null,
    lastDate: string,
    incrementUnreadCount: boolean
  ): Record<string, unknown> {
    return {
      summary: {
        last_message: lastMessage,
        last_date: lastDate,
        unread_count: incrementUnreadCount ? 1 : 0,
      },
    };
  }

  private async executeChatSummaryScriptUpdate(
    chatId: string,
    scriptSource: string,
    scriptParams: Record<string, any>
  ): Promise<boolean> {
    try {
      const client = (this.elasticDatabaseService as any).client;
      const result = await client.update({
        index: EElasticIndex.chat,
        id: chatId,
        script: {
          source: scriptSource,
          params: scriptParams,
        },
        retry_on_conflict: 10,
      });

      return this.isUpdateResultSuccessful(result);
    } catch {
      return false;
    }
  }

  private isUpdateResultSuccessful(result: any): boolean {
    return (
      result.result === 'updated' ||
      result.result === 'created' ||
      result.result === 'noop'
    );
  }

  private async fallbackChatSummaryUpdate(
    chatId: string,
    lastMessage: string | null,
    lastDate: string,
    incrementUnreadCount: boolean
  ): Promise<boolean> {
    const summaryToUpdate: IChat['summary'] = {
      last_message: lastMessage,
      last_date: lastDate,
      unread_count: incrementUnreadCount ? 1 : 0,
    };

    try {
      return await this.elasticDatabaseService.update(
        EElasticIndex.chat,
        { summary: summaryToUpdate },
        chatId,
        10
      );
    } catch {
      return false;
    }
  }

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

  findQueueChatsByWorkerId = async (
    accountId: string,
    workerId: string,
    userId?: string,
    excludeChatId?: string
  ): Promise<IChat[]> => {
    const filterClauses: any[] = [
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
          path: 'worker',
          query: {
            term: {
              'worker.id': workerId,
            },
          },
        },
      },
      {
        term: {
          status: EChatStatus.queue,
        },
      },
    ];

    if (excludeChatId) {
      filterClauses.push({
        bool: {
          must_not: {
            term: {
              chat_id: excludeChatId,
            },
          },
        },
      });
    }

    const queryElastic: any = {
      size: 100,
      _source: true,
      query: {
        bool: {
          filter: filterClauses,
        },
      },
      sort: [
        {
          date: {
            order: 'asc',
          },
        },
      ],
    };

    const result = await this.elasticDatabaseService.select<IChat>(
      EElasticIndex.chat,
      queryElastic
    );

    if (!result) {
      return [];
    }

    const hits = result?.hits?.hits ?? [];

    const chats = hits
      .map((hit: ElasticHit<IChat>) => {
        const chat = hit._source;
        if (chat && Array.isArray(chat.summary)) {
          chat.summary = chat.summary[0] as IChat['summary'];
        }
        return chat;
      })
      .filter((chat): chat is IChat => chat !== undefined);

    if (userId && chats.length > 0) {
      const userChats = chats.filter((chat) => chat.user?.id === userId);
      const otherChats = chats.filter((chat) => chat.user?.id !== userId);

      return [...userChats, ...otherChats];
    }

    return chats;
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

  listQuickMessageTemplates = async (
    query: ListQuickMessageTemplatesRequest,
    accountId: string
  ): Promise<ListQuickMessageTemplatesResponse[]> => {
    return this.chatQuickMessageTemplatesListerRepository.listQuickMessageTemplates(
      query,
      accountId
    );
  };
}
