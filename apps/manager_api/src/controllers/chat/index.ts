import { injectable } from 'tsyringe';
import { listChats } from './methods/listChats';

@injectable()
class ChatController {
  public listChats = listChats;
}

export default ChatController;
