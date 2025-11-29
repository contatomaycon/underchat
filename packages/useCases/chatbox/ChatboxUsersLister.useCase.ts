import { injectable } from 'tsyringe';
import { UserService } from '@core/services/user.service';
import { ListChatboxUsersResponse } from '@core/schema/chatbox/listUsers/response.schema';

@injectable()
export class ChatboxUsersListerUseCase {
  constructor(private readonly userService: UserService) {}

  async execute(
    accountId: string,
    excludeUserId: string
  ): Promise<ListChatboxUsersResponse> {
    return this.userService.listUsersForTransfer(accountId, excludeUserId);
  }
}
