import { injectable } from 'tsyringe';
import { listChats } from './methods/listChats';
import { listChatsUser } from './methods/listChatsUser';
import { updateChatsUser } from './methods/updateChatsUser';
import { listMessageChats } from './methods/listMessageChats';
import { createMessageChats } from './methods/createMessageChats';

@injectable()
class ChatController {
  public listChats = listChats;
  public listMessageChats = listMessageChats;
  public listChatsUser = listChatsUser;
  public updateChatsUser = updateChatsUser;
  public createMessageChats = createMessageChats;
}

export default ChatController;
