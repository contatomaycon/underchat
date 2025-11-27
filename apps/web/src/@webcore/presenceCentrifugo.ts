import { onMessage } from '@webcore/centrifugo';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { useChatStore } from '@webcore/stores/chat';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { AuthUserResponse } from '@core/schema/auth/login/response.schema';

let initializedAccountId: string | null = null;

export const initUserPresenceSubscription = async (
  accountId: string
): Promise<void> => {
  if (!accountId) return;
  if (initializedAccountId === accountId) return;

  initializedAccountId = accountId;

  const channel = chatAccountCentrifugo(accountId);
  const chatStore = useChatStore();

  await onMessage(channel, (data: any) => {
    if (!data || typeof data !== 'object') return;

    if ('event' in data && data.event === 'user_presence') {
      if (data.user_id === chatStore.user?.user_id) {
        const currentUser = chatStore.user;

        if (!currentUser) return;

        const updatedChatUser = {
          ...(currentUser.chat_user ?? {}),
          status: data.status as EChatUserStatus,
        };

        chatStore.user = {
          ...currentUser,
          chat_user: updatedChatUser as AuthUserResponse['chat_user'],
        };

        chatStore.updateChatUserImmediate();
      }
    }
  });
};
