import * as schema from '@core/models';
import { user, chatUser } from '@core/models';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';

export type ChatNotificationPreferences = {
  notifications?: boolean | null;
  notifications_push?: boolean | null;
  notifications_sound?: boolean | null;
  notifications_vibrate?: boolean | null;
  notifications_message_queue?: boolean | null;
  notifications_message_in_chat?: boolean | null;
  notifications_message_chatbot?: boolean | null;
  notifications_transfer?: boolean | null;
};

export type InternalChatNotificationPreferences = {
  notifications_internal_chat?: boolean | null;
  notifications_internal_chat_push?: boolean | null;
  notifications_internal_chat_sound?: boolean | null;
  notifications_internal_chat_vibrate?: boolean | null;
  notifications_internal_chat_direct?: boolean | null;
  notifications_internal_chat_group?: boolean | null;
};

export type PushNotificationRecipient = {
  user_id: string;
  notifications_sound: boolean;
  notifications_vibrate: boolean;
};

export function isChatbotNotificationStatus(status?: EChatStatus): boolean {
  return (
    status === EChatStatus.ura ||
    status === EChatStatus.ura_output ||
    status === EChatStatus.ura_schedule ||
    status === EChatStatus.ura_webhook
  );
}

export function canReceivePushForChatMessage(
  preferences: ChatNotificationPreferences,
  status?: EChatStatus
): boolean {
  if (preferences.notifications !== true) {
    return false;
  }

  if (preferences.notifications_push !== true) {
    return false;
  }

  if (status === EChatStatus.queue) {
    return preferences.notifications_message_queue === true;
  }

  if (status === EChatStatus.in_chat) {
    return preferences.notifications_message_in_chat === true;
  }

  if (isChatbotNotificationStatus(status)) {
    return preferences.notifications_message_chatbot === true;
  }

  return true;
}

export function canReceivePushForChatTransfer(
  preferences: ChatNotificationPreferences
): boolean {
  return (
    preferences.notifications === true &&
    preferences.notifications_push === true &&
    preferences.notifications_transfer === true
  );
}

@injectable()
export class UsersWithNotificationsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listUsersWithNotifications = async (
    accountId: string,
    status?: EChatStatus,
    candidateUserIds?: string[]
  ): Promise<PushNotificationRecipient[]> => {
    if (candidateUserIds && candidateUserIds.length === 0) {
      return [];
    }

    let whereClause = and(
      eq(user.account_id, accountId),
      eq(chatUser.notifications, true),
      eq(chatUser.notifications_push, true),
      isNull(user.deleted_at)
    );

    if (candidateUserIds) {
      whereClause = and(whereClause, inArray(user.user_id, candidateUserIds));
    }

    if (status === EChatStatus.queue) {
      whereClause = and(
        whereClause,
        eq(chatUser.notifications_message_queue, true)
      );
    }

    if (status === EChatStatus.in_chat) {
      whereClause = and(
        whereClause,
        eq(chatUser.notifications_message_in_chat, true)
      );
    }

    if (isChatbotNotificationStatus(status)) {
      whereClause = and(
        whereClause,
        eq(chatUser.notifications_message_chatbot, true)
      );
    }

    const result = await this.dbRo
      .select({
        user_id: user.user_id,
        notifications_sound: chatUser.notifications_sound,
        notifications_vibrate: chatUser.notifications_vibrate,
      })
      .from(user)
      .innerJoin(chatUser, eq(chatUser.user_id, user.user_id))
      .where(whereClause)
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((row) => ({
      user_id: row.user_id,
      notifications_sound: row.notifications_sound !== false,
      notifications_vibrate: row.notifications_vibrate === true,
    }));
  };

  listUsersWithTransferNotifications = async (
    accountId: string,
    candidateUserIds: string[]
  ): Promise<PushNotificationRecipient[]> => {
    if (candidateUserIds.length === 0) {
      return [];
    }

    const result = await this.dbRo
      .select({
        user_id: user.user_id,
        notifications_sound: chatUser.notifications_sound,
        notifications_vibrate: chatUser.notifications_vibrate,
      })
      .from(user)
      .innerJoin(chatUser, eq(chatUser.user_id, user.user_id))
      .where(
        and(
          eq(user.account_id, accountId),
          inArray(user.user_id, candidateUserIds),
          eq(chatUser.notifications, true),
          eq(chatUser.notifications_push, true),
          eq(chatUser.notifications_transfer, true),
          isNull(user.deleted_at)
        )
      )
      .execute();

    return result.map((row) => ({
      user_id: row.user_id,
      notifications_sound: row.notifications_sound !== false,
      notifications_vibrate: row.notifications_vibrate === true,
    }));
  };

  listInternalChatUsersWithNotifications = async (
    accountId: string,
    participantUserIds: string[],
    conversationType: EInternalChatConversationType
  ): Promise<PushNotificationRecipient[]> => {
    if (participantUserIds.length === 0) {
      return [];
    }

    const typeToggle =
      conversationType === EInternalChatConversationType.group
        ? chatUser.notifications_internal_chat_group
        : chatUser.notifications_internal_chat_direct;

    const result = await this.dbRo
      .select({
        user_id: user.user_id,
        notifications_sound: chatUser.notifications_internal_chat_sound,
        notifications_vibrate: chatUser.notifications_internal_chat_vibrate,
      })
      .from(user)
      .innerJoin(chatUser, eq(chatUser.user_id, user.user_id))
      .where(
        and(
          eq(user.account_id, accountId),
          inArray(user.user_id, participantUserIds),
          eq(chatUser.notifications_internal_chat, true),
          eq(chatUser.notifications_internal_chat_push, true),
          eq(typeToggle, true),
          isNull(user.deleted_at)
        )
      )
      .execute();

    return result.map((row) => ({
      user_id: row.user_id,
      notifications_sound: row.notifications_sound !== false,
      notifications_vibrate: row.notifications_vibrate === true,
    }));
  };
}
