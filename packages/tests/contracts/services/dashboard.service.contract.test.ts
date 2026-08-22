import 'reflect-metadata';

jest.mock('@core/repositories/dashboard/DashboardStats.repository', () => ({
  DashboardStatsRepository: class {},
}));

jest.mock(
  '@core/repositories/dashboard/DashboardConversations.repository',
  () => ({
    DashboardConversationsRepository: class {},
  })
);

jest.mock('@core/repositories/dashboard/DashboardContacts.repository', () => ({
  DashboardContactsRepository: class {},
}));

jest.mock(
  '@core/repositories/dashboard/DashboardAttendance.repository',
  () => ({
    DashboardAttendanceRepository: class {},
  })
);

jest.mock('@core/repositories/dashboard/DashboardSectors.repository', () => ({
  DashboardSectorsRepository: class {},
}));

jest.mock('@core/repositories/dashboard/DashboardChatbots.repository', () => ({
  DashboardChatbotsRepository: class {},
}));

jest.mock('@core/repositories/dashboard/DashboardSchedules.repository', () => ({
  DashboardSchedulesRepository: class {},
}));

jest.mock('@core/repositories/dashboard/DashboardTemplates.repository', () => ({
  DashboardTemplatesRepository: class {},
}));

jest.mock(
  '@core/repositories/dashboard/DashboardOfflineChannels.repository',
  () => ({
    DashboardOfflineChannelsRepository: class {},
  })
);

jest.mock(
  '@core/repositories/dashboard/DashboardChannelsStatus.repository',
  () => ({
    DashboardChannelsStatusRepository: class {},
  })
);

import { DashboardService } from '@core/services/dashboard.service';

