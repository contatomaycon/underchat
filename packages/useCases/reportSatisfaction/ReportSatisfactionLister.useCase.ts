import { injectable, inject } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { SectorService } from '@core/services/sector.service';
import { UserService } from '@core/services/user.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { ListReportSatisfactionRequest } from '@core/schema/reportSatisfaction/listReportSatisfaction/request.schema';
import {
  ListReportSatisfactionFinalResponse,
  ReportSatisfactionResult,
  ReportSatisfactionSummary,
} from '@core/schema/reportSatisfaction/listReportSatisfaction/response.schema';
import { IElasticsearchBoolClause } from '@core/common/interfaces/IElasticsearchQuery';
import type {
  ReportSatisfactionPeriodType,
  ReportSatisfactionReportType,
} from '@core/common/interfaces/IReportSatisfactionPdf';
import type {
  IReportSatisfactionChatHit,
  IReportSatisfactionTemplate,
} from '@core/common/interfaces/IReportSatisfactionLister';

const SEM_SETOR_ID = '__sem_setor__';
const SEM_ANALYST_ID = '__sem_analyst__';

@injectable()
export class ReportSatisfactionListerUseCase {
  constructor(
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(SectorService)
    private readonly sectorService: SectorService,
    @inject(UserService)
    private readonly userService: UserService
  ) {}

  private buildSatisfactionKey(
    question: string,
    options: { id: string; text: string }[]
  ): string {
    const normalizedQuestion = (question || '').trim();
    const optionsKey = (options || [])
      .slice()
      .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
      .map((o) => o.id || '')
      .join('|');
    return `${normalizedQuestion}::${optionsKey}`;
  }

  private formatPeriod(
    date: Date,
    period: ReportSatisfactionPeriodType
  ): string {
    const formatters: Record<
      ReportSatisfactionPeriodType,
      (d: Date) => string
    > = {
      month: (d) =>
        `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`,
      week: (d) => {
        const weekInfo = this.getWeekNumber(d);
        return `Semana ${weekInfo.week}`;
      },
      day: (d) =>
        `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`,
      hour: (d) => `${String(d.getHours()).padStart(2, '0')}:00`,
    };
    return formatters[period](date);
  }

