import * as schema from '@core/models';
import { chatUser } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { ExtractTablesWithRelations, eq } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { ChatNotificationSettingsRequest } from '@core/schema/chat/notificationSettings/request.schema';
import { ChatNotificationSettingsData } from '@core/schema/chat/notificationSettings/response.schema';

type DatabaseTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

@injectable()
export class ChatNotificationSettingsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private selectSettings(
    db: NodePgDatabase<typeof schema> | DatabaseTransaction,
    userId: string
  ) {
    return db
      .select({
        chat_user_id: chatUser.chat_user_id,
        notifications: chatUser.notifications,
        notifications_sound: chatUser.notifications_sound,
        notifications_vibrate: chatUser.notifications_vibrate,
        notifications_toast: chatUser.notifications_toast,
        notifications_browser: chatUser.notifications_browser,
        notifications_push: chatUser.notifications_push,
        notifications_message_queue: chatUser.notifications_message_queue,
        notifications_message_in_chat: chatUser.notifications_message_in_chat,
        notifications_message_chatbot: chatUser.notifications_message_chatbot,
        notifications_transfer: chatUser.notifications_transfer,
      })
      .from(chatUser)
      .where(eq(chatUser.user_id, userId))
      .limit(1)
      .execute();
  }

  private buildUpdateInput(
    input: ChatNotificationSettingsRequest
  ): Partial<typeof chatUser.$inferInsert> {
    const updateInput: Partial<typeof chatUser.$inferInsert> = {};
    const keys = [
      'notifications',
      'notifications_sound',
      'notifications_vibrate',
      'notifications_toast',
      'notifications_browser',
      'notifications_push',
      'notifications_message_queue',
      'notifications_message_in_chat',
      'notifications_message_chatbot',
      'notifications_transfer',
    ] as const;

    for (const key of keys) {
      if (input[key] !== undefined) {
        updateInput[key] = input[key];
      }
    }

    if (input.notifications === false) {
      updateInput.notifications_sound = false;
      updateInput.notifications_vibrate = false;
      updateInput.notifications_toast = false;
      updateInput.notifications_browser = false;
      updateInput.notifications_push = false;
      updateInput.notifications_message_queue = false;
      updateInput.notifications_message_in_chat = false;
      updateInput.notifications_message_chatbot = false;
      updateInput.notifications_transfer = false;
    }

    return updateInput;
  }

  private normalizeSettings(
    row: ChatNotificationSettingsData | undefined
  ): ChatNotificationSettingsData | null {
    if (!row) {
      return null;
    }

    return {
      chat_user_id: row.chat_user_id,
      notifications: row.notifications !== false,
      notifications_sound: row.notifications_sound !== false,
      notifications_vibrate: row.notifications_vibrate === true,
      notifications_toast: row.notifications_toast !== false,
      notifications_browser: row.notifications_browser !== false,
      notifications_push: row.notifications_push !== false,
      notifications_message_queue: row.notifications_message_queue === true,
      notifications_message_in_chat:
        row.notifications_message_in_chat !== false,
      notifications_message_chatbot: row.notifications_message_chatbot === true,
      notifications_transfer: row.notifications_transfer !== false,
    };
  }

  async viewByUserId(userId: string): Promise<ChatNotificationSettingsData> {
    const existing = this.normalizeSettings(
      (await this.selectSettings(this.dbRo, userId))[0]
    );

    if (existing) {
      return existing;
    }

    return this.dbRw.transaction(async (tx) => {
      await this.ensureChatUser(tx, userId);
      const created = this.normalizeSettings(
        (await this.selectSettings(tx, userId))[0]
      );

      if (!created) {
        throw new Error('chat_update_error');
      }

      return created;
    });
  }

  async updateByUserId(
    userId: string,
    input: ChatNotificationSettingsRequest
  ): Promise<ChatNotificationSettingsData> {
    return this.dbRw.transaction(async (tx) => {
      await this.ensureChatUser(tx, userId);
      const updateInput = this.buildUpdateInput(input);

      if (Object.keys(updateInput).length > 0) {
        await tx
          .update(chatUser)
          .set({
            ...updateInput,
            updated_at: new Date().toISOString(),
          })
          .where(eq(chatUser.user_id, userId))
          .execute();
      }

      const updated = this.normalizeSettings(
        (await this.selectSettings(tx, userId))[0]
      );

      if (!updated) {
        throw new Error('chat_update_error');
      }

      return updated;
    });
  }

  private async ensureChatUser(
    tx: DatabaseTransaction,
    userId: string
  ): Promise<void> {
    const existing = await this.selectSettings(tx, userId);

    if (existing[0]) {
      return;
    }

    await tx
      .insert(chatUser)
      .values({
        chat_user_id: uuidv7(),
        user_id: userId,
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
      })
      .execute();
  }
}
