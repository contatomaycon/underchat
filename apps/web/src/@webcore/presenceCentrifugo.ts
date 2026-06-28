import { onMessage } from '@webcore/centrifugo';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { useChatStore } from '@webcore/stores/chat';
import { useUsersStore } from '@webcore/stores/user';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { AuthUserResponse } from '@core/schema/auth/login/response.schema';
import { refreshPresenceForCurrentRoute } from './presence';
import { setChannels } from './localStorage/user';
import { teardownClientSession } from './utils/sessionTeardown';

let initializedAccountId: string | null = null;

export const resetUserPresenceSubscriptionState = (): void => {
  initializedAccountId = null;
};

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
    if (currentUser.chat_user?.status === status) return;

    const updatedChatUser = currentUser.chat_user
      ? {
          ...currentUser.chat_user,
          status,
        }
      : {
          chat_user_id: '',
          about: '',
          notifications: true,
          notifications_sound: true,
          notifications_vibrate: false,
          notifications_toast: true,
          notifications_browser: true,
          notifications_push: true,
          notifications_message_queue: false,
          notifications_message_in_chat: true,
          notifications_message_chatbot: false,
          notifications_transfer: true,
          notifications_internal_chat: true,
          notifications_internal_chat_direct: true,
          notifications_internal_chat_group: true,
          notifications_internal_chat_sound: true,
          notifications_internal_chat_vibrate: false,
          notifications_internal_chat_toast: true,
          notifications_internal_chat_browser: true,
          notifications_internal_chat_push: true,
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
    if (existing.chat_user.status === status) return;

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

  const handleForceLogoutEvent = async (data: {
    event: string;
    user_id: string;
    session_platform?: string;
  }): Promise<void> => {
    if (data.user_id !== chatStore.user?.user_id) return;
    if (data.session_platform && data.session_platform !== 'web') return;

    const { router } = await import('@/plugins/1.router');
    const { useAuthStore } = await import('@webcore/stores/auth');
    const { getI18n } = await import('@/plugins/i18n');
    const { EColor } = await import('@core/common/enums/EColor');

    const authStore = useAuthStore();
    const i18n = getI18n();

    authStore.showSnackbar(i18n.global.t('session_ended'), EColor.warning);

    await teardownClientSession({
      notifyPushServer: false,
    });

    setTimeout(() => {
      router.replace({ name: 'login' }).catch(() => {});
    }, 2000);
  };

  const handleUserChannelsUpdate = (data: {
    event: string;
    user_id: string;
    channels?: { id: string; name: string }[];
  }): void => {
    if (data.user_id !== chatStore.user?.user_id) return;

    const channels = Array.isArray(data.channels) ? data.channels : [];
    setChannels(channels);
    chatStore.revalidateChannelAccess();
  };

  await onMessage(channel, (data: any) => {
    if (!data || typeof data !== 'object') return;

    if ('event' in data && data.event === 'user_presence') {
      handleUserPresenceEvent(data);
    }

    if ('event' in data && data.event === 'force_logout') {
      handleForceLogoutEvent(data).catch(() => {});
    }

    if ('event' in data && data.event === 'user_channels_updated') {
      handleUserChannelsUpdate(data);
    }
  });
};
