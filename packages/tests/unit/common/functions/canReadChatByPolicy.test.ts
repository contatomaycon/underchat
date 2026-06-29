import { canReadChatByPolicy } from '@core/common/functions/canReadChatByPolicy';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { IChat } from '@core/common/interfaces/IChat';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';

function buildAction(actionName: EPermissionsRoles): IJwtGroupHierarchy {
  return {
    account_id: 'account-1',
    permission_role_id: 'role-1',
    role_name: 'Role',
    module_name: 'chat',
    action_name: actionName,
  };
}

function buildChat(overrides: Partial<IChat> = {}): IChat {
  return {
    chat_id: 'chat-1',
    account: { id: 'account-1', name: 'Account' },
    worker: { id: 'channel-1', name: 'Channel' },
    sector: null,
    user: null,
    secondary_users: [],
    contact: null,
    photo: null,
    name: 'Contact',
    phone: '5511999999999',
    status: EChatStatus.ura,
    date: new Date().toISOString(),
    ...overrides,
  };
}

describe('canReadChatByPolicy', () => {
  it('blocks chatbot chats for users without chatbot read access', () => {
    const chat = buildChat();

    const canRead = canReadChatByPolicy({
      chat,
      userId: 'user-1',
      actions: [buildAction(EChatPermissions.chat_access)],
      userSectors: [],
      userChannels: [],
    });

    expect(canRead).toBe(false);
  });

  it('allows chatbot chats for users with view_chatbot_messages', () => {
    const chat = buildChat({ status: EChatStatus.ura_webhook });

    const canRead = canReadChatByPolicy({
      chat,
      userId: 'user-1',
      actions: [buildAction(EChatPermissions.view_chatbot_messages)],
      userSectors: [],
      userChannels: [],
    });

    expect(canRead).toBe(true);
  });

  it('allows chatbot chats for master and administrator-equivalent permissions', () => {
    const chat = buildChat();

    expect(
      canReadChatByPolicy({
        chat,
        userId: 'user-1',
        actions: [buildAction(EGeneralPermissions.full_access)],
        userSectors: [],
        userChannels: [],
      })
    ).toBe(true);

    expect(
      canReadChatByPolicy({
        chat,
        userId: 'user-1',
        actions: [buildAction(EGeneralPermissions.full_access_group)],
        userSectors: [],
        userChannels: [],
      })
    ).toBe(true);
  });
});
