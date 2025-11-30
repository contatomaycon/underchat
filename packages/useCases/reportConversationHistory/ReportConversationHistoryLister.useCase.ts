import { injectable } from 'tsyringe';
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

@injectable()
export class ReportConversationHistoryListerUseCase {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService
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

    // Filtro por data
    if (query.start_date || query.end_date) {
      const dateRange: any = {};
      if (query.start_date) {
        dateRange.gte = query.start_date;
      }
      if (query.end_date) {
        dateRange.lte = query.end_date;
      }
      filterClauses.push({
        range: {
          date: dateRange,
        },
      } as unknown as IElasticsearchBoolClause);
    }

    // Filtro por operador
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

    // Filtro por fila (sector)
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

    // Filtro por protocolo
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

    // Filtro por nome do cliente
    if (query.client_name) {
      filterClauses.push({
        match: {
          name: {
            query: query.client_name,
            operator: 'and',
          },
        },
      } as unknown as IElasticsearchBoolClause);
    }

    // Filtro por telefone
    if (query.phone) {
      filterClauses.push({
        term: {
          phone: query.phone.replace(/\D/g, ''),
        },
      } as IElasticsearchBoolClause);
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

  private mapChatToResult(chat: any): ReportConversationHistoryResult {
    // Tratamento para campos nested que podem vir como array ou objeto
    const user = Array.isArray(chat.user) ? chat.user[0] : chat.user;
    const sector = Array.isArray(chat.sector) ? chat.sector[0] : chat.sector;
    const worker = Array.isArray(chat.worker) ? chat.worker[0] : chat.worker;
    const contact = Array.isArray(chat.contact)
      ? chat.contact[0]
      : chat.contact;

    // Coleta todos os protocolos de todas as fontes com seus tipos
    const allProtocols: Array<{ protocol: string; type: 'A' | 'U' | 'T' }> = [];
    
    // Adiciona protocolos de cada tipo (se existirem)
    if (Array.isArray(chat.protocol_start) && chat.protocol_start.length > 0) {
      chat.protocol_start.forEach((p: string) => {
        allProtocols.push({ protocol: p, type: 'A' }); // A = Atendimento
      });
    }
    if (Array.isArray(chat.protocol_ura) && chat.protocol_ura.length > 0) {
      chat.protocol_ura.forEach((p: string) => {
        allProtocols.push({ protocol: p, type: 'U' }); // U = URA
      });
    }
    if (Array.isArray(chat.protocol_transfer) && chat.protocol_transfer.length > 0) {
      chat.protocol_transfer.forEach((p: string) => {
        allProtocols.push({ protocol: p, type: 'T' }); // T = Transferência
      });
    }

    // Remove duplicatas mantendo a ordem (mesmo protocolo pode aparecer em tipos diferentes)
    const uniqueProtocolsMap = new Map<string, 'A' | 'U' | 'T'>();
    allProtocols.forEach((item) => {
      if (!uniqueProtocolsMap.has(item.protocol)) {
        uniqueProtocolsMap.set(item.protocol, item.type);
      }
    });

    // Converte para array de objetos com tipo
    const protocolsWithType = Array.from(uniqueProtocolsMap.entries()).map(
      ([protocol, type]) => ({ protocol, type })
    );

    // Array simples de protocolos (para compatibilidade)
    const uniqueProtocols = protocolsWithType.map((p) => p.protocol);

    // Pega o primeiro protocolo disponível (protocol_start tem prioridade) para compatibilidade
    const protocol =
      chat.protocol_start?.[0] ||
      chat.protocol_ura?.[0] ||
      chat.protocol_transfer?.[0] ||
      null;

    // Se não há protocolos coletados mas há um protocol único, adiciona ao array
    if (protocolsWithType.length === 0 && protocol) {
      protocolsWithType.push({ protocol, type: 'A' });
      uniqueProtocols.push(protocol);
    }

    return {
      date: chat.date,
      protocol,
      protocols: uniqueProtocols.length > 0 ? uniqueProtocols : [],
      protocolsWithType: protocolsWithType.length > 0 ? protocolsWithType : undefined,
      client: chat.name || contact?.name || '-',
      phone: chat.phone,
      cpf_cnpj: null,
      operator: user?.name || null,
      operator_id: user?.id || null,
      queue: sector?.name || null,
      channel: worker?.name || 'WhatsApp',
      chat_id: chat.chat_id,
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

    const results: ReportConversationHistoryResult[] = hits.map((hit) =>
      this.mapChatToResult(hit._source as IChat)
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
