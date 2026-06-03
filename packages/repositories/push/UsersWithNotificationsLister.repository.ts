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
  notifications_status_update?: boolean | null;
  notifications_status_queue?: boolean | null;
  notifications_status_in_chat?: boolean | null;
  notifications_status_chatbot?: boolean | null;
  notifications_message_queue?: boolean | null;
  notifications_message_in_chat?: boolean | null;
  notifications_message_chatbot?: boolean | null;
  notifications_transfer?: boolean | null;
};

export type ChatNotificationScope = 'message' | 'status';

export type InternalChatNotificationPreferences = {
  notifications_internal_chat?: boolean | null;
  notifications_internal_chat_push?: boolean | null;
  notifications_internal_chat_direct?: boolean | null;
  notifications_internal_chat_group?: boolean | null;
};

export function isChatbotNotificationStatus(status?: EChatStatus): boolean {
  return (
    status === EChatStatus.ura ||
    status === EChatStatus.ura_output ||
    status === EChatStatus.ura_schedule ||
    status === EChatStatus.ura_webhook
  );
}

export function canReceivePushForChatStatus(
  preferences: ChatNotificationPreferences,
  status?: EChatStatus,
  scope: ChatNotificationScope = 'message'
): boolean {
  if (preferences.notifications !== true) {
    return false;
  }

  if (preferences.notifications_push !== true) {
    return false;
  }

  if (scope === 'status') {
    if (preferences.notifications_status_update !== true) {
      return false;
    }

    if (status === EChatStatus.queue) {
      return preferences.notifications_status_queue === true;
    }

    if (status === EChatStatus.in_chat) {
      return preferences.notifications_status_in_chat === true;
    }

    if (isChatbotNotificationStatus(status)) {
      return preferences.notifications_status_chatbot === true;
    }

    return true;
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

@injectable()
export class UsersWithNotificationsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listUsersWithNotifications = async (
    accountId: string,
    status?: EChatStatus,
    scopeOrRequireStatusUpdateToggle:
      | ChatNotificationScope
      | boolean = 'message'
  ): Promise<string[]> => {
    const scope: ChatNotificationScope =
      scopeOrRequireStatusUpdateToggle === true
        ? 'status'
        : scopeOrRequireStatusUpdateToggle === false
          ? 'message'
          : scopeOrRequireStatusUpdateToggle;

    let whereClause = and(
      eq(user.account_id, accountId),
      eq(chatUser.notifications, true),
      eq(chatUser.notifications_push, true),
      isNull(user.deleted_at)
    );

    if (status === EChatStatus.queue) {
      whereClause =
        scope === 'status'
          ? and(
              whereClause,
              eq(chatUser.notifications_status_update, true),
              eq(chatUser.notifications_status_queue, true)
            )
          : and(whereClause, eq(chatUser.notifications_message_queue, true));
    }

    if (status === EChatStatus.in_chat) {
      whereClause =
        scope === 'status'
          ? and(
              whereClause,
              eq(chatUser.notifications_status_update, true),
              eq(chatUser.notifications_status_in_chat, true)
            )
          : and(whereClause, eq(chatUser.notifications_message_in_chat, true));
    }

    if (isChatbotNotificationStatus(status)) {
      whereClause =
        scope === 'status'
          ? and(
              whereClause,
              eq(chatUser.notifications_status_update, true),
              eq(chatUser.notifications_status_chatbot, true)
            )
          : and(whereClause, eq(chatUser.notifications_message_chatbot, true));
    }

    const result = await this.dbRo
      .select({
        user_id: user.user_id,
      })
      .from(user)
      .innerJoin(chatUser, eq(chatUser.user_id, user.user_id))
      .where(whereClause)
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((row) => row.user_id);
  };

  listUsersWithTransferNotifications = async (
    accountId: string,
    candidateUserIds: string[]
  ): Promise<string[]> => {
    if (candidateUserIds.length === 0) {
      return [];
    }

    const result = await this.dbRo
      .select({
        user_id: user.user_id,
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

    return result.map((row) => row.user_id);
  };

  listInternalChatUsersWithNotifications = async (
    accountId: string,
    participantUserIds: string[],
    conversationType: EInternalChatConversationType
  ): Promise<string[]> => {
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

    return result.map((row) => row.user_id);
  };
}
