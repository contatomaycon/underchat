import { injectable } from 'tsyringe';
import { listChats } from './methods/listChats';
import { listChatsUser } from './methods/listChatsUser';
import { updateChatsUser } from './methods/updateChatsUser';
import { listMessageChats } from './methods/listMessageChats';
import { createMessageChats } from './methods/createMessageChats';
import { createChats } from './methods/createChats';
import { viewChatLinkPreview } from './methods/viewChatLinkPreview';
import { reactMessage } from './methods/reactMessage';
import { deleteMessage } from './methods/deleteMessage';
import { editMessage } from './methods/editMessage';
import { updateChatStatus } from './methods/updateChatStatus';
import { clearChatSummary } from './methods/clearChatSummary';
import { updateChatContact } from './methods/updateChatContact';

@injectable()
class ChatController {
  public listChats = listChats;
  public listMessageChats = listMessageChats;
  public listChatsUser = listChatsUser;
  public updateChatsUser = updateChatsUser;
  public createMessageChats = createMessageChats;
  public createChats = createChats;
  public viewChatLinkPreview = viewChatLinkPreview;
  public reactMessage = reactMessage;
  public deleteMessage = deleteMessage;
  public editMessage = editMessage;
  public updateChatStatus = updateChatStatus;
  public clearChatSummary = clearChatSummary;
  public updateChatContact = updateChatContact;
}

export default ChatController;
