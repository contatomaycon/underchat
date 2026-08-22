import { ILockLeaseContext } from '@core/common/functions/withLock';
import { SessionStorageMigrationOrchestratorService } from '@core/services/sessionStorageMigrationOrchestrator.service';
import { inject, injectable } from 'tsyringe';

@injectable()
export class SessionStorageMigrationActivity {
  constructor(
    @inject(SessionStorageMigrationOrchestratorService)
    private readonly orchestrator: SessionStorageMigrationOrchestratorService
  ) {}

  processPending = async (context: ILockLeaseContext): Promise<void> => {
    context.assertActive();
    await this.orchestrator.processPending();
    context.assertActive();
  };
}
