import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { ListUsersQuery } from '@core/schema/internalChat/listUsers/request.schema';

@injectable()
export class InternalChatUsersListerUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(accountId: string, userId: string, query: ListUsersQuery) {
    return this.internalChatService.listUsers(accountId, userId, query);
  }
}
