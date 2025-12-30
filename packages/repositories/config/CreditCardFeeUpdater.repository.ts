import * as schema from '@core/models';
import { creditCardFee } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { ExtractTablesWithRelations, eq } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import { TFunction } from 'i18next';
import { UpdateCreditCardFeeRequest } from '@core/schema/config/updateCreditCardFee/request.schema';
import { UpdateCreditCardFeeResponse } from '@core/schema/config/updateCreditCardFee/response.schema';

@injectable()
export class CreditCardFeeUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  upsertCreditCardFee = async (
    t: TFunction<'translation', undefined>,
    input: UpdateCreditCardFeeRequest
  ): Promise<UpdateCreditCardFeeResponse> => {
    return this.db.transaction(async (tx) => {
      const existing = await this.findExistingCreditCardFeeTx(tx);
      if (existing) {
        return this.updateCreditCardFeeTx(
          tx,
          existing.credit_card_fee_id,
          input,
          t
        );
      }
      return this.createCreditCardFeeTx(tx, input, t);
    });
  };

  private async findExistingCreditCardFeeTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >
  ): Promise<{ credit_card_fee_id: string } | null> {
    const result = await tx
      .select({
        credit_card_fee_id: creditCardFee.credit_card_fee_id,
      })
      .from(creditCardFee)
      .limit(1)
      .execute();

    if (result.length < 1) {
      return null;
    }

    return result[0];
  }

  private buildInsertData(
    input: UpdateCreditCardFeeRequest
  ): typeof creditCardFee.$inferInsert {
    return {
      credit_card_fee_id: randomUUID(),
      installment_1_rate: String(input.installment_1_rate),
      installment_2_rate: String(input.installment_2_rate),
      installment_3_rate: String(input.installment_3_rate),
      installment_4_rate: String(input.installment_4_rate),
      installment_5_rate: String(input.installment_5_rate),
      installment_6_rate: String(input.installment_6_rate),
      installment_7_rate: String(input.installment_7_rate),
      installment_8_rate: String(input.installment_8_rate),
      installment_9_rate: String(input.installment_9_rate),
      installment_10_rate: String(input.installment_10_rate),
      installment_11_rate: String(input.installment_11_rate),
      installment_12_rate: String(input.installment_12_rate),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  private buildUpdateData(
    input: UpdateCreditCardFeeRequest
  ): Partial<typeof creditCardFee.$inferInsert> {
    return {
      installment_1_rate: String(input.installment_1_rate),
      installment_2_rate: String(input.installment_2_rate),
      installment_3_rate: String(input.installment_3_rate),
      installment_4_rate: String(input.installment_4_rate),
      installment_5_rate: String(input.installment_5_rate),
      installment_6_rate: String(input.installment_6_rate),
      installment_7_rate: String(input.installment_7_rate),
      installment_8_rate: String(input.installment_8_rate),
      installment_9_rate: String(input.installment_9_rate),
      installment_10_rate: String(input.installment_10_rate),
      installment_11_rate: String(input.installment_11_rate),
      installment_12_rate: String(input.installment_12_rate),
      updated_at: new Date().toISOString(),
    };
  }

  private buildResponse(
    record: typeof creditCardFee.$inferSelect
  ): UpdateCreditCardFeeResponse {
    return {
      credit_card_fee_id: record.credit_card_fee_id,
      installment_1_rate: Number(record.installment_1_rate),
      installment_2_rate: Number(record.installment_2_rate),
      installment_3_rate: Number(record.installment_3_rate),
      installment_4_rate: Number(record.installment_4_rate),
      installment_5_rate: Number(record.installment_5_rate),
      installment_6_rate: Number(record.installment_6_rate),
      installment_7_rate: Number(record.installment_7_rate),
      installment_8_rate: Number(record.installment_8_rate),
      installment_9_rate: Number(record.installment_9_rate),
      installment_10_rate: Number(record.installment_10_rate),
      installment_11_rate: Number(record.installment_11_rate),
      installment_12_rate: Number(record.installment_12_rate),
      created_at: record.created_at || '',
      updated_at: record.updated_at || '',
    };
  }

  private async getCreditCardFeeByIdTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    id: string,
    t: TFunction<'translation', undefined>
  ): Promise<UpdateCreditCardFeeResponse> {
    const feeRecord = await tx.query.creditCardFee.findFirst({
      where: eq(creditCardFee.credit_card_fee_id, id),
      columns: {
        credit_card_fee_id: true,
        installment_1_rate: true,
        installment_2_rate: true,
        installment_3_rate: true,
        installment_4_rate: true,
        installment_5_rate: true,
        installment_6_rate: true,
        installment_7_rate: true,
        installment_8_rate: true,
        installment_9_rate: true,
        installment_10_rate: true,
        installment_11_rate: true,
        installment_12_rate: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
      },
    });

    if (!feeRecord) {
      throw new Error(t('credit_card_fee_not_found'));
    }

    return this.buildResponse(feeRecord);
  }

  private async updateCreditCardFeeTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    id: string,
    input: UpdateCreditCardFeeRequest,
    t: TFunction<'translation', undefined>
  ): Promise<UpdateCreditCardFeeResponse> {
    const updateData = this.buildUpdateData(input);

    await tx
      .update(creditCardFee)
      .set(updateData)
      .where(eq(creditCardFee.credit_card_fee_id, id))
      .execute();

    return this.getCreditCardFeeByIdTx(tx, id, t);
  }

  private async createCreditCardFeeTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: UpdateCreditCardFeeRequest,
    t: TFunction<'translation', undefined>
  ): Promise<UpdateCreditCardFeeResponse> {
    const insertData = this.buildInsertData(input);

    await tx.insert(creditCardFee).values(insertData).execute();

    return this.getCreditCardFeeByIdTx(tx, insertData.credit_card_fee_id, t);
  }
}
