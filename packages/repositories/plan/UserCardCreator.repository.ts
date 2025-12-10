import * as schema from '@core/models';
import { userCard } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { randomUUID } from 'node:crypto';

@injectable()
export class UserCardCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createUserCard = async (data: {
    userId: string;
    token: string;
    holderName: string;
    lastNumber: string;
    brand: string;
    isDefault?: boolean;
  }): Promise<string> => {
    const userCardId = randomUUID();

    await this.db.insert(userCard).values({
      user_card_id: userCardId,
      user_id: data.userId,
      token: data.token,
      holder_name: data.holderName,
      last_number: data.lastNumber,
      brand: data.brand,
      default: data.isDefault || false,
    });

    return userCardId;
  };
}
