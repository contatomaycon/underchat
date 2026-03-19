import * as schema from '@core/models';
import { nfse } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { ExtractTablesWithRelations, eq } from 'drizzle-orm';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import { UpdateNfseRequest } from '@core/schema/config/updateNfse/request.schema';
import { UpdateNfseResponse } from '@core/schema/config/updateNfse/response.schema';

interface NfseRecordForResponse {
  nfse_id: string;
  external_id: number | null;
  name: string;
  municipal_service_code: string | null;
  municipal_service_description_field: string | null;
  retain_iss: boolean;
  iss_value: string | null;
  cofins_value: string | null;
  csll_value: string | null;
  inss_value: string | null;
  ir_value: string | null;
  pis_value: string | null;
  deductions: string | null;
  integration_enabled: boolean;
  integration_base_url: string | null;
  integration_uf: string | null;
  integration_tenant: string | null;
  integration_username: string | null;
  integration_municipality_code: string | null;
  integration_rps_series: string | null;
  integration_prestador_document: string | null;
  integration_prestador_municipal_inscription: string | null;
  integration_password_encrypted: string | null;
  certificate_bucket: string | null;
  certificate_key: string | null;
  certificate_file_name: string | null;
  certificate_password_encrypted: string | null;
  certificate_uploaded_at: string | null;
  default_product: boolean;
  created_at: string | null;
  updated_at: string | null;
}

