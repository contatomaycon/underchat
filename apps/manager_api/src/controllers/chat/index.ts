import { injectable } from 'tsyringe';
import { listChats } from './methods/listChats';
import { listChatsUser } from './methods/listChatsUser';
import { updateChatsUser } from './methods/updateChatsUser';

@injectable()
class ChatController {
  public listChats = listChats;
  public listChatsUser = listChatsUser;
  public updateChatsUser = updateChatsUser;
}

export default ChatController;
