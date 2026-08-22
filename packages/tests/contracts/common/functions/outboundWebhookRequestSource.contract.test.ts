import { ERouteModule } from '@core/common/enums/ERouteModule';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';

describe('resolveOutboundWebhookRequestSource', () => {
  it.each([
    [ERouteModule.manager, 'manager_api'],
    [ERouteModule.public, 'public_api'],
  ] as const)('maps %s requests to %s', (routeModule, expected) => {
    expect(resolveOutboundWebhookRequestSource(routeModule)).toBe(expected);
  });
});
