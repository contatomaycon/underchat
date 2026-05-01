import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { IInternalChatDispatchMessage } from '@core/common/interfaces/internalChat/IInternalChatDispatchMessage';

@injectable()
export class InternalChatCommandDispatcherService {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async dispatchMessage(payload: IInternalChatDispatchMessage): Promise<void> {
    await this.internalChatService.dispatchEnqueuedMessage(payload);
  }
}
