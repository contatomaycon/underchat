import { injectable } from 'tsyringe';
import { ChatbotCreatorRepository } from '@core/repositories/chatbot/ChatbotCreator.repository';
import { ChatbotListerRepository } from '@core/repositories/chatbot/ChatbotLister.repository';
import { ChatbotChatTagsListerRepository } from '@core/repositories/labelTemplate/ChatbotChatTagsLister.repository';
import { CreateChatbotRequest } from '@core/schema/chatbot/createChatbot/request.schema';
import { CreateChatbotResponse } from '@core/schema/chatbot/createChatbot/response.schema';
import { ListChatbotResponse } from '@core/schema/chatbot/listChatbot/response.schema';
import { ChatbotChatTagResponse } from '@core/schema/chatbot/listChatTags/response.schema';
import { UserService } from '@core/services/user.service';
import { SectorService } from '@core/services/sector.service';
import { ListChatbotUsersResponse } from '@core/schema/chatbot/listUsers/response.schema';
import { ListChatbotSectorsResponse } from '@core/schema/chatbot/listSectors/response.schema';
import { ChatbotSectorUserResponse } from '@core/schema/chatbot/listSectorUsers/response.schema';

@injectable()
export class ChatbotService {
  constructor(
    private readonly chatbotCreatorRepository: ChatbotCreatorRepository,
    private readonly chatbotListerRepository: ChatbotListerRepository,
    private readonly chatbotChatTagsListerRepository: ChatbotChatTagsListerRepository,
    private readonly userService: UserService,
    private readonly sectorService: SectorService
  ) {}

  createChatbot = async (
    input: CreateChatbotRequest,
    accountId: string
  ): Promise<CreateChatbotResponse | null> => {
    return this.chatbotCreatorRepository.createChatbot(input, accountId);
  };

  listChatbots = async (accountId: string): Promise<ListChatbotResponse[]> => {
    return this.chatbotListerRepository.listChatbots(accountId);
  };

  listChatbotTags = async (
    accountId: string
  ): Promise<ChatbotChatTagResponse[]> => {
    return this.chatbotChatTagsListerRepository.listChatbotChatTags(accountId);
  };

  listChatbotUsers = async (
    accountId: string,
    excludeUserId: string
  ): Promise<ListChatbotUsersResponse> => {
    return this.userService.listUsersForTransfer(accountId, excludeUserId);
  };

  listChatbotSectors = async (
    accountId: string,
    isAdministrator: boolean
  ): Promise<ListChatbotSectorsResponse> => {
    return this.sectorService.listSectorsForTransfer(
      accountId,
      isAdministrator
    );
  };

  listChatbotSectorUsers = async (
    accountId: string,
    sectorId: string
  ): Promise<ChatbotSectorUserResponse[]> => {
    return this.sectorService.listSectorUsersForTransfer(accountId, sectorId);
  };
}
