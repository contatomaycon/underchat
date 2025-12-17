import * as schema from '@core/models';
import { creditCardFee } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { ListCreditCardFeeResponse } from '@core/schema/config/listCreditCardFee/response.schema';

@injectable()
export class CreditCardFeeViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewCreditCardFee = async (): Promise<ListCreditCardFeeResponse | null> => {
    const feeRecord = await this.db.query.creditCardFee.findFirst({
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
      return null;
    }

    return this.buildResponse(feeRecord);
  };

  private buildResponse = (
    record: typeof creditCardFee.$inferSelect
  ): ListCreditCardFeeResponse => {
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
  };
}
