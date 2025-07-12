import { ApiService } from '@core/services/api.service';
import { injectable } from 'tsyringe';
import { IJwtMiddleware } from '@core/common/interfaces/IJwtMiddleware';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';

@injectable()
export class ApiJwtViewerUseCase {
  constructor(private readonly apiService: ApiService) {}

  async execute({
    userId,
    routeModule,
    module,
  }: IJwtMiddleware): Promise<IJwtGroupHierarchy[]> {
    return this.apiService.findApiByJwt(userId, routeModule, module);
  }
}
