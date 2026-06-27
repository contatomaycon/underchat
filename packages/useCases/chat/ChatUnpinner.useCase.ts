import { ChatUserService } from '@core/services/chatUser.service';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ChatUnpinnerUseCase {
  constructor(
    @inject(ChatUserService)
    private readonly chatUserService: ChatUserService
  ) {}

  async execute(userId: string, chatId: string): Promise<boolean> {
    await this.chatUserService.unpinChat(userId, chatId);
    return true;
  }
}
