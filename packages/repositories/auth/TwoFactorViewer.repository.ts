import * as schema from '@core/models';
import { twoFactor } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ITwoFactorData } from '@core/common/interfaces/ITwoFactorData';
import { IFindTwoFactorByCodeAndEmailPhone } from '@core/common/interfaces/IFindTwoFactorByCodeAndEmailPhone';
import { IFindTwoFactorByTokenAndEmailPhone } from '@core/common/interfaces/IFindTwoFactorByTokenAndEmailPhone';

@injectable()
export class TwoFactorViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  findTwoFactorByCodeAndEmailPhone = async (
    data: IFindTwoFactorByCodeAndEmailPhone
  ): Promise<ITwoFactorData | null> => {
    const conditions = [
      eq(twoFactor.email_c, data.emailC),
      eq(twoFactor.phone_c, data.phoneC),
    ];

    if (data.code) {
      conditions.push(eq(twoFactor.code, data.code));
    }

    const result = await this.dbRo
      .select({
        two_factor_id: twoFactor.two_factor_id,
        user_id: twoFactor.user_id,
        phone_ddi: twoFactor.phone_ddi,
        phone: twoFactor.phone,
        phone_c: twoFactor.phone_c,
        email: twoFactor.email,
        email_c: twoFactor.email_c,
        code: twoFactor.code,
        token: twoFactor.token,
        created_at: twoFactor.created_at,
        deleted_at: twoFactor.deleted_at,
      })
      .from(twoFactor)
      .where(and(...conditions, isNull(twoFactor.deleted_at)))
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0];
  };

  findTwoFactorByTokenAndEmailPhone = async (
    data: IFindTwoFactorByTokenAndEmailPhone
  ): Promise<ITwoFactorData | null> => {
    const result = await this.dbRo
      .select({
        two_factor_id: twoFactor.two_factor_id,
        user_id: twoFactor.user_id,
        phone_ddi: twoFactor.phone_ddi,
        phone: twoFactor.phone,
        phone_c: twoFactor.phone_c,
        email: twoFactor.email,
        email_c: twoFactor.email_c,
        code: twoFactor.code,
        token: twoFactor.token,
        created_at: twoFactor.created_at,
        deleted_at: twoFactor.deleted_at,
      })
      .from(twoFactor)
      .where(
        and(
          eq(twoFactor.token, data.token),
          eq(twoFactor.email_c, data.emailC),
          eq(twoFactor.phone_c, data.phoneC)
        )
      )
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0];
  };

  findTwoFactorByCode = async (
    code: string
  ): Promise<ITwoFactorData | null> => {
    const result = await this.dbRo
      .select({
        two_factor_id: twoFactor.two_factor_id,
        user_id: twoFactor.user_id,
        phone_ddi: twoFactor.phone_ddi,
        phone: twoFactor.phone,
        phone_c: twoFactor.phone_c,
        email: twoFactor.email,
        email_c: twoFactor.email_c,
        code: twoFactor.code,
        token: twoFactor.token,
        created_at: twoFactor.created_at,
        deleted_at: twoFactor.deleted_at,
      })
      .from(twoFactor)
      .where(and(eq(twoFactor.code, code), isNull(twoFactor.deleted_at)))
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0];
  };
}
