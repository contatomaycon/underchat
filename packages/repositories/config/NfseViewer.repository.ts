import * as schema from '@core/models';
import { nfse } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { ListNfseResponse } from '@core/schema/config/listNfse/response.schema';

@injectable()
export class NfseViewerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewNfse = async (): Promise<ListNfseResponse | null> => {
    const nfseRecord = await this.db.query.nfse.findFirst({
      where: eq(nfse.default_product, true),
      columns: {
        nfse_id: true,
        external_id: true,
        name: true,
        municipal_service_code: true,
        municipal_service_description_field: true,
        retain_iss: true,
        iss_value: true,
        cofins_value: true,
        csll_value: true,
        inss_value: true,
        ir_value: true,
        pis_value: true,
        deductions: true,
        default_product: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!nfseRecord) {
      return null;
    }

    return {
      nfse_id: nfseRecord.nfse_id,
      external_id: nfseRecord.external_id,
      name: nfseRecord.name,
      municipal_service_code: nfseRecord.municipal_service_code,
      municipal_service_description_field:
        nfseRecord.municipal_service_description_field,
      retain_iss: nfseRecord.retain_iss,
      iss_value: nfseRecord.iss_value,
      cofins_value: nfseRecord.cofins_value,
      csll_value: nfseRecord.csll_value,
      inss_value: nfseRecord.inss_value,
      ir_value: nfseRecord.ir_value,
      pis_value: nfseRecord.pis_value,
      deductions: nfseRecord.deductions,
      default_product: nfseRecord.default_product,
      created_at: nfseRecord.created_at || '',
      updated_at: nfseRecord.updated_at || '',
    };
  };
}
