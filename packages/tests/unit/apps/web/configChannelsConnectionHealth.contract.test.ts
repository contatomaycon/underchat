import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('config channels connection health contract', () => {
  const configChannelsPage = read('apps/web/src/pages/config/channels-tab.vue');
  const connectionHealthPresentation = read(
    'apps/web/src/utils/connectionHealthPresentation.ts'
  );
  const configRoutes = read('apps/manager_api/src/routes/config.route.ts');
  const configHealthUseCase = read(
    'packages/useCases/config/ConfigChannelConnectionHealth.useCase.ts'
  );
  const settingsStore = read('apps/web/src/@webcore/stores/settings.ts');
  const healthDialog = read(
    'apps/web/src/components/channel/AppLogsChannel.vue'
  );

  it('offers the existing connection health dialog from eligible config rows', () => {
    expect(configChannelsPage).toContain('canViewConnectionHealth(item)');
    expect(configChannelsPage).toContain(
      'config-channel-connection-health-${item.id}'
    );
    expect(configChannelsPage).toContain(
      '@click.stop="openConnectionHealthDialog(item.id)"'
    );
    expect(configChannelsPage).toContain('<AppLogsChannel');
    expect(configChannelsPage).toContain(
      ':channel-id="connectionHealthChannelId"'
    );
    expect(configChannelsPage).toContain('icon="tabler-heartbeat"');
    expect(configChannelsPage).toContain('scope="config"');
  });

  it('keeps health restricted to database-backed unofficial channels', () => {
    expect(connectionHealthPresentation).toContain(
      'channel.session_storage === EWorkerSessionStorage.postgres'
    );
    expect(connectionHealthPresentation).toContain(
      'CONNECTION_HEALTH_WORKER_TYPES.has'
    );
  });

  it('loads cross-account health only through the authenticated config route', () => {
    expect(configRoutes).toContain(
      "server.get('/config/channels/:channel_id/health'"
    );
    expect(configRoutes).toContain(
      'server.authenticateJwt(request, reply, configPermissions)'
    );
    expect(configHealthUseCase).toContain(
      'this.configService.viewChannelContext(channelId)'
    );
    expect(configHealthUseCase).toContain('channelContext.account_id');
    expect(settingsStore).toContain(
      '`/config/channels/${encodeURIComponent(channelId)}/health`'
    );
    expect(healthDialog).toContain('scope?: ChannelConnectionHealthScope;');
  });
});
