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
      default_product: true,
    };
  }

  private buildResponse(nfseRecord: {
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
    default_product: boolean;
    created_at: string | null;
    updated_at: string | null;
  }): UpdateNfseResponse {
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
