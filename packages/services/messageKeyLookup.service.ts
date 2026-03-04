import { inject, singleton } from 'tsyringe';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';

@singleton()
export class MessageKeyLookupService {
  constructor(
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  public async getMessageKeyByMessageId(
    accountId: string,
    messageId: string
  ): Promise<IChatMessage['message_key'] | null> {
    const normalizedAccountId = accountId?.trim();
    const normalizedMessageId = messageId?.trim();

    if (!normalizedAccountId || !normalizedMessageId) {
      return null;
    }

    const queryElastic = {
      size: 1,
      query: {
        bool: {
          filter: [
            {
              nested: {
                path: 'account',
                query: {
                  term: { 'account.id': normalizedAccountId },
                },
              },
            },
            { term: { message_id: normalizedMessageId } },
          ],
        },
      },
      sort: [{ date: { order: 'desc' } }],
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.message,
      queryElastic
    );

    const message = result?.hits.hits[0]?._source as IChatMessage | null;
    return message?.message_key ?? null;
  }
}
