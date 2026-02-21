import { AccountBucketCleanupService } from '@core/services/accountBucketCleanup.service';
import { injectable, inject } from 'tsyringe';

export interface IAccountBucketCleanupActivity {
  processExpiredAccountBuckets(): Promise<void>;
}

@injectable()
export class AccountBucketCleanupActivity implements IAccountBucketCleanupActivity {
  constructor(
    @inject(AccountBucketCleanupService)
    private readonly accountBucketCleanupService: AccountBucketCleanupService
  ) {}

  processExpiredAccountBuckets = async (): Promise<void> => {
    await this.accountBucketCleanupService.processExpiredAccounts();
  };
}
