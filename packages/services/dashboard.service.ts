import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { DashboardStatsRepository } from '@core/repositories/dashboard/DashboardStats.repository';
import { DashboardConversationsRepository } from '@core/repositories/dashboard/DashboardConversations.repository';
import { DashboardContactsRepository } from '@core/repositories/dashboard/DashboardContacts.repository';
import { DashboardAttendanceRepository } from '@core/repositories/dashboard/DashboardAttendance.repository';
import { DashboardSectorsRepository } from '@core/repositories/dashboard/DashboardSectors.repository';
import { DashboardChatbotsRepository } from '@core/repositories/dashboard/DashboardChatbots.repository';
import { DashboardSchedulesRepository } from '@core/repositories/dashboard/DashboardSchedules.repository';
import { DashboardTemplatesRepository } from '@core/repositories/dashboard/DashboardTemplates.repository';
import { DashboardOfflineChannelsRepository } from '@core/repositories/dashboard/DashboardOfflineChannels.repository';
import { GetDashboardStatsResponse } from '@core/schema/dashboard/getDashboardStats/response.schema';
import { GetDashboardConversationsResponse } from '@core/schema/dashboard/getDashboardConversations/response.schema';
import { GetDashboardAdditionalResponse } from '@core/schema/dashboard/getDashboardAdditional/response.schema';
import { ListOfflineChannelsFinalResponse } from '@core/schema/dashboard/listOfflineChannels/response.schema';

@injectable()
export class DashboardService {
  constructor(
    @inject(DashboardStatsRepository)
    private readonly dashboardStatsRepository: DashboardStatsRepository,
    @inject(DashboardConversationsRepository)
    private readonly dashboardConversationsRepository: DashboardConversationsRepository,
    @inject(DashboardContactsRepository)
    private readonly dashboardContactsRepository: DashboardContactsRepository,
    @inject(DashboardAttendanceRepository)
    private readonly dashboardAttendanceRepository: DashboardAttendanceRepository,
    @inject(DashboardSectorsRepository)
    private readonly dashboardSectorsRepository: DashboardSectorsRepository,
    @inject(DashboardChatbotsRepository)
    private readonly dashboardChatbotsRepository: DashboardChatbotsRepository,
    @inject(DashboardSchedulesRepository)
    private readonly dashboardSchedulesRepository: DashboardSchedulesRepository,
    @inject(DashboardTemplatesRepository)
    private readonly dashboardTemplatesRepository: DashboardTemplatesRepository,
    @inject(DashboardOfflineChannelsRepository)
    private readonly dashboardOfflineChannelsRepository: DashboardOfflineChannelsRepository
  ) {}

  getDashboardStats = async (
    accountId: string
  ): Promise<GetDashboardStatsResponse> => {
    const [
      usersTotal,
      usersAllowed,
      usersSparkline,
      channelsTotal,
      channelsConnected,
      channelsAllowed,
      channelsSparkline,
      contactsTotal,
      contactsAllowed,
      contactsGrowth,
      contactsSparkline,
    ] = await Promise.all([
      this.dashboardStatsRepository.getUsersTotal(accountId),
      this.dashboardStatsRepository.getUsersAllowed(accountId),
      this.dashboardStatsRepository.getUsersSparklineData(accountId),
      this.dashboardStatsRepository.getChannelsTotal(accountId),
      this.dashboardStatsRepository.getChannelsConnected(accountId),
      this.dashboardStatsRepository.getChannelsAllowed(accountId),
      this.dashboardStatsRepository.getChannelsSparklineData(accountId),
      this.dashboardStatsRepository.getContactsTotal(accountId),
      this.dashboardStatsRepository.getContactsAllowed(accountId),
      this.dashboardStatsRepository.getContactsGrowth(accountId),
      this.dashboardStatsRepository.getContactsSparklineData(accountId),
    ]);

    return {
      users: {
        total: usersTotal,
        allowed: usersAllowed,
        sparkline_data: usersSparkline,
      },
      channels: {
        total: channelsTotal,
        connected: channelsConnected,
        allowed: channelsAllowed,
        sparkline_data: channelsSparkline,
      },
      contacts: {
        total: contactsTotal,
        allowed: contactsAllowed,
        growth: contactsGrowth,
        sparkline_data: contactsSparkline,
      },
    };
  };

