import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { PlanAccountCancellationService } from '@core/services/planAccountCancellation.service';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { ITokenJwtData } from '@core/common/interfaces/ITokenJwtData';

@injectable()
export class PlanAccountCancellerUseCase {
  constructor(
    @inject(PlanAccountCancellationService)
    private readonly planAccountCancellationService: PlanAccountCancellationService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    tokenJwtData: ITokenJwtData
  ): Promise<string> {
    return this.planAccountCancellationService.cancelPlanAccount(
      t,
      tokenJwtData.account_id,
      EAccountStatus.inactive,
      tokenJwtData
    );
  }
}
