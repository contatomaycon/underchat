import * as schema from '@core/models';
import { accountTest } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { or, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

@injectable()
export class AccountTestRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  findExistingTest = async (data: {
    documentC: string;
    phoneC: string;
    emailC: string;
  }): Promise<boolean> => {
    const existing = await this.db.query.accountTest.findFirst({
      where: or(
        eq(accountTest.document_c, data.documentC),
        eq(accountTest.phone_c, data.phoneC),
        eq(accountTest.email_c, data.emailC)
      ),
    });

    return !!existing;
  };

  createAccountTest = async (data: {
    document: string;
    documentC: string;
    phone: string;
    phoneC: string;
    email: string;
    emailC: string;
  }): Promise<string> => {
    const accountTestId = randomUUID();
    const now = new Date().toISOString();

    await this.db.insert(accountTest).values({
      account_test_id: accountTestId,
      document: data.document,
      document_c: data.documentC,
      phone: data.phone,
      phone_c: data.phoneC,
      email: data.email,
      email_c: data.emailC,
      created_at: now,
      updated_at: now,
    });

    return accountTestId;
  };
}
