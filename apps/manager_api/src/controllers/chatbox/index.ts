import { injectable } from 'tsyringe';
import { listUsers } from './methods/listUsers';
import { listSectors } from './methods/listSectors';
import { listSectorUsers } from './methods/listSectorUsers';
import { listChatTags } from './methods/listChatTags';

@injectable()
class ChatboxController {
  public listUsers = listUsers;
  public listSectors = listSectors;
  public listSectorUsers = listSectorUsers;
  public listChatTags = listChatTags;
}

export default ChatboxController;
