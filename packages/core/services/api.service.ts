import { ERouteModule } from '@core/common/enums/ERouteModule';
import { MiddlewareJwtRepository } from '@core/repositories/middleware/MiddlewareJwt.repository';
import { injectable } from 'tsyringe';

@injectable()
export class ApiService {
  constructor(
    private readonly middlewareJwtRepository: MiddlewareJwtRepository
  ) {}

  findApiByJwt = async (
    userId: string,
    routeModule: ERouteModule,
    module: ERouteModule
  ) => {
    return this.middlewareJwtRepository.find(userId, routeModule, module);
  };
}
