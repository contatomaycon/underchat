import * as schema from '@core/models';
import { account, accountInfo } from '@core/models';
import { AccountInfoResponse } from '@core/schema/auth/login/response.schema';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class AccountInfoViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewAccountInfoByAccountId = async (
    accountId: string
  ): Promise<AccountInfoResponse | null> => {
    const result = await this.db
      .select({
        account_info_id: accountInfo.account_info_id,
        name: account.name,
        logo: accountInfo.logo,
        content_width: accountInfo.content_width,
        content_layout_nav: accountInfo.content_layout_nav,
        default_locale: accountInfo.default_locale,
        skin: accountInfo.skin,
        navbar: accountInfo.navbar,
        footer: accountInfo.footer,
        is_vertical_nav_collapsed: accountInfo.is_vertical_nav_collapsed,
        is_vertical_nav_semi_dark: accountInfo.is_vertical_nav_semi_dark,
        light_primary_color: accountInfo.light_primary_color,
        light_secondary_color: accountInfo.light_secondary_color,
        dark_primary_color: accountInfo.dark_primary_color,
        dark_secondary_color: accountInfo.dark_secondary_color,
      })
      .from(accountInfo)
      .innerJoin(account, eq(accountInfo.account_id, account.account_id))
      .where(and(eq(account.account_id, accountId), isNull(account.deleted_at)))
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0] as AccountInfoResponse;
  };
}
