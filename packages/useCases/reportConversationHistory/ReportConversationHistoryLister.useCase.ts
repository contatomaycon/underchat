import { injectable, inject } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { ListReportConversationHistoryRequest } from '@core/schema/reportConversationHistory/listReportConversationHistory/request.schema';
import {
  ListReportConversationHistoryFinalResponse,
  ReportConversationHistoryResult,
} from '@core/schema/reportConversationHistory/listReportConversationHistory/response.schema';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { IElasticsearchBoolClause } from '@core/common/interfaces/IElasticsearchQuery';
import { IChat } from '@core/common/interfaces/IChat';
import { ReportConversationHistoryPdfViewerRepository } from '@core/repositories/reportConversationHistory/ReportConversationHistoryPdfViewer.repository';

type ProtocolWithType = {
  protocol: string;
  type: 'A' | 'U' | 'T';
};

@injectable()
export class ReportConversationHistoryListerUseCase {
  constructor(
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(ReportConversationHistoryPdfViewerRepository)
    private readonly pdfViewerRepository: ReportConversationHistoryPdfViewerRepository
  ) {}

  private buildQuery(
    accountId: string,
    query: ListReportConversationHistoryRequest
  ): any {
    const currentPage = query.current_page ?? 1;
    const perPage = query.per_page ?? 10;
    const sortBy = query.sort_by ?? [{ key: 'date', order: 'desc' }];

    const mustClauses: IElasticsearchBoolClause[] = [
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
    ];

    const filterClauses: IElasticsearchBoolClause[] = [];

    if (query.start_date || query.end_date) {
      const dateRange: any = {};
      if (query.start_date) {
        dateRange.gte = query.start_date;
      }
      if (query.end_date) {
        dateRange.lt = query.end_date;
      }
      filterClauses.push({
        range: {
          date: dateRange,
        },
      } as unknown as IElasticsearchBoolClause);
    }

    if (query.operator_id) {
      filterClauses.push({
        nested: {
          path: 'user',
          query: {
            term: {
              'user.id': query.operator_id,
            },
          },
        },
      });
    }

    if (query.queue_id) {
      filterClauses.push({
        nested: {
          path: 'sector',
          query: {
            term: {
              'sector.id': query.queue_id,
            },
          },
        },
      });
    }

    if (query.label_template_id) {
      filterClauses.push({
        nested: {
          path: 'label',
          query: {
            term: {
              'label.label_template_id': query.label_template_id,
            },
          },
        },
      });
    }

    if (query.protocol) {
      filterClauses.push({
        bool: {
          should: [
            {
              terms: {
                protocol_start: [query.protocol],
              },
            },
            {
              terms: {
                protocol_ura: [query.protocol],
              },
            },
            {
              terms: {
                protocol_transfer: [query.protocol],
              },
            },
          ],
        },
      } as unknown as IElasticsearchBoolClause);
    }

    if (query.client_name) {
      const clientNameSearch = query.client_name.trim();

      if (clientNameSearch.length > 0) {
        const shouldClauses: IElasticsearchBoolClause[] = [
          {
            wildcard: {
              'name.keyword': {
                value: `*${clientNameSearch}*`,
                case_insensitive: true,
              },
            },
          } as unknown as IElasticsearchBoolClause,
          {
            nested: {
              path: 'contact',
              query: {
                wildcard: {
                  'contact.name.keyword': {
                    value: `*${clientNameSearch}*`,
                    case_insensitive: true,
                  },
                },
              },
            },
          } as unknown as IElasticsearchBoolClause,
        ];

        filterClauses.push({
          bool: {
            should: shouldClauses,
            minimum_should_match: 1,
          },
        } as unknown as IElasticsearchBoolClause);
      }
    }

    if (query.phone) {
      const phoneDigits = query.phone.replaceAll(/\D/g, '');

      if (phoneDigits.length >= 3) {
        const searchTerms: string[] = [phoneDigits];

        if (phoneDigits.length === 11 && phoneDigits[2] === '9') {
          const without9 = phoneDigits.slice(0, 2) + phoneDigits.slice(3);
          searchTerms.push(without9);
        }

        const shouldClauses: IElasticsearchBoolClause[] = [];

        for (const term of searchTerms) {
          shouldClauses.push(
            {
              wildcard: {
                phone: {
                  value: `*${term}*`,
                  case_insensitive: true,
                },
              },
            } as unknown as IElasticsearchBoolClause,
            {
              nested: {
                path: 'contact',
                query: {
                  wildcard: {
                    'contact.phone': {
                      value: `*${term}*`,
                      case_insensitive: true,
                    },
                  },
                },
              },
            } as unknown as IElasticsearchBoolClause
          );
        }

        filterClauses.push({
          bool: {
            should: shouldClauses,
            minimum_should_match: 1,
          },
        } as unknown as IElasticsearchBoolClause);
      }
    }

    const sortClauses = sortBy.map((sort) => {
      if (sort.key === 'date') {
        return {
          date: {
            order: sort.order,
          },
        };
      }
      if (sort.key === 'protocol') {
        return {
          'protocol_start.keyword': {
            order: sort.order,
            missing: '_last',
          },
        };
      }
      if (sort.key === 'client') {
        return {
          'name.keyword': {
            order: sort.order,
          },
        };
      }
      return {
        [sort.key]: {
          order: sort.order,
        },
      };
    });

    return {
      from: (currentPage - 1) * perPage,
      size: perPage,
      sort:
        sortClauses.length > 0 ? sortClauses : [{ date: { order: 'desc' } }],
      query: {
        bool: {
          must: mustClauses,
          filter: filterClauses,
        },
      },
    };
  }

