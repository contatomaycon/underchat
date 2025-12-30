import * as schema from '@core/models';
import { twoFactor } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class TwoFactorUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updateDeletedAt = async (
    twoFactorId: string,
    deletedAt: string
  ): Promise<void> => {
    await this.db
      .update(twoFactor)
      .set({
        deleted_at: deletedAt,
        updated_at: deletedAt,
      })
      .where(eq(twoFactor.two_factor_id, twoFactorId));
  };
}
