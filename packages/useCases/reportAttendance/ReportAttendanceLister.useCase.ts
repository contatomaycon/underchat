import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { ListReportAttendanceRequest } from '@core/schema/reportAttendance/listReportAttendance/request.schema';
import {
  ListReportAttendanceFinalResponse,
  ReportAttendanceResult,
} from '@core/schema/reportAttendance/listReportAttendance/response.schema';
import { IElasticsearchBoolClause } from '@core/common/interfaces/IElasticsearchQuery';
import { EChatStatus } from '@core/common/enums/EChatStatus';

type PeriodType = 'month' | 'week' | 'day' | 'hour';
type ReportType = 'queue' | 'analyst' | 'general';

@injectable()
export class ReportAttendanceListerUseCase {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  private formatSecondsToTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  private formatPeriod(date: Date, period: PeriodType): string {
    const formatters: Record<PeriodType, (d: Date) => string> = {
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
        query: {
          term: {
            [field]: value,
          },
        },
      },
    };
  }

  private buildQuery(
    accountId: string,
    query: ListReportAttendanceRequest
  ): any {
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
      {
        bool: {
          should: [
            { term: { status: EChatStatus.in_chat } },
            { term: { status: EChatStatus.closed } },
          ],
        },
      } as unknown as IElasticsearchBoolClause,
    ];

    const filterClauses: IElasticsearchBoolClause[] = [];

    const dateFilter = this.buildDateRangeFilter(
      query.start_date,
      query.end_date
    );
    if (dateFilter) filterClauses.push(dateFilter);

    if (query.queue_id) {
      filterClauses.push(
        this.buildNestedFilter('sector', 'sector.id', query.queue_id)
      );
    }

    if (query.analyst_id) {
      filterClauses.push(
        this.buildNestedFilter('user', 'user.id', query.analyst_id)
      );
    }

    return {
      bool: {
        must: mustClauses,
        ...(filterClauses.length > 0 && { filter: filterClauses }),
      },
    };
  }

  async execute(
    accountId: string,
    query: ListReportAttendanceRequest
  ): Promise<ListReportAttendanceFinalResponse> {
    const elasticQuery = this.buildQuery(accountId, query);

    const queryElastic = {
      query: elasticQuery,
      size: 10000,
      _source: [
        'started_at',
        'closed_at',
        'sector.name',
        'sector.id',
        'user.name',
        'user.id',
        'date',
      ],
    };

    const response = await this.elasticDatabaseService.select(
      EElasticIndex.chat,
      queryElastic
    );

    if (!response) {
      return { results: [] };
    }

    const hits = response.hits.hits || [];
    const chats = hits.map((hit: any) => hit._source);

    const results = this.calculateMetrics(chats, query);

    return { results };
  }

  private getDateToUse(chat: any): Date | null {
    const dateToUse = chat.started_at
      ? new Date(chat.started_at)
      : new Date(chat.date);
    return dateToUse && !Number.isNaN(dateToUse.getTime()) ? dateToUse : null;
  }

  private getCategoryKey(
    chat: any,
    reportType: ReportType,
    period: string
  ): string {
    const categoryMap: Record<ReportType, string | null> = {
      queue: chat.sector?.name || 'Sem Setor',
      analyst: chat.user?.name || 'Sem Analista',
      general: null,
    };

    const category = categoryMap[reportType];
    return category ? `${period}|${category}` : period;
  }

  private groupChatsByPeriod(
    chats: any[],
    query: ListReportAttendanceRequest
  ): Map<string, any[]> {
    const grouped = new Map<string, any[]>();

    for (const chat of chats) {
      const dateToUse = this.getDateToUse(chat);
      if (!dateToUse) continue;

      const period = this.formatPeriod(dateToUse, query.period);
      const key = this.getCategoryKey(chat, query.report_type, period);

      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      const groupChats = grouped.get(key);
      if (groupChats) {
        groupChats.push(chat);
      }
    }

    return grouped;
  }

  private calculateChatTime(
    startedAt: number | null,
    closedAt: number | null
  ): number {
    if (startedAt && closedAt) {
      return Math.floor((closedAt - startedAt) / 1000);
    }
    if (startedAt) {
      return Math.floor((Date.now() - startedAt) / 1000);
    }
    return 0;
  }

  private calculateWaitTime(
    date: number | null,
    startedAt: number | null
  ): number | null {
    if (!date || !startedAt) return null;
    const waitTime = Math.floor((startedAt - date) / 1000);
    return waitTime > 0 ? waitTime : null;
  }

  private calculateGroupMetrics(groupChats: any[]): {
    totalTime: number;
    averageWait: string;
    waitCount: number;
  } {
    let totalTime = 0;
    let totalWaitTime = 0;
    let waitCount = 0;

    for (const chat of groupChats) {
      const startedAt = chat.started_at
        ? new Date(chat.started_at).getTime()
        : null;
      const closedAt = chat.closed_at
        ? new Date(chat.closed_at).getTime()
        : null;
      const date = chat.date ? new Date(chat.date).getTime() : null;

      totalTime += this.calculateChatTime(startedAt, closedAt);

      const waitTime = this.calculateWaitTime(date, startedAt);
      if (waitTime !== null) {
        totalWaitTime += waitTime;
        waitCount++;
      }
    }

    const averageWait =
      waitCount > 0
        ? this.formatSecondsToTime(Math.floor(totalWaitTime / waitCount))
        : '00:00:00';

    return { totalTime, averageWait, waitCount };
  }

  private buildResult(
    period: string,
    category: string | null,
    total: number,
    totalTime: number,
    averageWait: string,
    reportType: ReportType
  ): ReportAttendanceResult {
    const result: ReportAttendanceResult = {
      period,
      total,
      totalTime: this.formatSecondsToTime(totalTime),
      averageWait,
    };

    const resultBuilders: Record<
      ReportType,
      (r: ReportAttendanceResult) => void
    > = {
      queue: (r) => {
        r.queue = category || null;
        r.categories = { [category || 'Sem Setor']: total };
      },
      analyst: (r) => {
        r.analyst = category || null;
      },
      general: (r) => {
        r.averageTime =
          total > 0
            ? this.formatSecondsToTime(Math.floor(totalTime / total))
            : '00:00:00';
      },
    };

    resultBuilders[reportType](result);
    return result;
  }

  private calculateMetrics(
    chats: any[],
    query: ListReportAttendanceRequest
  ): ReportAttendanceResult[] {
    const grouped = this.groupChatsByPeriod(chats, query);
    const results: ReportAttendanceResult[] = [];

    for (const [key, groupChats] of grouped) {
      const parts = key.split('|');
      const period = parts[0];
      const category = parts.length > 1 ? parts[1] : null;

      const { totalTime, averageWait } = this.calculateGroupMetrics(groupChats);
      const total = groupChats.length;

      const result = this.buildResult(
        period,
        category,
        total,
        totalTime,
        averageWait,
        query.report_type
      );

      results.push(result);
    }

    return results.sort((a, b) => a.period.localeCompare(b.period));
  }
}
