import 'reflect-metadata';

import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { ChatbotInactivityAlertChannelDeactivatorService } from '@core/services/chatbotInactivityAlertChannelDeactivator.service';

describe('ChatbotInactivityAlertChannelDeactivatorService', () => {
  const accountId = '019b4e0d-0000-7000-8000-000000000001';
  const channelId = '019b4e0d-0000-7000-8000-000000000002';

  afterEach(() => {
    jest.useRealTimers();
  });

  function makeService(overrides: Record<string, unknown> = {}): {
    service: ChatbotInactivityAlertChannelDeactivatorService;
    elasticDatabaseService: {
      indices: jest.Mock;
      updateByQueryWithScript: jest.Mock;
    };
  } {
    const elasticDatabaseService = {
      indices: jest.fn(async () => true),
      updateByQueryWithScript: jest.fn(async () => ({
        updated: 2,
        total: 2,
        versionConflicts: 0,
        failures: [],
      })),
      ...overrides,
    };

    return {
      service: new ChatbotInactivityAlertChannelDeactivatorService(
        elasticDatabaseService as never
      ),
      elasticDatabaseService,
    };
  }

  it('deactivates only active chatbot redirects linked to the deleted channel', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-19T15:00:00.000Z'));
    const { service, elasticDatabaseService } = makeService();

    await expect(
      service.deactivateByChannel(accountId, channelId)
    ).resolves.toBe(2);

    expect(elasticDatabaseService.indices).toHaveBeenCalledWith(
      EElasticIndex.chatbot_flow_configurations,
      expect.objectContaining({ mappings: expect.any(Object) })
    );
    expect(elasticDatabaseService.updateByQueryWithScript).toHaveBeenCalledWith(
      EElasticIndex.chatbot_flow_configurations,
      expect.objectContaining({ bool: expect.any(Object) }),
      expect.objectContaining({
        source: expect.stringContaining(
          'ctx._source.configurations.inactivity_alert.status = params.inactive_status'
        ),
        params: {
          active_status: 'active',
          inactive_status: 'inactive',
          redirect_action: 'redirect',
          chatbot_redirect_type: 'chatbot',
          channel_id: channelId,
          updated_at: '2026-08-19T15:00:00.000Z',
        },
      }),
      {
        conflicts: 'abort',
        refresh: true,
        maxRetries: 5,
      }
    );

    const [, query] =
      elasticDatabaseService.updateByQueryWithScript.mock.calls[0];
    expect(JSON.stringify(query)).toContain(`"account_id":"${accountId}"`);
    expect(JSON.stringify(query)).toContain(
      `"configurations.inactivity_alert.selected_channel":"${channelId}"`
    );
    expect(JSON.stringify(query)).toContain(
      '"configurations.inactivity_alert.redirect_type":"chatbot"'
    );
  });

  it('does not run the update when the configurations index cannot be prepared', async () => {
    const { service, elasticDatabaseService } = makeService({
      indices: jest.fn(async () => false),
    });

    await expect(
      service.deactivateByChannel(accountId, channelId)
    ).rejects.toThrow('Failed to prepare chatbot flow configurations index');
    expect(
      elasticDatabaseService.updateByQueryWithScript
    ).not.toHaveBeenCalled();
  });
});
