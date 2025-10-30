import * as schema from '@core/models';
import { accountInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { EditAccountInfoResponse } from '@core/core/schema/account/editAccountInfo/request.schema';

@injectable()
export class AccountInfoUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: EditAccountInfoResponse,
    urlLogo: string | null
  ): Partial<typeof accountInfo.$inferInsert> {
    const inputUpdate: Partial<typeof accountInfo.$inferInsert> = {};

    if (urlLogo !== null) {
      inputUpdate.logo = urlLogo;
    }

    if (input.content_width.value) {
      inputUpdate.content_width = input.content_width.value;
    }

    if (input.content_layout_nav.value) {
      inputUpdate.content_layout_nav = input.content_layout_nav.value;
    }

    if (input.default_locale.value) {
      inputUpdate.default_locale = input.default_locale.value;
    }

    if (input.skin.value) {
      inputUpdate.skin = input.skin.value;
    }

    if (input.navbar.value) {
      inputUpdate.navbar = input.navbar.value;
    }

    if (input.footer.value) {
      inputUpdate.footer = input.footer.value;
    }

    if (typeof input.is_vertical_nav_collapsed.value === 'boolean') {
      inputUpdate.is_vertical_nav_collapsed =
        input.is_vertical_nav_collapsed.value;
    }

    if (typeof input.is_vertical_nav_semi_dark.value === 'boolean') {
      inputUpdate.is_vertical_nav_semi_dark =
        input.is_vertical_nav_semi_dark.value;
    }

    if (input.light_primary_color.value) {
      inputUpdate.light_primary_color = input.light_primary_color.value;
    }

    if (input.light_secondary_color.value) {
      inputUpdate.light_secondary_color = input.light_secondary_color.value;
    }

    if (input.dark_primary_color.value) {
      inputUpdate.dark_primary_color = input.dark_primary_color.value;
    }

    if (input.dark_secondary_color.value) {
      inputUpdate.dark_secondary_color = input.dark_secondary_color.value;
    }

    return inputUpdate;
  }

  updateAccountInfoById = async (
    accountInfoId: string,
    input: EditAccountInfoResponse,
    urlLogo: string | null
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input, urlLogo);

    const result = await this.db
      .update(accountInfo)
      .set(updateInput)
      .where(eq(accountInfo.account_info_id, accountInfoId))
      .execute();

    return result.rowCount === 1;
  };
}
