import { inject, injectable } from 'tsyringe';
import { PublicApiTokenService } from '@core/services/publicApiToken.service';
import { PublicApiTokenResponse } from '@core/schema/integration/apiToken/response.schema';

@injectable()
export class PublicApiTokenGeneratorUseCase {
  constructor(
    @inject(PublicApiTokenService)
    private readonly publicApiTokenService: PublicApiTokenService
  ) {}

  execute(
    accountId: string,
    actorUserId: string
  ): Promise<PublicApiTokenResponse> {
    return this.publicApiTokenService.generate(accountId, actorUserId);
  }
}
