import * as schema from '@core/models';
import { accountInfo } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { currentTime } from '@core/common/functions/currentTime';
import { EditAccountInfoRequest } from '@core/schema/account/editAccountInfo/request.schema';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class AccountInfoUpserterTransactionRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private buildUpdateInput(
    input: EditAccountInfoRequest,
    urlLogo: string | null | undefined
  ): Partial<typeof accountInfo.$inferInsert> {
    const updateInput: Partial<typeof accountInfo.$inferInsert> = {
      updated_at: currentTime(),
    };

    if (urlLogo !== undefined) {
      updateInput.logo = urlLogo;
    }

    if (input.content_width.value) {
      updateInput.content_width = input.content_width.value;
    }

    if (input.content_layout_nav.value) {
      updateInput.content_layout_nav = input.content_layout_nav.value;
    }

    if (input.default_locale.value) {
      updateInput.default_locale = input.default_locale.value;
    }

    if (input.skin.value) {
      updateInput.skin = input.skin.value;
    }

    if (input.navbar.value) {
      updateInput.navbar = input.navbar.value;
    }

    if (input.footer.value) {
      updateInput.footer = input.footer.value;
    }

    if (typeof input.is_vertical_nav_collapsed.value === 'boolean') {
      updateInput.is_vertical_nav_collapsed =
        input.is_vertical_nav_collapsed.value;
    }

    if (typeof input.is_vertical_nav_semi_dark.value === 'boolean') {
      updateInput.is_vertical_nav_semi_dark =
        input.is_vertical_nav_semi_dark.value;
    }

    if (input.light_primary_color.value) {
      updateInput.light_primary_color = input.light_primary_color.value;
    }

    if (input.light_secondary_color.value) {
      updateInput.light_secondary_color = input.light_secondary_color.value;
    }

    if (input.dark_primary_color.value) {
      updateInput.dark_primary_color = input.dark_primary_color.value;
    }

    if (input.dark_secondary_color.value) {
      updateInput.dark_secondary_color = input.dark_secondary_color.value;
    }

    return updateInput;
  }

  private buildCreateInput(
    input: EditAccountInfoRequest,
    urlLogo: string | null
  ): Partial<typeof accountInfo.$inferInsert> {
    const createInput: Partial<typeof accountInfo.$inferInsert> = {};

    if (urlLogo) {
      createInput.logo = urlLogo;
    }

    if (input.content_width.value) {
      createInput.content_width = input.content_width.value;
    }

    if (input.content_layout_nav.value) {
      createInput.content_layout_nav = input.content_layout_nav.value;
    }

    if (input.default_locale.value) {
      createInput.default_locale = input.default_locale.value;
    }

    if (input.skin.value) {
      createInput.skin = input.skin.value;
    }

    if (input.navbar.value) {
      createInput.navbar = input.navbar.value;
    }

    if (input.footer.value) {
      createInput.footer = input.footer.value;
    }

    if (typeof input.is_vertical_nav_collapsed.value === 'boolean') {
      createInput.is_vertical_nav_collapsed =
        input.is_vertical_nav_collapsed.value;
    }

    if (typeof input.is_vertical_nav_semi_dark.value === 'boolean') {
      createInput.is_vertical_nav_semi_dark =
        input.is_vertical_nav_semi_dark.value;
    }

    if (input.light_primary_color.value) {
      createInput.light_primary_color = input.light_primary_color.value;
    }

    if (input.light_secondary_color.value) {
      createInput.light_secondary_color = input.light_secondary_color.value;
    }

    if (input.dark_primary_color.value) {
      createInput.dark_primary_color = input.dark_primary_color.value;
    }

    if (input.dark_secondary_color.value) {
      createInput.dark_secondary_color = input.dark_secondary_color.value;
    }

    return createInput;
  }

  private findExistingAccountInfo = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    accountId: string
  ) => {
    return tx.query.accountInfo.findFirst({
      where: and(
        eq(accountInfo.account_id, accountId),
        isNull(accountInfo.deleted_at)
      ),
      columns: {
        account_info_id: true,
      },
    });
  };

  upsertAccountInfo = async (
    accountId: string,
    input: EditAccountInfoRequest,
    urlLogo: string | null | undefined
  ): Promise<{ accountInfoId: string; created: boolean }> => {
    return this.db.transaction(async (tx) => {
      const existingAccountInfo = await this.findExistingAccountInfo(
        tx,
        accountId
      );

      if (existingAccountInfo) {
        const updateInput = this.buildUpdateInput(input, urlLogo);

        await tx
          .update(accountInfo)
          .set(updateInput)
          .where(
            eq(accountInfo.account_info_id, existingAccountInfo.account_info_id)
          )
          .execute();

        return {
          accountInfoId: existingAccountInfo.account_info_id,
          created: false,
        };
      }

      const accountInfoId = uuidv7();
      const createInput = this.buildCreateInput(input, urlLogo ?? null);
      const timestamp = currentTime();

      await tx
        .insert(accountInfo)
        .values({
          ...createInput,
          account_id: accountId,
          account_info_id: accountInfoId,
          created_at: timestamp,
          updated_at: timestamp,
        })
        .execute();

      return {
        accountInfoId,
        created: true,
      };
    });
  };
}
