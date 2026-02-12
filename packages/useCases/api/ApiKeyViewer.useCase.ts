import { ApiService } from '@core/services/api.service';
import { injectable, inject } from 'tsyringe';
import { IApiKeyGroupHierarchy } from '@core/common/interfaces/IApiKeyGroupHierarchy';
import { IApiKeyMiddleware } from '@core/common/interfaces/IApiKeyMiddleware';

@injectable()
export class ApiKeyViewerUseCase {
  constructor(
    @inject(ApiService)
    private readonly apiService: ApiService
  ) {}

  async execute(input: IApiKeyMiddleware): Promise<IApiKeyGroupHierarchy[]> {
    return this.apiService.findApiByKeyApi(
      input.key_api,
      input.route_module,
      input.module
    );
  }
}
