import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, and } from 'drizzle-orm';
import { ViewAccountPaymentNfseResponse } from '@core/schema/account/viewAccountPaymentNfse/response.schema';

@injectable()
export class AccountPaymentNfseViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewAccountPaymentNfse = async (
    accountId: string,
    accountPaymentId: string
  ): Promise<ViewAccountPaymentNfseResponse | null> => {
    const payment = await this.dbRo.query.accountPayment.findFirst({
      where: and(
        eq(schema.accountPayment.account_payment_id, accountPaymentId),
        eq(schema.accountPayment.account_id, accountId)
      ),
      columns: {
        account_payment_id: true,
      },
      with: {
        apn: {
          columns: {
            account_payment_nfse_id: true,
            type: true,
            status_description: true,
            rps_serie: true,
            number: true,
            validation_code: true,
            value: true,
            pdf_url: true,
            xml_url: true,
            created_at: true,
          },
          with: {
            aps: {
              columns: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!payment?.apn?.length) {
      return null;
    }

    const nfse = payment.apn[0];

    return {
      account_payment_nfse_id: nfse.account_payment_nfse_id,
      type: nfse.type,
      status_description: nfse.status_description,
      rps_serie: nfse.rps_serie,
      number: nfse.number,
      validation_code: nfse.validation_code,
      value: nfse.value,
      pdf_url: nfse.pdf_url,
      xml_url: nfse.xml_url,
      created_at: nfse.created_at || '',
      status_name: nfse.aps?.name || '',
    };
  };
}