  private getWeekNumber(date: Date): { week: number; year: number } {
    const d = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    );
    const dayOfWeek = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
    const year = d.getUTCFullYear();
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4DayOfWeek = jan4.getUTCDay() || 7;
    jan4.setUTCDate(jan4.getUTCDate() + 4 - jan4DayOfWeek);
    const daysDiff = Math.floor((d.getTime() - jan4.getTime()) / 86400000);
    let weekNumber = Math.floor(daysDiff / 7) + 1;
    if (weekNumber < 1) {
      const lastDayOfPrevYear = new Date(Date.UTC(year - 1, 11, 31));
      return this.getWeekNumber(lastDayOfPrevYear);
    }
    if (weekNumber > 52) {
      const jan4NextYear = new Date(Date.UTC(year + 1, 0, 4));
      const jan4NextYearDayOfWeek = jan4NextYear.getUTCDay() || 7;
      jan4NextYear.setUTCDate(
        jan4NextYear.getUTCDate() + 4 - jan4NextYearDayOfWeek
      );
      if (d.getTime() >= jan4NextYear.getTime()) {
        return { week: 1, year: year + 1 };
      }
    }
    return { week: weekNumber, year };
  }

  private buildDateRangeFilter(
    startDate?: string | null,
    endDate?: string | null
  ): IElasticsearchBoolClause | null {
    if (!startDate && !endDate) return null;
    const dateRange: Record<string, string> = {};
    if (startDate) dateRange.gte = startDate;
    if (endDate) dateRange.lte = endDate;
    return {
      bool: {
        must: [
          {
            bool: {
              should: [
                { range: { date: dateRange } },
                { range: { started_at: dateRange } },
              ],
              minimum_should_match: 1,
            },
          },
        ],
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private buildNestedFilter(
    path: string,
    field: string,
    value: string
  ): IElasticsearchBoolClause {
    return {
      nested: {
        path,
        query: { term: { [field]: value } },
      },
    };
  }

  private buildAnalystFilter(analystId: string): IElasticsearchBoolClause {
    return {
      bool: {
        should: [
          {
            term: {
              'satisfaction_response.analyst.id': analystId,
            },
          } as unknown as IElasticsearchBoolClause,
          this.buildNestedFilter('user', 'user.id', analystId),
          this.buildNestedFilter('secondary_users', 'secondary_users.id', analystId),
          {
            nested: {
              path: 'contact',
              query: {
                nested: {
                  path: 'contact.responsible_attendant',
                  query: {
                    term: {
                      'contact.responsible_attendant.id': analystId,
                    },
                  },
                },
              },
            },
          },
        ],
        minimum_should_match: 1,
      },
    } as unknown as IElasticsearchBoolClause;
  }

  private resolveAnalyst(
    chat: NonNullable<IReportSatisfactionChatHit['_source']>
  ): { id: string; name: string | null } {
    const satisfactionAnalystId = chat.satisfaction_response?.analyst?.id?.trim();
    if (satisfactionAnalystId) {
      return {
        id: satisfactionAnalystId,
        name: chat.satisfaction_response?.analyst?.name?.trim() || null,
      };
    }

    const userId = chat.user?.id?.trim();
    if (userId) {
      return {
        id: userId,
        name: chat.user?.name?.trim() || null,
      };
    }

    const responsibleAttendantId =
      chat.contact?.responsible_attendant?.id?.trim();
    if (responsibleAttendantId) {
      return {
        id: responsibleAttendantId,
        name: chat.contact?.responsible_attendant?.name?.trim() || null,
      };
    }

    const latestSecondaryUser = (chat.secondary_users ?? [])
      .filter((secondaryUser) => !!secondaryUser?.id)
      .sort((a, b) => {
        const aTs = a.entered_at ? new Date(a.entered_at).getTime() : 0;
        const bTs = b.entered_at ? new Date(b.entered_at).getTime() : 0;
        return bTs - aTs;
      })[0];
    if (latestSecondaryUser?.id) {
      return {
        id: latestSecondaryUser.id,
        name: latestSecondaryUser.name?.trim() || null,
      };
    }

    return { id: SEM_ANALYST_ID, name: null };
  }

  private buildQuery(
    accountId: string,
    query: ListReportSatisfactionRequest
  ): object {
    const mustClauses: IElasticsearchBoolClause[] = [
      {
        nested: {
          path: 'account',
          query: { term: { 'account.id': accountId } },
        },
      },
      {
        exists: { field: 'satisfaction_response' },
      } as unknown as IElasticsearchBoolClause,
    ];

    const filterClauses: IElasticsearchBoolClause[] = [];
    const dateFilter = this.buildDateRangeFilter(
      query.start_date,
      query.end_date
    );
    if (dateFilter) filterClauses.push(dateFilter);
    if (query.sector_id) {
      filterClauses.push(
        this.buildNestedFilter('sector', 'sector.id', query.sector_id)
      );
    }
    if (query.analyst_id) {
      filterClauses.push(this.buildAnalystFilter(query.analyst_id));
    }

    return {
      bool: {
        must: mustClauses,
        ...(filterClauses.length > 0 && { filter: filterClauses }),
      },
    };
  }

  private getDateToUse(
    chat: IReportSatisfactionChatHit['_source']
  ): Date | null {
    const src = chat;
    if (!src) return null;
    const raw = src.started_at ?? src.date ?? null;
    if (!raw) return null;
    const dateToUse = new Date(raw);
    if (Number.isNaN(dateToUse.getTime())) return null;
    return dateToUse;
  }

  private buildGroupKey(
    period: string,
    satisfactionKey: string,
    reportType: ReportSatisfactionReportType,
    sectorId: string | null,
    analystId: string | null
  ): string {
    if (reportType === 'sector')
      return `${period}|${sectorId ?? ''}|${satisfactionKey}`;
    if (reportType === 'analyst')
      return `${period}|${analystId ?? ''}|${satisfactionKey}`;
    return `${period}|${satisfactionKey}`;
  }

  private buildUserName(
    firstName: string | null,
    lastName: string | null,
    userId: string
  ): string {
    const parts = [firstName, lastName].filter(Boolean) as string[];
    return parts.length > 0 ? parts.join(' ').trim() : userId;
  }

  private generatePeriods(
    startDate: string,
    endDate: string,
    period: ReportSatisfactionPeriodType
  ): string[] {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
    const seen = new Set<string>();
    if (period === 'month') {
      const y0 = start.getFullYear();
      const m0 = start.getMonth();
      const y1 = end.getFullYear();
      const m1 = end.getMonth();
      for (let y = y0; y <= y1; y++) {
        const mStart = y === y0 ? m0 : 0;
        const mEnd = y === y1 ? m1 : 11;
        for (let m = mStart; m <= mEnd; m++) {
          seen.add(this.formatPeriod(new Date(y, m, 1), period));
        }
      }
    }
    if (period === 'week' || period === 'day') {
      const step = 24 * 60 * 60 * 1000;
      for (let t = start.getTime(); t <= end.getTime(); t += step) {
        seen.add(this.formatPeriod(new Date(t), period));
      }
    }
    if (period === 'hour') {
      for (let t = start.getTime(); t <= end.getTime(); t += 60 * 60 * 1000) {
        seen.add(this.formatPeriod(new Date(t), period));
      }
    }
    return Array.from(seen).sort();
  }

  async execute(
    accountId: string,
    query: ListReportSatisfactionRequest
  ): Promise<ListReportSatisfactionFinalResponse> {
    const sectorIdToName = new Map<string, string>();
    const analystIdToName = new Map<string, string>();
    let allSectors: Array<{ sector_id: string; name: string }> = [];
    let allAnalysts: Array<{ user_id: string; name: string }> = [];

    if (query.report_type === 'sector') {
      allSectors = await this.sectorService.listAllSectorsForReport(accountId);
      for (const s of allSectors) sectorIdToName.set(s.sector_id, s.name);
    }
    if (query.report_type === 'analyst') {
      const allUsers = await this.userService.listAllUsers(accountId);
      for (const u of allUsers) {
        const name = this.buildUserName(u.first_name, u.last_name, u.user_id);
        analystIdToName.set(u.user_id, name);
        allAnalysts.push({ user_id: u.user_id, name });
      }
    }

    const elasticQuery = this.buildQuery(accountId, query);
    const queryElastic = {
      query: elasticQuery,
      size: 10000,
      _source: [
        'satisfaction_response',
        'satisfaction_response.analyst.id',
        'satisfaction_response.analyst.name',
        'sector.id',
        'sector.name',
        'user.id',
        'user.name',
        'secondary_users.id',
        'secondary_users.name',
        'secondary_users.entered_at',
        'contact.responsible_attendant.id',
        'contact.responsible_attendant.name',
        'date',
        'started_at',
      ],
    };

    const response = await this.elasticDatabaseService.select(
      EElasticIndex.chat,
      queryElastic
    );

    if (!response && query.report_type === 'general') {
      return {
        summary: { total_responses: 0, unique_satisfactions: 0 },
        results: [],
      };
    }

    const hits = (response?.hits?.hits ?? []) as IReportSatisfactionChatHit[];
    const chats = hits.map((h) => h._source).filter(Boolean) as NonNullable<
      IReportSatisfactionChatHit['_source']
    >[];

    const uniqueSatisfactionKeys = new Set<string>();
    type GroupKey = string;
    const countByGroup = new Map<
      GroupKey,
      {
        question: string;
        options: { id: string; text: string }[];
        optionCounts: Map<string, number>;
      }
    >();

    for (const chat of chats) {
      const sat = chat.satisfaction_response;
      if (!sat?.question || !Array.isArray(sat.options) || !sat.response)
        continue;

      const key = this.buildSatisfactionKey(sat.question, sat.options);
      uniqueSatisfactionKeys.add(key);

      const dateToUse = this.getDateToUse(chat);
      if (!dateToUse) continue;

      const period = this.formatPeriod(dateToUse, query.period);
      const sectorId = chat.sector?.id ?? SEM_SETOR_ID;
      const analyst = this.resolveAnalyst(chat);
      const analystId = analyst.id;
      if (query.report_type === 'sector') {
        if (sectorId === SEM_SETOR_ID)
          sectorIdToName.set(SEM_SETOR_ID, 'Sem Setor');
        else if (chat.sector?.name)
          sectorIdToName.set(sectorId, chat.sector.name);
      }
      if (query.report_type === 'analyst') {
        if (analystId === SEM_ANALYST_ID)
          analystIdToName.set(SEM_ANALYST_ID, 'Sem Atendente');
        else if (!analystIdToName.has(analystId) && analyst.name)
          analystIdToName.set(analystId, analyst.name);
      }

      const groupKey: GroupKey = this.buildGroupKey(
        period,
        key,
        query.report_type,
        sectorId,
        analystId
      );

      if (!countByGroup.has(groupKey)) {
        countByGroup.set(groupKey, {
          question: sat.question,
          options: sat.options.map((o) => ({ id: o.id, text: o.text || '' })),
          optionCounts: new Map<string, number>(),
        });
      }

      const group = countByGroup.get(groupKey);
      if (!group) continue;

      const resId = sat.response.id || sat.response.text || '';
      group.optionCounts.set(resId, (group.optionCounts.get(resId) || 0) + 1);
    }

    const results: ReportSatisfactionResult[] = [];

    for (const [groupKey, group] of countByGroup) {
      const parts = groupKey.split('|');
      const period = parts[0];
      const sectorId =
        query.report_type === 'sector' ? (parts[1] ?? null) : null;
      const analystId =
        query.report_type === 'analyst' ? (parts[1] ?? null) : null;
      const satisfactionKey =
        parts[query.report_type === 'general' ? 1 : 2] ?? '';

      const sectorName =
        query.report_type === 'sector' && sectorId
          ? (sectorIdToName.get(sectorId) ?? sectorId)
          : undefined;
      const analystName =
        query.report_type === 'analyst' && analystId
          ? (analystIdToName.get(analystId) ?? analystId)
          : undefined;

      const option_counts = group.options.map((opt) => ({
        option_id: opt.id,
        option_text: opt.text,
        count: group.optionCounts.get(opt.id) || 0,
      }));

      const total = option_counts.reduce((s, o) => s + o.count, 0);

      results.push({
        period,
        sector: sectorName ?? undefined,
        analyst: analystName ?? undefined,
        satisfaction_key: satisfactionKey,
        question: group.question,
        options: group.options,
        total,
        option_counts,
      });
    }

    const existingKeys = new Set<string>();
    for (const k of countByGroup.keys()) existingKeys.add(k);

    const templates: IReportSatisfactionTemplate[] = [];
    const periodSet = new Set<string>();
    for (const [gk, g] of countByGroup) {
      const p = gk.split('|');
      periodSet.add(p[0]);
      const sk = p[p.length === 2 ? 1 : 2] ?? '';
      if (!templates.some((t) => t.satisfaction_key === sk)) {
        templates.push({
          satisfaction_key: sk,
          question: g.question,
          options: g.options,
        });
      }
    }

    if (templates.length === 0) {
      templates.push({
        satisfaction_key: '',
        question: '',
        options: [],
      });
    }
    let periodsArr = Array.from(periodSet).sort();
    if (
      periodsArr.length === 0 &&
      (query.report_type === 'sector' || query.report_type === 'analyst')
    ) {
      periodsArr = this.generatePeriods(
        query.start_date,
        query.end_date,
        query.period
      );
    }

    const allEntities =
      query.report_type === 'sector'
        ? allSectors.map((s) => ({ id: s.sector_id, name: s.name }))
        : query.report_type === 'analyst'
          ? allAnalysts.map((a) => ({ id: a.user_id, name: a.name }))
          : [];

    for (const entity of allEntities) {
      if (entity.id === SEM_SETOR_ID || entity.id === SEM_ANALYST_ID) continue;
      for (const period of periodsArr) {
        for (const tpl of templates) {
          const gk = `${period}|${entity.id}|${tpl.satisfaction_key}`;
          if (existingKeys.has(gk)) continue;
          existingKeys.add(gk);
          const option_counts = tpl.options.map((o) => ({
            option_id: o.id,
            option_text: o.text,
            count: 0,
          }));
          results.push({
            period,
            sector: query.report_type === 'sector' ? entity.name : undefined,
            analyst: query.report_type === 'analyst' ? entity.name : undefined,
            satisfaction_key: tpl.satisfaction_key,
            question: tpl.question,
            options: tpl.options,
            total: 0,
            option_counts,
          });
        }
      }
    }

    const summary: ReportSatisfactionSummary = {
      total_responses: chats.filter(
        (c) =>
          c.satisfaction_response?.question && c.satisfaction_response?.response
      ).length,
      unique_satisfactions: uniqueSatisfactionKeys.size,
    };

    results.sort((a, b) => {
      const p = a.period.localeCompare(b.period);
      if (p !== 0) return p;
      if (a.sector && b.sector) return a.sector.localeCompare(b.sector);
      if (a.analyst && b.analyst) return a.analyst.localeCompare(b.analyst);
      return a.satisfaction_key.localeCompare(b.satisfaction_key);
    });

    return { summary, results };
  }
}
