import * as schema from '@core/models';
import { methodPayment } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { ListMethodPaymentsResponse } from '@core/schema/config/listMethodPayments/response.schema';
import { eq } from 'drizzle-orm';
import { EMethodPayment } from '@core/common/enums/EMethodPayment';

@injectable()
export class MethodPaymentViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewMethodPayments = async (): Promise<ListMethodPaymentsResponse> => {
    const records = await this.dbRo.query.methodPayment.findMany({
      columns: {
        method_payment_id: true,
        type: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: (methodPayment, { asc }) => [asc(methodPayment.type)],
    });

    return records.map((record) => this.buildResponse(record));
  };

  viewMethodPaymentByType = async (
    type: EMethodPayment
  ): Promise<ListMethodPaymentsResponse[0] | null> => {
    const record = await this.dbRo.query.methodPayment.findFirst({
      where: eq(methodPayment.type, type),
      columns: {
        method_payment_id: true,
        type: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!record) {
      return null;
    }

    return this.buildResponse(record);
  };

  private readonly buildResponse = (
    record: typeof methodPayment.$inferSelect
  ): ListMethodPaymentsResponse[0] => {
    return {
      method_payment_id: record.method_payment_id,
      type: record.type,
      status: record.status,
      created_at: record.created_at || '',
      updated_at: record.updated_at || '',
    };
  };
}
