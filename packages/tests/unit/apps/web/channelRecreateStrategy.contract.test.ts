import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('channel recreate strategy contract', () => {
  const channelsPage = read('apps/web/src/pages/channels.vue');
  const configChannelsPage = read('apps/web/src/pages/config/channels-tab.vue');
  const settingsStore = read('apps/web/src/@webcore/stores/settings.ts');
  const channelsStore = read('apps/web/src/@webcore/stores/channels.ts');
  const locales = ['pt', 'en', 'es'].map(
    (locale) =>
      JSON.parse(
        read(`apps/web/src/plugins/i18n/locales/${locale}.json`)
      ) as Record<string, string>
  );

  it('requires an explicit decision for individual recreation on both channel pages', () => {
    for (const page of [channelsPage, configChannelsPage]) {
      expect(page).toContain('<AppChannelConnectionStrategyDialog');
      expect(page).toContain('mode="recreate"');
      expect(page).toContain('@select="handleRecreate"');
    }
  });

  it('routes fresh and preserving choices to distinct API contracts', () => {
    expect(channelsPage).toContain(
      'strategy === EWorkerConnectionStrategy.fresh'
    );
    expect(channelsPage).toContain('channelsStore.resetConnectionChannel');
    expect(channelsPage).toContain('channelsStore.recreateChannel');
    expect(channelsStore).toContain('/connection/reset');
    expect(settingsStore).toContain('connection_strategy: connectionStrategy');
  });

  it('keeps recreate-all on its preserving endpoint without a destructive strategy', () => {
    const bulkMethod = settingsStore.slice(
      settingsStore.indexOf('async recreateChannelsAll('),
      settingsStore.indexOf('async getChannelsStatistics(')
    );

    expect(bulkMethod).toContain('/config/channels/recreate-all');
    expect(bulkMethod).not.toContain('connection_strategy');
    expect(bulkMethod).not.toContain('/connection/reset');
  });

  it('keeps channel recreation copy simple and free of infrastructure details', () => {
    const userFacingKeys = [
      'channel_connection_strategy_description',
      'channel_connection_strategy_fresh_description',
      'channel_connection_strategy_fresh_warning',
      'channel_connection_strategy_migrate_description',
      'channel_connection_strategy_migrate_note',
      'channel_recreate_strategy_description',
      'channel_recreate_strategy_fresh_description',
      'channel_recreate_strategy_fresh_warning',
      'channel_recreate_strategy_preserve_description',
      'channel_recreate_strategy_preserve_note',
      'worker_connection_reset_success',
      'worker_connection_reset_error',
    ];
    const infrastructureTerms =
      /volume|database|banco de dados|base de datos|container|contenedor|armazenamento|storage|almacenamiento|postgres|legad|legacy|heredad|server|servidor/iu;

    for (const locale of locales) {
      for (const key of userFacingKeys) {
        expect(locale[key]).toBeDefined();
        expect(locale[key]).not.toMatch(infrastructureTerms);
      }
    }
  });
});
