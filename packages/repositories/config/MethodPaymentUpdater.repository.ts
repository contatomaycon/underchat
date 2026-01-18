import * as schema from '@core/models';
import { methodPayment } from '@core/models';
import { TFunction } from 'i18next';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { UpdateMethodPaymentRequest } from '@core/schema/config/updateMethodPayment/request.schema';
import { UpdateMethodPaymentResponse } from '@core/schema/config/updateMethodPayment/response.schema';
import { eq } from 'drizzle-orm';

@injectable()
export class MethodPaymentUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateMethodPayment = async (
    t: TFunction<'translation', undefined>,
    input: UpdateMethodPaymentRequest
  ): Promise<UpdateMethodPaymentResponse> => {
    const now = new Date().toISOString();

    const updatedRecord = await this.dbRw
      .update(methodPayment)
      .set({
        status: input.status,
        updated_at: now,
      })
      .where(eq(methodPayment.method_payment_id, input.method_payment_id))
      .returning();

    if (!updatedRecord || updatedRecord.length === 0) {
      throw new Error(t('method_payment_not_found'));
    }

    const record = updatedRecord[0];

    return {
      method_payment_id: record.method_payment_id,
      type: record.type,
      status: record.status,
      created_at: record.created_at || '',
      updated_at: record.updated_at || '',
    };
  };
}
