import * as schema from '@core/models';
import { twoFactor } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { randomUUID } from 'node:crypto';

@injectable()
export class TwoFactorCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createTwoFactor = async (data: {
    userId?: string | null;
    phoneDdi?: string | null;
    phone?: string | null;
    phonePartial?: string | null;
    phoneC?: string | null;
    email?: string | null;
    emailPartial?: string | null;
    emailC?: string | null;
    code: string;
    token: string;
  }): Promise<string> => {
    const twoFactorId = randomUUID();
    const now = new Date().toISOString();

    await this.db.insert(twoFactor).values({
      two_factor_id: twoFactorId,
      user_id: data.userId || null,
      phone_ddi: data.phoneDdi || null,
      phone: data.phone || null,
      phone_partial: data.phonePartial || null,
      phone_c: data.phoneC || null,
      email: data.email || null,
      email_partial: data.emailPartial || null,
      email_c: data.emailC || null,
      code: data.code,
      token: data.token,
      created_at: now,
    });

    return twoFactorId;
  };
}
