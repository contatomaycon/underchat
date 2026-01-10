import { injectable } from 'tsyringe';
import { UserService } from '@core/services/user.service';
import { ListTransferUsersResponse } from '@core/schema/chat/listTransferUsers/response.schema';

@injectable()
export class ChatTransferUsersListerUseCase {
  constructor(private readonly userService: UserService) {}

  async execute(accountId: string): Promise<ListTransferUsersResponse> {
    return this.userService.listUsersForTransfer(accountId);
  }
}
