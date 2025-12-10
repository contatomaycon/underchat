import { ERouteModule } from '../enums/ERouteModule';

export interface IJwtMiddleware {
  userId: string;
  accountId: string;
  routeModule: ERouteModule;
  module: ERouteModule;
}
