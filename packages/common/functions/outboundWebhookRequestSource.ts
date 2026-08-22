import { ERouteModule } from '@core/common/enums/ERouteModule';

export type OutboundWebhookRequestSource = 'manager_api' | 'public_api';

/**
 * Identifies which externally callable API accepted a shared controller
 * request. Keeping this at the controller boundary prevents public API
 * mutations from being incorrectly attributed to the Manager.
 */
export function resolveOutboundWebhookRequestSource(
  routeModule: ERouteModule
): OutboundWebhookRequestSource {
  return routeModule === ERouteModule.public ? 'public_api' : 'manager_api';
}
