import { inject, singleton } from 'tsyringe';
import type { ILockLeaseContext } from '@core/common/functions/withLock';
import { WhatsappProviderHandoffRecoveryService } from '@core/services/whatsappProviderHandoffRecovery.service';

@singleton()
export class WhatsappProviderHandoffRecoveryActivity {
  constructor(
    @inject(WhatsappProviderHandoffRecoveryService)
    private readonly recoveryService: WhatsappProviderHandoffRecoveryService
  ) {}

  recoverPendingHandoffs = async (
    leaseContext: ILockLeaseContext
  ): Promise<void> => {
    leaseContext.assertActive();
    await this.recoveryService.recoverOnce();
    leaseContext.assertActive();
  };
}
