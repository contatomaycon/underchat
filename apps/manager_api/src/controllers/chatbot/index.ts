import { injectable } from 'tsyringe';
import { createChatbot } from './methods/createChatbot';
import { listChatbot } from './methods/listChatbot';
import { listUsers } from './methods/listUsers';
import { listSectors } from './methods/listSectors';
import { listSectorUsers } from './methods/listSectorUsers';
import { listChatTags } from './methods/listChatTags';

@injectable()
class ChatbotController {
  public createChatbot = createChatbot;
  public listChatbot = listChatbot;
  public listUsers = listUsers;
  public listSectors = listSectors;
  public listSectorUsers = listSectorUsers;
  public listChatTags = listChatTags;
}

export default ChatbotController;
