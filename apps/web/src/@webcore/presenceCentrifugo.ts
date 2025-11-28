import { onMessage } from '@webcore/centrifugo';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { useChatStore } from '@webcore/stores/chat';
import { useUsersStore } from '@webcore/stores/user';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { AuthUserResponse } from '@core/schema/auth/login/response.schema';
import { refreshPresenceForCurrentRoute } from './presence';

let initializedAccountId: string | null = null;

export const initUserPresenceSubscription = async (
  accountId: string
): Promise<void> => {
  if (!accountId) return;
  if (initializedAccountId === accountId) return;

  initializedAccountId = accountId;

  const channel = chatAccountCentrifugo(accountId);
  const chatStore = useChatStore();
  const usersStore = useUsersStore();

  const updateCurrentUserStatus = (status: EChatUserStatus): void => {
    const currentUser = chatStore.user;
    if (!currentUser) return;

    const updatedChatUser = currentUser.chat_user
      ? {
          ...currentUser.chat_user,
          status,
        }
      : {
          status,
        };

    chatStore.user = {
      ...currentUser,
      chat_user: updatedChatUser as AuthUserResponse['chat_user'],
    };

    chatStore.updateChatUserImmediate();
  };

  const updateUserInList = (userId: string, status: EChatUserStatus): void => {
    const index = usersStore.list.findIndex((user) => user.user_id === userId);

    if (index === -1) return;

    const existing = usersStore.list[index];
    if (!existing.chat_user) return;

    usersStore.list[index] = {
      ...existing,
      chat_user: {
        ...existing.chat_user,
        status,
      },
    };
  };

  const handleUserPresenceEvent = (data: any): void => {
    const status = data.status as EChatUserStatus;
    const previousCurrentUserStatus = chatStore.user?.chat_user?.status;

    if (data.user_id === chatStore.user?.user_id) {
      updateCurrentUserStatus(status);

      if (previousCurrentUserStatus !== status) {
        refreshPresenceForCurrentRoute();
      }
    }

    updateUserInList(data.user_id, status);
  };

  await onMessage(channel, (data: any) => {
    if (!data || typeof data !== 'object') return;

    if ('event' in data && data.event === 'user_presence') {
      handleUserPresenceEvent(data);
    }
  });
};
