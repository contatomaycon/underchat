import * as schema from '@core/models';
import { user, userInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { IUpdateUserInfo } from '@core/common/interfaces/IUpdateUserInfo';
import {
  assertCurrentWhatsappRuntimeInTransaction,
  type WhatsappRuntimeDatabaseFence,
} from '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository';

@injectable()
export class UserInfoUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: IUpdateUserInfo
  ): Partial<typeof userInfo.$inferInsert> {
    const inputUpdate: Partial<typeof userInfo.$inferInsert> = {};

    if (input.phone_ddi !== undefined) {
      inputUpdate.phone_ddi = input.phone_ddi;
    }

    if (input.phone !== undefined) {
      inputUpdate.phone = input.phone;
    }

    if (input.phone_partial !== undefined) {
      inputUpdate.phone_partial = input.phone_partial;
    }

    if (input.phone_c !== undefined) {
      inputUpdate.phone_c = input.phone_c;
    }

    if (input.name) {
      inputUpdate.name = input.name;
    }

    if (input.last_name) {
      inputUpdate.last_name = input.last_name;
    }

    if (input.birth_date) {
      inputUpdate.birth_date = input.birth_date;
    }

    if (input.photo !== undefined) {
      inputUpdate.photo = input.photo;
    }

    return inputUpdate;
  }

  updateUserInfoById = async (
    userId: string,
    input: IUpdateUserInfo
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.dbRw
      .update(userInfo)
      .set(updateInput)
      .where(eq(userInfo.user_id, userId))
      .execute();

    return result.rowCount === 1;
  };

  updatePhoneJidById = async (
    userId: string,
    phoneJid: string,
    runtimeFence: WhatsappRuntimeDatabaseFence,
    assertActive?: () => void | Promise<void>
  ): Promise<boolean> => {
    await assertActive?.();

    return this.dbRw.transaction(async (tx) => {
      await assertCurrentWhatsappRuntimeInTransaction(tx, runtimeFence);
      await assertActive?.();

      const scopedUsers = await tx
        .select({ user_id: user.user_id })
        .from(user)
        .where(
          and(
            eq(user.user_id, userId),
            eq(user.account_id, runtimeFence.account_id),
            isNull(user.deleted_at)
          )
        )
        .for('share')
        .limit(1)
        .execute();
      if (!scopedUsers[0]) {
        return false;
      }

      const liveUserInfos = await tx
        .select({ user_info_id: userInfo.user_info_id })
        .from(userInfo)
        .where(and(eq(userInfo.user_id, userId), isNull(userInfo.deleted_at)))
        .for('update')
        .limit(2)
        .execute();

      // A phone identity must resolve to one live row. Refuse to mutate an
      // ambiguous/corrupt user instead of updating multiple historical rows.
      if (liveUserInfos.length !== 1) {
        return false;
      }

      await assertActive?.();
      const result = await tx
        .update(userInfo)
        .set({ phone_jid: phoneJid })
        .where(
          and(
            eq(userInfo.user_info_id, liveUserInfos[0].user_info_id),
            isNull(userInfo.deleted_at)
          )
        )
        .execute();
      await assertActive?.();

      return (result.rowCount ?? 0) > 0;
    });
  };
}
