import { ApiService } from '@core/services/api.service';
import { injectable } from 'tsyringe';
import { IJwtMiddleware } from '@core/common/interfaces/IJwtMiddleware';
import { IJwtPermissionsWithPlan } from '@core/common/interfaces/IJwtPermissionsWithPlan';

@injectable()
export class ApiJwtViewerUseCase {
  constructor(private readonly apiService: ApiService) {}

  async execute({
    userId,
    routeModule,
    module,
  }: IJwtMiddleware): Promise<IJwtPermissionsWithPlan> {
    return this.apiService.findApiByJwt(userId, routeModule, module);
  }
}
