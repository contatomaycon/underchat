import * as schema from '@core/models';
import { accountInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { currentTime } from '@core/common/functions/currentTime';
import { CreateAccountInfoRequest } from '@core/schema/account/createAccountInfo/request.schema';

@injectable()
export class AccountInfoCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private createInput(
    input: CreateAccountInfoRequest,
    urlLogo: string | null
  ): Partial<typeof accountInfo.$inferInsert> {
    const inputCreate: Partial<typeof accountInfo.$inferInsert> = {};

    if (urlLogo) {
      inputCreate.logo = urlLogo;
    }

    if (input.content_width.value) {
      inputCreate.content_width = input.content_width.value;
    }

    if (input.content_layout_nav.value) {
      inputCreate.content_layout_nav = input.content_layout_nav.value;
    }

    if (input.default_locale.value) {
      inputCreate.default_locale = input.default_locale.value;
    }

    if (input.skin.value) {
      inputCreate.skin = input.skin.value;
    }

    if (input.navbar.value) {
      inputCreate.navbar = input.navbar.value;
    }

    if (input.footer.value) {
      inputCreate.footer = input.footer.value;
    }

    if (typeof input.is_vertical_nav_collapsed.value === 'boolean') {
      inputCreate.is_vertical_nav_collapsed =
        input.is_vertical_nav_collapsed.value;
    }

    if (typeof input.is_vertical_nav_semi_dark.value === 'boolean') {
      inputCreate.is_vertical_nav_semi_dark =
        input.is_vertical_nav_semi_dark.value;
    }

    if (input.light_primary_color.value) {
      inputCreate.light_primary_color = input.light_primary_color.value;
    }

    if (input.light_secondary_color.value) {
      inputCreate.light_secondary_color = input.light_secondary_color.value;
    }

    if (input.dark_primary_color.value) {
      inputCreate.dark_primary_color = input.dark_primary_color.value;
    }

    if (input.dark_secondary_color.value) {
      inputCreate.dark_secondary_color = input.dark_secondary_color.value;
    }

    return inputCreate;
  }

  createAccountInfo = async (
    input: CreateAccountInfoRequest,
    urlLogo: string | null
  ): Promise<string | null> => {
    const createInput = this.createInput(input, urlLogo);
    const accountInfoId = uuidv7();
    const dataNow = currentTime();

    const result = await this.dbRw
      .insert(accountInfo)
      .values({
        ...createInput,
        account_id: input.account_id.value,
        account_info_id: accountInfoId,
        created_at: dataNow,
        updated_at: dataNow,
      })
      .execute();

    if (!result) {
      return null;
    }

    return accountInfoId;
  };
}
