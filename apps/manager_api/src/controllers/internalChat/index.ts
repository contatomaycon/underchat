import { injectable } from 'tsyringe';
import { listConversations } from './methods/listConversations';
import { listUsers } from './methods/listUsers';
import { openDirect } from './methods/openDirect';
import { viewConversation } from './methods/viewConversation';
import { closeConversation } from './methods/closeConversation';
import { markRead } from './methods/markRead';
import { listMessages } from './methods/listMessages';
import { createMessage } from './methods/createMessage';
import { reactMessage } from './methods/reactMessage';
import { editMessage } from './methods/editMessage';
import { deleteMessage } from './methods/deleteMessage';
import { forwardMessage } from './methods/forwardMessage';
import { activity } from './methods/activity';
import { createGroup } from './methods/createGroup';
import { updateGroup } from './methods/updateGroup';
import { listGroupMembers } from './methods/listGroupMembers';
import { addGroupMember } from './methods/addGroupMember';
import { removeGroupMember } from './methods/removeGroupMember';
import { transferLeader } from './methods/transferLeader';
import { realtimeToken } from './methods/realtimeToken';

@injectable()
class InternalChatController {
  public listConversations = listConversations;
  public listUsers = listUsers;
  public openDirect = openDirect;
  public viewConversation = viewConversation;
  public closeConversation = closeConversation;
  public markRead = markRead;
  public listMessages = listMessages;
  public createMessage = createMessage;
  public reactMessage = reactMessage;
  public editMessage = editMessage;
  public deleteMessage = deleteMessage;
  public forwardMessage = forwardMessage;
  public activity = activity;
  public createGroup = createGroup;
  public updateGroup = updateGroup;
  public listGroupMembers = listGroupMembers;
  public addGroupMember = addGroupMember;
  public removeGroupMember = removeGroupMember;
  public transferLeader = transferLeader;
  public realtimeToken = realtimeToken;
}

export default InternalChatController;
