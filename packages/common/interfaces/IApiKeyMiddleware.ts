import { ERouteModule } from '../enums/ERouteModule';

export interface IApiKeyMiddleware {
  key_api: string;
  route_module: string;
  module: ERouteModule;
}
