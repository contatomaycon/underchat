import { injectable } from 'tsyringe';
import { DashboardStatsRepository } from '@core/repositories/dashboard/DashboardStats.repository';
import { DashboardConversationsRepository } from '@core/repositories/dashboard/DashboardConversations.repository';
import { GetDashboardStatsResponse } from '@core/schema/dashboard/getDashboardStats/response.schema';
import { GetDashboardConversationsResponse } from '@core/schema/dashboard/getDashboardConversations/response.schema';

@injectable()
export class DashboardService {
  constructor(
    private readonly dashboardStatsRepository: DashboardStatsRepository,
    private readonly dashboardConversationsRepository: DashboardConversationsRepository
  ) {}

  getDashboardStats = async (
    accountId: string
  ): Promise<GetDashboardStatsResponse> => {
    const [
      usersTotal,
      usersSparkline,
      channelsTotal,
      channelsConnected,
      channelsSparkline,
      contactsTotal,
      contactsGrowth,
      contactsSparkline,
    ] = await Promise.all([
      this.dashboardStatsRepository.getUsersTotal(accountId),
      this.dashboardStatsRepository.getUsersSparklineData(accountId),
      this.dashboardStatsRepository.getChannelsTotal(accountId),
      this.dashboardStatsRepository.getChannelsConnected(accountId),
      this.dashboardStatsRepository.getChannelsSparklineData(accountId),
      this.dashboardStatsRepository.getContactsTotal(accountId),
      this.dashboardStatsRepository.getContactsGrowth(accountId),
      this.dashboardStatsRepository.getContactsSparklineData(accountId),
    ]);

    return {
      users: {
        total: usersTotal,
        sparklineData: usersSparkline,
      },
      channels: {
        total: channelsTotal,
        connected: channelsConnected,
        sparklineData: channelsSparkline,
      },
      contacts: {
        total: contactsTotal,
        growth: contactsGrowth,
        sparklineData: contactsSparkline,
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

    return {
      active,
      closed,
      evolution,
    };
  };
}
