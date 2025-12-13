import { injectable } from 'tsyringe';
import { DashboardStatsRepository } from '@core/repositories/dashboard/DashboardStats.repository';
import { DashboardConversationsRepository } from '@core/repositories/dashboard/DashboardConversations.repository';
import { DashboardAdditionalRepository } from '@core/repositories/dashboard/DashboardAdditional.repository';
import { GetDashboardStatsResponse } from '@core/schema/dashboard/getDashboardStats/response.schema';
import { GetDashboardConversationsResponse } from '@core/schema/dashboard/getDashboardConversations/response.schema';
import { GetDashboardAdditionalResponse } from '@core/schema/dashboard/getDashboardAdditional/response.schema';

@injectable()
export class DashboardService {
  constructor(
    private readonly dashboardStatsRepository: DashboardStatsRepository,
    private readonly dashboardConversationsRepository: DashboardConversationsRepository,
    private readonly dashboardAdditionalRepository: DashboardAdditionalRepository
  ) {}

  getDashboardStats = async (
    accountId: string
  ): Promise<GetDashboardStatsResponse> => {
    const [
      usersTotal,
      usersSparkline,
      channelsTotal,
      channelsConnected,
      channelsAllowed,
      channelsSparkline,
      contactsTotal,
      contactsGrowth,
      contactsSparkline,
    ] = await Promise.all([
      this.dashboardStatsRepository.getUsersTotal(accountId),
      this.dashboardStatsRepository.getUsersSparklineData(accountId),
      this.dashboardStatsRepository.getChannelsTotal(accountId),
      this.dashboardStatsRepository.getChannelsConnected(accountId),
      this.dashboardStatsRepository.getChannelsAllowed(accountId),
      this.dashboardStatsRepository.getChannelsSparklineData(accountId),
      this.dashboardStatsRepository.getContactsTotal(accountId),
      this.dashboardStatsRepository.getContactsGrowth(accountId),
      this.dashboardStatsRepository.getContactsSparklineData(accountId),
    ]);

    return {
      users: {
        total: usersTotal,
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
    accountId: string
  ): Promise<GetDashboardAdditionalResponse> => {
    const [
      contactsGrowth,
      attendancePerformance,
      sectorsDistribution,
      attendanceMetrics,
      chatbotsTotal,
      chatbotsActive,
      contactGroupsTotal,
      messageTemplatesTotal,
      labelTemplatesTotal,
    ] = await Promise.all([
      this.dashboardAdditionalRepository.getContactsGrowthMonthly(accountId),
      this.dashboardAdditionalRepository.getAttendancePerformance(accountId),
      this.dashboardAdditionalRepository.getSectorsDistribution(accountId),
      this.dashboardAdditionalRepository.getAttendanceMetrics(accountId),
      this.dashboardAdditionalRepository.getChatbotsTotal(accountId),
      this.dashboardAdditionalRepository.getChatbotsActive(accountId),
      this.dashboardAdditionalRepository.getContactGroupsTotal(accountId),
      this.dashboardAdditionalRepository.getMessageTemplatesTotal(accountId),
      this.dashboardAdditionalRepository.getLabelTemplatesTotal(accountId),
    ]);

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
      },
      contact_groups: contactGroupsTotal,
      message_templates: messageTemplatesTotal,
      label_templates: labelTemplatesTotal,
    };
  };
}
