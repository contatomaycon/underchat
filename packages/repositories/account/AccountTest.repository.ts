import * as schema from '@core/models';
import { accountTest } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, or, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

@injectable()
export class AccountTestRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  findExistingTest = async (data: {
    documentC: string;
    phoneC: string;
    emailC: string;
  }): Promise<boolean> => {
    const existing = await this.dbRo.query.accountTest.findFirst({
      where: or(
        eq(accountTest.document_c, data.documentC),
        eq(accountTest.phone_c, data.phoneC),
        eq(accountTest.email_c, data.emailC)
      ),
    });

    return !!existing;
  };

  findExistingCreatedTest = async (data: {
    documentC: string;
    phoneC: string;
    emailC: string;
  }): Promise<boolean> => {
    const existing = await this.dbRo.query.accountTest.findFirst({
      where: and(
        eq(accountTest.status, 'created'),
        or(
          eq(accountTest.document_c, data.documentC),
          eq(accountTest.phone_c, data.phoneC),
          eq(accountTest.email_c, data.emailC)
        )
      ),
    });

    return !!existing;
  };

  findExistingTestByPhone = async (phoneC: string): Promise<boolean> => {
    const existing = await this.dbRo.query.accountTest.findFirst({
      where: eq(accountTest.phone_c, phoneC),
    });

    return !!existing;
  };

  findExistingTestByEmail = async (emailC: string): Promise<boolean> => {
    const existing = await this.dbRo.query.accountTest.findFirst({
      where: eq(accountTest.email_c, emailC),
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

    await this.dbRw.insert(accountTest).values({
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

  deleteValidatedReservationsByContact = async (data: {
    phoneC: string;
    emailC: string;
  }): Promise<number> => {
    const result = await this.dbRw
      .delete(accountTest)
      .where(
        and(
          eq(accountTest.status, 'validated'),
          or(
            eq(accountTest.phone_c, data.phoneC),
            eq(accountTest.email_c, data.emailC)
          )
        )
      )
      .returning({ account_test_id: accountTest.account_test_id });

    return result.length;
  };
}
