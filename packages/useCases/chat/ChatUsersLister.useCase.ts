import { injectable, inject } from 'tsyringe';
import { UserService } from '@core/services/user.service';
import { ListChatUsersResponse } from '@core/schema/chat/listChatUsers/response.schema';

@injectable()
export class ChatUsersListerUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService
  ) {}

  async execute(accountId: string): Promise<ListChatUsersResponse> {
    const users = await this.userService.listUsersForTransfer(accountId);

    return users.map((user) => ({
      user_id: user.id,
      name: user.name || null,
      photo: user.photo ?? null,
    }));
  }
}