describe('DashboardService', () => {
  const t = ((key: string) => {
    const map: Record<string, string> = {
      month_january: 'Janeiro',
      month_february: 'Fevereiro',
      of: 'de',
    };

    return map[key] ?? key;
  }) as never;

  const makeService = () => {
    const dashboardStatsRepository = {
      getUsersTotal: jest.fn(async () => 12),
      getUsersAllowed: jest.fn(async () => 20),
      getUsersSparklineData: jest.fn(async () => [1, 2, 3]),
      getChannelsTotal: jest.fn(async () => 8),
      getChannelsConnected: jest.fn(async () => 5),
      getChannelsAllowed: jest.fn(async () => 10),
      getChannelsSparklineData: jest.fn(async () => [4, 5, 6]),
      getContactsTotal: jest.fn(async () => 150),
      getContactsAllowed: jest.fn(async () => 500),
      getContactsGrowth: jest.fn(async () => 17),
      getContactsSparklineData: jest.fn(async () => [7, 8, 9]),
    };

    const dashboardConversationsRepository = {
      getActiveChatsCount: jest.fn(async () => 30),
      getClosedChatsCount: jest.fn(async () => 12),
      getConversationsEvolution: jest.fn(async () => [
        { date: '2026-01-01', count: 10 },
      ]),
    };

    const dashboardContactsRepository = {
      getContactsGrowthMonthly: jest.fn(async () => [
        {
          month: '2026-01',
          value: 10,
        },
      ]),
    };

    const dashboardAttendanceRepository = {
      getAttendancePerformance: jest.fn(async () => ({
        score: 90,
      })),
      getAttendanceMetrics: jest.fn(async () => ({
        avgResponseTime: 12,
        avgResolutionTime: 33,
        totalAttendances: 77,
        productivity: 88,
      })),
    };

    const dashboardSectorsRepository = {
      getSectorsDistribution: jest.fn(async () => [
        {
          sectorId: 'sec-1',
          sectorName: 'Support',
          count: 3,
        },
      ]),
    };

    const dashboardChatbotsRepository = {
      getChatbotsTotal: jest.fn(async () => 11),
      getChatbotsActive: jest.fn(async () => 8),
      getChatbotsAllowed: jest.fn(async () => 20),
    };

    const dashboardSchedulesRepository = {
      getSchedulesSentAndRenewalDate: jest.fn<
        Promise<{
          sent: number;
          renewalDate: { day: number; month: number } | null;
        }>,
        any[]
      >(async () => ({
        sent: 40,
        renewalDate: {
          day: 7,
          month: 0,
        },
      })),
      getSchedulesAllowed: jest.fn(async () => 100),
    };

    const dashboardTemplatesRepository = {
      getTemplateTotals: jest.fn(async () => ({
        contactGroupsTotal: 9,
        messageTemplatesTotal: 5,
        labelTemplatesTotal: 4,
      })),
    };

    const dashboardOfflineChannelsRepository = {
      listOfflineChannels: jest.fn(async () => [{ id: 'ch-1' }]),
    };

    const dashboardChannelsStatusRepository = {
      listChannelsStatus: jest.fn(async () => [
        { id: 'ch-1', status: 'connected' },
      ]),
    };

    const service = new DashboardService(
      dashboardStatsRepository as never,
      dashboardConversationsRepository as never,
      dashboardContactsRepository as never,
      dashboardAttendanceRepository as never,
      dashboardSectorsRepository as never,
      dashboardChatbotsRepository as never,
      dashboardSchedulesRepository as never,
      dashboardTemplatesRepository as never,
      dashboardOfflineChannelsRepository as never,
      dashboardChannelsStatusRepository as never
    );

    return {
      service,
      dashboardStatsRepository,
      dashboardConversationsRepository,
      dashboardContactsRepository,
      dashboardAttendanceRepository,
      dashboardSectorsRepository,
      dashboardChatbotsRepository,
      dashboardSchedulesRepository,
      dashboardTemplatesRepository,
      dashboardOfflineChannelsRepository,
      dashboardChannelsStatusRepository,
    };
  };

  it('builds dashboard stats from repository sources', async () => {
    const { service, dashboardStatsRepository } = makeService();

    await expect(service.getDashboardStats('acc-1')).resolves.toEqual({
      users: {
        total: 12,
        allowed: 20,
        sparkline_data: [1, 2, 3],
      },
      channels: {
        total: 8,
        connected: 5,
        allowed: 10,
        sparkline_data: [4, 5, 6],
      },
      contacts: {
        total: 150,
        allowed: 500,
        growth: 17,
        sparkline_data: [7, 8, 9],
      },
    });

    expect(dashboardStatsRepository.getUsersTotal).toHaveBeenCalledWith(
      'acc-1'
    );
    expect(
      dashboardStatsRepository.getContactsSparklineData
    ).toHaveBeenCalledWith('acc-1');
  });

  it('builds dashboard conversations response with fixed sparkline data', async () => {
    const { service, dashboardConversationsRepository } = makeService();

    await expect(service.getDashboardConversations('acc-1')).resolves.toEqual({
      active: 30,
      closed: 12,
      sparkline_data: [10, 20, 15, 30, 25, 40, 35],
      evolution: [{ date: '2026-01-01', count: 10 }],
    });

    expect(
      dashboardConversationsRepository.getConversationsEvolution
    ).toHaveBeenCalledWith('acc-1');
  });

  it('builds dashboard additional response and formats renewal date', async () => {
    const {
      service,
      dashboardContactsRepository,
      dashboardAttendanceRepository,
      dashboardSectorsRepository,
      dashboardChatbotsRepository,
      dashboardSchedulesRepository,
      dashboardTemplatesRepository,
    } = makeService();

    await expect(service.getDashboardAdditional('acc-1', t)).resolves.toEqual({
      contacts_growth: [{ month: '2026-01', value: 10 }],
      attendance_performance: { score: 90 },
      sectors_distribution: [
        {
          sector_id: 'sec-1',
          sector_name: 'Support',
          count: 3,
        },
      ],
      attendance_metrics: {
        avg_response_time: 12,
        avg_resolution_time: 33,
        total_attendances: 77,
        productivity: 88,
      },
      chatbots: {
        total: 11,
        active: 8,
        allowed: 20,
      },
      schedules: {
        sent: 40,
        allowed: 100,
        renewal_day: '07 de Janeiro',
      },
      contact_groups: 9,
      message_templates: 5,
      label_templates: 4,
    });

    expect(
      dashboardContactsRepository.getContactsGrowthMonthly
    ).toHaveBeenCalledWith('acc-1');
    expect(
      dashboardAttendanceRepository.getAttendancePerformance
    ).toHaveBeenCalledWith('acc-1');
    expect(
      dashboardSectorsRepository.getSectorsDistribution
    ).toHaveBeenCalledWith('acc-1');
    expect(dashboardChatbotsRepository.getChatbotsAllowed).toHaveBeenCalledWith(
      'acc-1'
    );
    expect(
      dashboardSchedulesRepository.getSchedulesSentAndRenewalDate
    ).toHaveBeenCalledWith('acc-1');
    expect(dashboardTemplatesRepository.getTemplateTotals).toHaveBeenCalledWith(
      'acc-1'
    );
  });

  it('builds dashboard additional response with null renewal day when date is absent', async () => {
    const { service, dashboardSchedulesRepository } = makeService();

    dashboardSchedulesRepository.getSchedulesSentAndRenewalDate.mockResolvedValueOnce(
      {
        sent: 12,
        renewalDate: null,
      }
    );

    await expect(service.getDashboardAdditional('acc-1', t)).resolves.toEqual(
      expect.objectContaining({
        schedules: {
          sent: 12,
          allowed: 100,
          renewal_day: null,
        },
      })
    );
  });

  it('delegates offline channels and channels status listing', async () => {
    const {
      service,
      dashboardOfflineChannelsRepository,
      dashboardChannelsStatusRepository,
    } = makeService();

    await expect(service.getDashboardOfflineChannels('acc-1')).resolves.toEqual(
      [{ id: 'ch-1' }]
    );
    expect(
      dashboardOfflineChannelsRepository.listOfflineChannels
    ).toHaveBeenCalledWith('acc-1');
    await expect(service.getDashboardChannelsStatus('acc-1')).resolves.toEqual([
      { id: 'ch-1', status: 'connected' },
    ]);
    expect(
      dashboardChannelsStatusRepository.listChannelsStatus
    ).toHaveBeenCalledWith('acc-1');
  });

  it('never reuses a stale connectivity snapshot between HTTP reads', async () => {
    const {
      service,
      dashboardOfflineChannelsRepository,
      dashboardChannelsStatusRepository,
    } = makeService();
    dashboardOfflineChannelsRepository.listOfflineChannels
      .mockResolvedValueOnce([{ id: 'online' }])
      .mockResolvedValueOnce([{ id: 'offline' }]);
    dashboardChannelsStatusRepository.listChannelsStatus
      .mockResolvedValueOnce([{ id: 'channel', status: 'online' }])
      .mockResolvedValueOnce([{ id: 'channel', status: 'offline' }]);

    await expect(service.getDashboardOfflineChannels('acc-1')).resolves.toEqual(
      [{ id: 'online' }]
    );
    await expect(service.getDashboardOfflineChannels('acc-1')).resolves.toEqual(
      [{ id: 'offline' }]
    );
    await expect(service.getDashboardChannelsStatus('acc-1')).resolves.toEqual([
      { id: 'channel', status: 'online' },
    ]);
    await expect(service.getDashboardChannelsStatus('acc-1')).resolves.toEqual([
      { id: 'channel', status: 'offline' },
    ]);

    expect(
      dashboardOfflineChannelsRepository.listOfflineChannels
    ).toHaveBeenCalledTimes(2);
    expect(
      dashboardChannelsStatusRepository.listChannelsStatus
    ).toHaveBeenCalledTimes(2);
  });
});
