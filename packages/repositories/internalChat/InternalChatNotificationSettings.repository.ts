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
import { InternalChatNotificationSettingsRequest } from '@core/schema/internalChat/notificationSettings/request.schema';
import { InternalChatNotificationSettingsData } from '@core/schema/internalChat/notificationSettings/response.schema';

type DatabaseTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

@injectable()
export class InternalChatNotificationSettingsRepository {
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
        notifications_internal_chat: chatUser.notifications_internal_chat,
        notifications_internal_chat_direct:
          chatUser.notifications_internal_chat_direct,
        notifications_internal_chat_group:
          chatUser.notifications_internal_chat_group,
        notifications_internal_chat_sound:
          chatUser.notifications_internal_chat_sound,
        notifications_internal_chat_toast:
          chatUser.notifications_internal_chat_toast,
        notifications_internal_chat_browser:
          chatUser.notifications_internal_chat_browser,
        notifications_internal_chat_push:
          chatUser.notifications_internal_chat_push,
      })
      .from(chatUser)
      .where(eq(chatUser.user_id, userId))
      .limit(1)
      .execute();
  }

  private buildUpdateInput(
    input: InternalChatNotificationSettingsRequest
  ): Partial<typeof chatUser.$inferInsert> {
    const updateInput: Partial<typeof chatUser.$inferInsert> = {};

    if (input.notifications_internal_chat !== undefined) {
      updateInput.notifications_internal_chat =
        input.notifications_internal_chat;
    }

    if (input.notifications_internal_chat_direct !== undefined) {
      updateInput.notifications_internal_chat_direct =
        input.notifications_internal_chat_direct;
    }

    if (input.notifications_internal_chat_group !== undefined) {
      updateInput.notifications_internal_chat_group =
        input.notifications_internal_chat_group;
    }

    if (input.notifications_internal_chat_sound !== undefined) {
      updateInput.notifications_internal_chat_sound =
        input.notifications_internal_chat_sound;
    }

    if (input.notifications_internal_chat_toast !== undefined) {
      updateInput.notifications_internal_chat_toast =
        input.notifications_internal_chat_toast;
    }

    if (input.notifications_internal_chat_browser !== undefined) {
      updateInput.notifications_internal_chat_browser =
        input.notifications_internal_chat_browser;
    }

    if (input.notifications_internal_chat_push !== undefined) {
      updateInput.notifications_internal_chat_push =
        input.notifications_internal_chat_push;
    }

    return updateInput;
  }

  private normalizeSettings(
    row: InternalChatNotificationSettingsData | undefined
  ): InternalChatNotificationSettingsData | null {
    if (!row) {
      return null;
    }

    return {
      chat_user_id: row.chat_user_id,
      notifications_internal_chat: row.notifications_internal_chat !== false,
      notifications_internal_chat_direct:
        row.notifications_internal_chat_direct !== false,
      notifications_internal_chat_group:
        row.notifications_internal_chat_group !== false,
      notifications_internal_chat_sound:
        row.notifications_internal_chat_sound !== false,
      notifications_internal_chat_toast:
        row.notifications_internal_chat_toast !== false,
      notifications_internal_chat_browser:
        row.notifications_internal_chat_browser !== false,
      notifications_internal_chat_push:
        row.notifications_internal_chat_push !== false,
    };
  }

  async viewByUserId(
    userId: string
  ): Promise<InternalChatNotificationSettingsData> {
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
    input: InternalChatNotificationSettingsRequest
  ): Promise<InternalChatNotificationSettingsData> {
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
        notifications_toast: true,
        notifications_browser: true,
        notifications_push: true,
        notifications_status_update: true,
        notifications_status_queue: false,
        notifications_status_in_chat: true,
        notifications_status_chatbot: false,
        notifications_internal_chat: true,
        notifications_internal_chat_direct: true,
        notifications_internal_chat_group: true,
        notifications_internal_chat_sound: true,
        notifications_internal_chat_toast: true,
        notifications_internal_chat_browser: true,
        notifications_internal_chat_push: true,
      })
      .execute();
  }
}
