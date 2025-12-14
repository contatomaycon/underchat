import { inject, injectable } from 'tsyringe';
import { PlanAccountUpdaterRepository } from '@core/repositories/planAccount/PlanAccountUpdater.repository';
import { UpdatePlanAccountRequest } from '@core/schema/planAccount/updatePlanAccount/request.schema';
import { withLock } from '@core/common/functions/withLock';
import Redis from 'ioredis';

@injectable()
export class PlanAccountService {
  constructor(
    private readonly planAccountUpdaterRepository: PlanAccountUpdaterRepository,
    @inject('Redis') private readonly redis: Redis
  ) {}

  findPlanAccountByAccountId = async (accountId: string) => {
    return this.planAccountUpdaterRepository.findPlanAccountByAccountId(
      accountId
    );
  };

  updatePlanAccountByAccountId = async (
    accountId: string,
    input: UpdatePlanAccountRequest
  ): Promise<boolean> => {
    const lockKey = `plan-account:${accountId}`;
    const result = await withLock(
      this.redis,
      lockKey,
      () =>
        this.planAccountUpdaterRepository.updatePlanAccountByAccountId(
          accountId,
          input
        ),
      { ttlMs: 20000 }
    );

    return result ?? false;
  };
}