@injectable()
export class NfseUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  upsertNfse = async (
    t: TFunction<'translation', undefined>,
    input: UpdateNfseRequest
  ): Promise<UpdateNfseResponse> => {
    return this.dbRw.transaction(async (tx) => {
      const existing = await this.findExistingNfseTx(tx);

      if (existing) {
        return this.updateNfseTx(tx, existing.nfse_id, input);
      }

      return this.createNfseTx(tx, input);
    });
  };

  viewDefaultNfseCertificateMetadata = async (): Promise<{
    nfse_id: string;
    certificate_bucket: string | null;
    certificate_key: string | null;
  } | null> => {
    const record = await this.dbRw.query.nfse.findFirst({
      where: eq(nfse.default_product, true),
      columns: {
        nfse_id: true,
        certificate_bucket: true,
        certificate_key: true,
      },
    });

    if (!record) {
      return null;
    }

    return {
      nfse_id: record.nfse_id,
      certificate_bucket: record.certificate_bucket,
      certificate_key: record.certificate_key,
    };
  };

  viewDefaultNfseIntegrationMetadata = async (): Promise<{
    nfse_id: string;
    integration_password_encrypted: string | null;
  } | null> => {
    const record = await this.dbRw.query.nfse.findFirst({
      where: eq(nfse.default_product, true),
      columns: {
        nfse_id: true,
        integration_password_encrypted: true,
      },
    });

    if (!record) {
      return null;
    }

    return {
      nfse_id: record.nfse_id,
      integration_password_encrypted: record.integration_password_encrypted,
    };
  };

  updateNfseCertificate = async (
    nfseId: string,
    input: {
      certificate_bucket: string;
      certificate_key: string;
      certificate_file_name: string;
      certificate_password_encrypted: string;
      certificate_uploaded_at: string;
    }
  ): Promise<UpdateNfseResponse> => {
    return this.dbRw.transaction(async (tx) => {
      await tx
        .update(nfse)
        .set({
          certificate_bucket: input.certificate_bucket,
          certificate_key: input.certificate_key,
          certificate_file_name: input.certificate_file_name,
          certificate_password_encrypted: input.certificate_password_encrypted,
          certificate_uploaded_at: input.certificate_uploaded_at,
          updated_at: new Date().toISOString(),
        })
        .where(eq(nfse.nfse_id, nfseId))
        .execute();

      const updated = await tx.query.nfse.findFirst({
        where: eq(nfse.nfse_id, nfseId),
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

      if (!updated) {
        throw new Error('Failed to retrieve updated NFSe certificate');
      }

      return this.buildResponse(updated);
    });
  };

  updateNfseIntegration = async (
    nfseId: string,
    input:
      | {
          integration_enabled: false;
        }
      | {
          integration_enabled: true;
          integration_base_url: string;
          integration_uf: string;
          integration_tenant: string;
          integration_username: string;
          integration_municipality_code: string;
          integration_rps_series: string;
          integration_prestador_document: string;
          integration_prestador_municipal_inscription: string;
          integration_password_encrypted?: string;
        }
  ): Promise<UpdateNfseResponse> => {
    return this.dbRw.transaction(async (tx) => {
      if (!input.integration_enabled) {
        await tx
          .update(nfse)
          .set({
            integration_enabled: false,
            updated_at: new Date().toISOString(),
          })
          .where(eq(nfse.nfse_id, nfseId))
          .execute();
      } else {
        const updatePayload: Partial<typeof nfse.$inferInsert> = {
          integration_enabled: true,
          integration_base_url: input.integration_base_url,
          integration_uf: input.integration_uf,
          integration_tenant: input.integration_tenant,
          integration_username: input.integration_username,
          integration_municipality_code: input.integration_municipality_code,
          integration_rps_series: input.integration_rps_series,
          integration_prestador_document: input.integration_prestador_document,
          integration_prestador_municipal_inscription:
            input.integration_prestador_municipal_inscription,
          updated_at: new Date().toISOString(),
        };

        if (input.integration_password_encrypted !== undefined) {
          updatePayload.integration_password_encrypted =
            input.integration_password_encrypted;
        }

        await tx
          .update(nfse)
          .set(updatePayload)
          .where(eq(nfse.nfse_id, nfseId))
          .execute();
      }

      const updated = await tx.query.nfse.findFirst({
        where: eq(nfse.nfse_id, nfseId),
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

      if (!updated) {
        throw new Error('Failed to retrieve updated NFSe integration');
      }

      return this.buildResponse(updated);
    });
  };

  private async findExistingNfseTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >
  ): Promise<{ nfse_id: string } | null> {
    const result = await tx
      .select({
        nfse_id: nfse.nfse_id,
      })
      .from(nfse)
      .where(eq(nfse.default_product, true))
      .limit(1)
      .execute();

    return result.length > 0 ? result[0] : null;
  }

  private buildUpdateData(
    input: UpdateNfseRequest
  ): Partial<typeof nfse.$inferInsert> {
    const updateData: Partial<typeof nfse.$inferInsert> = {
      updated_at: new Date().toISOString(),
    };

    if (input.name !== undefined) {
      updateData.name = input.name;
    }
    if (input.municipal_service_code !== undefined) {
      updateData.municipal_service_code = input.municipal_service_code;
    }
    if (input.municipal_service_description_field !== undefined) {
      updateData.municipal_service_description_field =
        input.municipal_service_description_field;
    }
    if (input.retain_iss !== undefined) {
      updateData.retain_iss = input.retain_iss;
    }
    if (input.iss_value !== undefined) {
      updateData.iss_value = input.iss_value;
    }
    if (input.cofins_value !== undefined) {
      updateData.cofins_value = input.cofins_value;
    }
    if (input.csll_value !== undefined) {
      updateData.csll_value = input.csll_value;
    }
    if (input.inss_value !== undefined) {
      updateData.inss_value = input.inss_value;
    }
    if (input.ir_value !== undefined) {
      updateData.ir_value = input.ir_value;
    }
    if (input.pis_value !== undefined) {
      updateData.pis_value = input.pis_value;
    }
    if (input.deductions !== undefined) {
      updateData.deductions = input.deductions;
    }

    return updateData;
  }

  private buildInsertData(input: UpdateNfseRequest): typeof nfse.$inferInsert {
    return {
      nfse_id: randomUUID(),
      name: input.name || '',
      municipal_service_code: input.municipal_service_code ?? null,
      municipal_service_description_field:
        input.municipal_service_description_field ?? null,
      retain_iss: input.retain_iss ?? false,
      iss_value: input.iss_value ?? null,
      cofins_value: input.cofins_value ?? null,
      csll_value: input.csll_value ?? null,
      inss_value: input.inss_value ?? null,
      ir_value: input.ir_value ?? null,
      pis_value: input.pis_value ?? null,
      deductions: input.deductions ?? null,
      integration_enabled: false,
      default_product: true,
    };
  }

  private buildResponse(nfseRecord: NfseRecordForResponse): UpdateNfseResponse {
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
  }

  private async updateNfseTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    nfseId: string,
    input: UpdateNfseRequest
  ): Promise<UpdateNfseResponse> {
    const updateData = this.buildUpdateData(input);

    await tx
      .update(nfse)
      .set(updateData)
      .where(eq(nfse.nfse_id, nfseId))
      .execute();

    const updated = await tx.query.nfse.findFirst({
      where: eq(nfse.nfse_id, nfseId),
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

    if (!updated) {
      throw new Error('Failed to retrieve updated NFSe');
    }

    return this.buildResponse(updated);
  }

  private async createNfseTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: UpdateNfseRequest
  ): Promise<UpdateNfseResponse> {
    const insertData = this.buildInsertData(input);

    await tx.insert(nfse).values(insertData).execute();

    const created = await tx.query.nfse.findFirst({
      where: eq(nfse.nfse_id, insertData.nfse_id),
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

    if (!created) {
      throw new Error('Failed to retrieve created NFSe');
    }

    return this.buildResponse(created);
  }
}
