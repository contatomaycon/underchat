import { ERouteModule } from '@core/common/enums/ERouteModule';
import { MiddlewareApiKeyRepository } from '@core/repositories/middleware/MiddlewareApiKey.repository';
import { MiddlewareJwtRepository } from '@core/repositories/middleware/MiddlewareJwt.repository';
import { injectable, inject } from 'tsyringe';
import { IJwtPermissionsWithPlan } from '@core/common/interfaces/IJwtPermissionsWithPlan';

@injectable()
export class ApiService {
  constructor(
    @inject(MiddlewareJwtRepository)
    private readonly middlewareJwtRepository: MiddlewareJwtRepository,
    @inject(MiddlewareApiKeyRepository)
    private readonly middlewareApiKeyRepository: MiddlewareApiKeyRepository
  ) {}

  findApiByJwt = async (
    userId: string,
    routeModule: ERouteModule,
    module: ERouteModule
  ): Promise<IJwtPermissionsWithPlan> => {
    return this.middlewareJwtRepository.find(userId, routeModule, module);
  };

  findApiByKeyApi = async (
    keyApi: string,
    routeModule: string,
    module: ERouteModule
  ) => {
    return this.middlewareApiKeyRepository.find(keyApi, routeModule, module);
  };
}
