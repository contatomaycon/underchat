import { WhatsappSessionGarbageCollectorService } from '@core/services/whatsappSessionGarbageCollector.service';
import { inject, injectable } from 'tsyringe';

export interface IWhatsappSessionGarbageCollectionActivity {
  collectExpiredRevisions(): Promise<void>;
}

@injectable()
export class WhatsappSessionGarbageCollectionActivity implements IWhatsappSessionGarbageCollectionActivity {
  constructor(
    @inject(WhatsappSessionGarbageCollectorService)
    private readonly garbageCollector: WhatsappSessionGarbageCollectorService
  ) {}

  collectExpiredRevisions = async (): Promise<void> => {
    await this.garbageCollector.collectOnce();
  };
}