  private normalizeNestedField<T>(field: T | T[]): T | undefined {
    return Array.isArray(field) ? field[0] : field;
  }

  private collectProtocols(chat: any): ProtocolWithType[] {
    const allProtocols: ProtocolWithType[] = [];

    if (Array.isArray(chat.protocol_start) && chat.protocol_start.length > 0) {
      for (const p of chat.protocol_start) {
        allProtocols.push({ protocol: p, type: 'A' });
      }
    }
    if (Array.isArray(chat.protocol_ura) && chat.protocol_ura.length > 0) {
      for (const p of chat.protocol_ura) {
        allProtocols.push({ protocol: p, type: 'U' });
      }
    }
    if (
      Array.isArray(chat.protocol_transfer) &&
      chat.protocol_transfer.length > 0
    ) {
      for (const p of chat.protocol_transfer) {
        allProtocols.push({ protocol: p, type: 'T' });
      }
    }

    return allProtocols;
  }

  private getUniqueProtocols(
    allProtocols: ProtocolWithType[]
  ): ProtocolWithType[] {
    const uniqueProtocolsMap = new Map<string, 'A' | 'U' | 'T'>();
    for (const item of allProtocols) {
      if (!uniqueProtocolsMap.has(item.protocol)) {
        uniqueProtocolsMap.set(item.protocol, item.type);
      }
    }

    return Array.from(uniqueProtocolsMap.entries()).map(([protocol, type]) => ({
      protocol,
      type,
    }));
  }

  private getFirstProtocol(chat: any): string | null {
    return (
      chat.protocol_start?.[0] ||
      chat.protocol_ura?.[0] ||
      chat.protocol_transfer?.[0] ||
      null
    );
  }

  private mapChatToResult(
    chat: any,
    pdfStatusMap: Map<string, string>
  ): ReportConversationHistoryResult {
    const user = this.normalizeNestedField(chat.user);
    const sector = this.normalizeNestedField(chat.sector);
    const worker = this.normalizeNestedField(chat.worker);
    const contact = this.normalizeNestedField(chat.contact);

    const allProtocols = this.collectProtocols(chat);
    const protocolsWithType = this.getUniqueProtocols(allProtocols);
    const uniqueProtocols = protocolsWithType.map((p) => p.protocol);
    const protocol = this.getFirstProtocol(chat);

    if (protocolsWithType.length === 0 && protocol) {
      protocolsWithType.push({ protocol, type: 'A' });
      uniqueProtocols.push(protocol);
    }

    const pdfStatus = pdfStatusMap.get(chat.chat_id) || null;

    return {
      date: chat.date,
      protocol,
      protocols: uniqueProtocols.length > 0 ? uniqueProtocols : [],
      protocolsWithType:
        protocolsWithType.length > 0 ? protocolsWithType : undefined,
      client: chat.name || contact?.name || '-',
      phone: chat.phone,
      cpf_cnpj: null,
      operator: user?.name || null,
      operator_id: user?.id || null,
      queue: sector?.name || null,
      channel: worker?.name || 'WhatsApp',
      chat_id: chat.chat_id,
      photo: chat.photo || contact?.photo || null,
      pdf_status: pdfStatus,
    };
  }

  async execute(
    accountId: string,
    query: ListReportConversationHistoryRequest
  ): Promise<ListReportConversationHistoryFinalResponse> {
    const currentPage = query.current_page ?? 1;
    const perPage = query.per_page ?? 10;

    const elasticQuery = this.buildQuery(accountId, query);

    const result = await this.elasticDatabaseService.select<IChat>(
      EElasticIndex.chat,
      elasticQuery
    );

    if (!result) {
      return {
        results: [],
        pagings: setPaginationData(0, 0, perPage, currentPage),
      };
    }

    const total = result.hits.total as { value: number; relation: string };
    const hits = result.hits.hits;

    const chatIds = hits.map((hit) => (hit._source as IChat).chat_id);
    const pdfStatusMap =
      await this.pdfViewerRepository.listPdfsByAccountAndChatIds(
        accountId,
        chatIds
      );

    const results: ReportConversationHistoryResult[] = hits.map((hit) =>
      this.mapChatToResult(hit._source as IChat, pdfStatusMap)
    );

    return {
      results,
      pagings: setPaginationData(
        results.length,
        total.value,
        perPage,
        currentPage
      ),
    };
  }
}
