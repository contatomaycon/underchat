import * as schema from '@core/models';
import { nfse } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { ListNfseResponse } from '@core/schema/config/listNfse/response.schema';

@injectable()
export class NfseViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewNfse = async (): Promise<ListNfseResponse | null> => {
    const nfseRecord = await this.dbRo.query.nfse.findFirst({
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
        integration_enabled: true,
        integration_base_url: true,
        integration_uf: true,
        integration_tenant: true,
        integration_username: true,
        integration_municipality_code: true,
        integration_rps_series: true,
        integration_prestador_document: true,
        integration_prestador_municipal_inscription: true,
        integration_password_encrypted: true,
        certificate_bucket: true,
        certificate_key: true,
        certificate_file_name: true,
        certificate_password_encrypted: true,
        certificate_uploaded_at: true,
        default_product: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!nfseRecord) {
      return null;
    }

    const hasCertificate = !!(
      nfseRecord.certificate_bucket && nfseRecord.certificate_key
    );

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
      integration_enabled: nfseRecord.integration_enabled,
      integration_base_url: nfseRecord.integration_base_url,
      integration_uf: nfseRecord.integration_uf,
      integration_tenant: nfseRecord.integration_tenant,
      integration_username: nfseRecord.integration_username,
      integration_municipality_code: nfseRecord.integration_municipality_code,
      integration_rps_series: nfseRecord.integration_rps_series,
      integration_prestador_document: nfseRecord.integration_prestador_document,
      integration_prestador_municipal_inscription:
        nfseRecord.integration_prestador_municipal_inscription,
      has_integration_password: !!nfseRecord.integration_password_encrypted,
      has_certificate: hasCertificate,
      certificate_file_name: nfseRecord.certificate_file_name,
      certificate_uploaded_at: nfseRecord.certificate_uploaded_at,
      has_certificate_password: !!nfseRecord.certificate_password_encrypted,
      default_product: nfseRecord.default_product,
      created_at: nfseRecord.created_at || '',
      updated_at: nfseRecord.updated_at || '',
    };
  };
}
