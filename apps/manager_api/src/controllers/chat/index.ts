import { injectable } from 'tsyringe';
import { listChats } from './methods/listChats';
import { listChatsUser } from './methods/listChatsUser';

@injectable()
class ChatController {
  public listChats = listChats;
  public listChatsUser = listChatsUser;
}

export default ChatController;
