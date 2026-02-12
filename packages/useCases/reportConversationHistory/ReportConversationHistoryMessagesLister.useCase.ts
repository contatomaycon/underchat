import { injectable, inject } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { ListMessageResult } from '@core/schema/chat/listMessageChats/response.schema';
import { ListReportConversationHistoryMessagesResponse } from '@core/schema/reportConversationHistory/listReportConversationHistoryMessages/response.schema';

@injectable()
export class ReportConversationHistoryMessagesListerUseCase {
  constructor(
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  async execute(
    accountId: string,
    chatId: string
  ): Promise<ListReportConversationHistoryMessagesResponse> {
    const baseQuery = {
      sort: [{ date: { order: 'asc' } }],
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

    const countQuery = {
      ...baseQuery,
      size: 0,
    };

    const countResult = await this.elasticDatabaseService.select(
      EElasticIndex.message,
      countQuery
    );

    if (!countResult) {
      return {
        messages: [],
      };
    }

    const total = (countResult.hits.total as { value: number })?.value ?? 0;

    if (total === 0) {
      return {
        messages: [],
      };
    }

    const size = 1000;
    const totalPages = Math.ceil(total / size);
    const maxConcurrency = 5;
    const allMessages: ListMessageResult[] = [];

    for (let page = 0; page < totalPages; page += maxConcurrency) {
      const pagePromises: Promise<ListMessageResult[]>[] = [];

      for (let i = page; i < Math.min(page + maxConcurrency, totalPages); i++) {
        const queryElastic = {
          ...baseQuery,
          from: i * size,
          size,
        };

        const promise = this.elasticDatabaseService
          .select(EElasticIndex.message, queryElastic)
          .then((result) => {
            if (!result) {
              return [];
            }
            return result.hits.hits.map(
              (hit) => hit._source
            ) as ListMessageResult[];
          });

        pagePromises.push(promise);
      }

      const pageResults = await Promise.all(pagePromises);

      for (const messages of pageResults) {
        allMessages.push(...messages);
      }
    }

    allMessages.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateA - dateB;
    });

    return {
      messages: allMessages,
    };
  }
}
