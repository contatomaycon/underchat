import { injectable } from 'tsyringe';
import { ChatContactService } from '@core/services/chatContact.service';
import { ListChatLabelTemplatesResponse } from '@core/schema/chat/listLabelTemplates/response.schema';

@injectable()
export class ChatLabelTemplateListerUseCase {
  constructor(private readonly chatContactService: ChatContactService) {}

  async execute(accountId: string): Promise<ListChatLabelTemplatesResponse[]> {
    return this.chatContactService.listChatLabelTemplates(accountId);
  }
}