  getDashboardConversations = async (
    accountId: string
  ): Promise<GetDashboardConversationsResponse> => {
    const [active, closed, evolution] = await Promise.all([
      this.dashboardConversationsRepository.getActiveChatsCount(accountId),
      this.dashboardConversationsRepository.getClosedChatsCount(accountId),
      this.dashboardConversationsRepository.getConversationsEvolution(
        accountId
      ),
    ]);

    const sparklineData = [10, 20, 15, 30, 25, 40, 35];

    return {
      active,
      closed,
      sparkline_data: sparklineData,
      evolution,
    };
  };

  getDashboardAdditional = async (
    accountId: string,
    t: TFunction<'translation', undefined>
  ): Promise<GetDashboardAdditionalResponse> => {
    const [
      contactsGrowth,
      attendancePerformance,
      sectorsDistribution,
      attendanceMetrics,
      chatbotsTotal,
      chatbotsActive,
      chatbotsAllowed,
      schedulesData,
      schedulesAllowed,
      templateTotals,
    ] = await Promise.all([
      this.dashboardContactsRepository.getContactsGrowthMonthly(accountId),
      this.dashboardAttendanceRepository.getAttendancePerformance(accountId),
      this.dashboardSectorsRepository.getSectorsDistribution(accountId),
      this.dashboardAttendanceRepository.getAttendanceMetrics(accountId),
      this.dashboardChatbotsRepository.getChatbotsTotal(accountId),
      this.dashboardChatbotsRepository.getChatbotsActive(accountId),
      this.dashboardChatbotsRepository.getChatbotsAllowed(accountId),
      this.dashboardSchedulesRepository.getSchedulesSentAndRenewalDate(
        accountId
      ),
      this.dashboardSchedulesRepository.getSchedulesAllowed(accountId),
      this.dashboardTemplatesRepository.getTemplateTotals(accountId),
    ]);
    const { contactGroupsTotal, messageTemplatesTotal, labelTemplatesTotal } =
      templateTotals;

    const schedulesRenewalDay = schedulesData.renewalDate
      ? this.formatRenewalDate(
          schedulesData.renewalDate.day,
          schedulesData.renewalDate.month,
          t
        )
      : null;

    return {
      contacts_growth: contactsGrowth,
      attendance_performance: attendancePerformance,
      sectors_distribution: sectorsDistribution.map((sector) => ({
        sector_id: sector.sectorId,
        sector_name: sector.sectorName,
        count: sector.count,
      })),
      attendance_metrics: {
        avg_response_time: attendanceMetrics.avgResponseTime,
        avg_resolution_time: attendanceMetrics.avgResolutionTime,
        total_attendances: attendanceMetrics.totalAttendances,
        productivity: attendanceMetrics.productivity,
      },
      chatbots: {
        total: chatbotsTotal,
        active: chatbotsActive,
        allowed: chatbotsAllowed,
      },
      schedules: {
        sent: schedulesData.sent,
        allowed: schedulesAllowed,
        renewal_day: schedulesRenewalDay,
      },
      contact_groups: contactGroupsTotal,
      message_templates: messageTemplatesTotal,
      label_templates: labelTemplatesTotal,
    };
  };

  getDashboardOfflineChannels = async (
    accountId: string
  ): Promise<ListOfflineChannelsFinalResponse> => {
    return this.dashboardOfflineChannelsRepository.listOfflineChannels(
      accountId
    );
  };

  private readonly formatRenewalDate = (
    day: number,
    month: number,
    t: TFunction<'translation', undefined>
  ): string => {
    const monthKeys = [
      'month_january',
      'month_february',
      'month_march',
      'month_april',
      'month_may',
      'month_june',
      'month_july',
      'month_august',
      'month_september',
      'month_october',
      'month_november',
      'month_december',
    ];

    const dayFormatted = String(day).padStart(2, '0');
    const monthName = t(monthKeys[month]);
    const of = t('of');

    return `${dayFormatted} ${of} ${monthName}`;
  };
}
