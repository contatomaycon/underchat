import * as schema from '@core/models';
import {
  accountPaymentNfSe,
  accountPaymentNfSeStatus,
  nfse,
} from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { IGetAsaasInvoiceResponse } from '@core/common/interfaces/IAsaasInvoice';
import { randomUUID } from 'node:crypto';

@injectable()
export class AccountPaymentNfSeUpserterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  findAccountPaymentByBilling = async (
    billing: string
  ): Promise<{ account_payment_id: string } | null> => {
    const payment = await this.db.query.accountPayment.findFirst({
      where: eq(schema.accountPayment.billing, billing),
      columns: {
        account_payment_id: true,
      },
    });

    return payment || null;
  };

  findStatusByName = async (
    name: string
  ): Promise<{ account_payment_nfse_status_id: string } | null> => {
    const status = await this.db.query.accountPaymentNfSeStatus.findFirst({
      where: eq(accountPaymentNfSeStatus.name, name),
      columns: {
        account_payment_nfse_status_id: true,
      },
    });

    return status || null;
  };

  findNfSeByReference = async (
    reference: string
  ): Promise<{ account_payment_nfse_id: string } | null> => {
    const nfse = await this.db.query.accountPaymentNfSe.findFirst({
      where: eq(accountPaymentNfSe.reference, reference),
      columns: {
        account_payment_nfse_id: true,
      },
    });

    return nfse || null;
  };

  upsertAccountPaymentNfSe = async (
    accountPaymentId: string,
    invoiceData: IGetAsaasInvoiceResponse
  ): Promise<void> => {
    await this.db.transaction(async (tx) => {
      const status = await this.findStatusByNameTx(tx, invoiceData.status);

      if (!status) {
        throw new Error(`Status não encontrado: ${invoiceData.status}`);
      }

      const defaultNfse = await this.findDefaultNfseTx(tx);
      if (!defaultNfse) {
        throw new Error('NFSe padrão não encontrado');
      }

      const existing = await this.findNfSeByReferenceTx(tx, invoiceData.id);

      if (existing) {
        await this.updateAccountPaymentNfSeTx(
          tx,
          existing.account_payment_nfse_id,
          accountPaymentId,
          invoiceData,
          status.account_payment_nfse_status_id,
          defaultNfse.nfse_id
        );
        return;
      }

      await this.createAccountPaymentNfSeTx(
        tx,
        accountPaymentId,
        invoiceData,
        status.account_payment_nfse_status_id,
        defaultNfse.nfse_id
      );
    });
  };

  private async findStatusByNameTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    name: string
  ): Promise<{ account_payment_nfse_status_id: string } | null> {
    const status = await tx.query.accountPaymentNfSeStatus.findFirst({
      where: eq(accountPaymentNfSeStatus.name, name),
      columns: {
        account_payment_nfse_status_id: true,
      },
    });

    return status || null;
  }

  private async findNfSeByReferenceTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    reference: string
  ): Promise<{ account_payment_nfse_id: string } | null> {
    const nfseRecord = await tx.query.accountPaymentNfSe.findFirst({
      where: eq(accountPaymentNfSe.reference, reference),
      columns: {
        account_payment_nfse_id: true,
      },
    });

    return nfseRecord || null;
  }

  private async findDefaultNfseTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >
  ): Promise<{ nfse_id: string } | null> {
    const nfseRecord = await tx.query.nfse.findFirst({
      where: eq(nfse.default_product, true),
      columns: {
        nfse_id: true,
      },
    });

    return nfseRecord || null;
  }

  private async createAccountPaymentNfSeTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    accountPaymentId: string,
    invoiceData: IGetAsaasInvoiceResponse,
    statusId: string,
    nfseId: string
  ): Promise<void> {
    const accountPaymentNfseId = randomUUID();

    await tx
      .insert(accountPaymentNfSe)
      .values({
        account_payment_nfse_id: accountPaymentNfseId,
        account_payment_id: accountPaymentId,
        reference: invoiceData.id,
        account_payment_nfse_status_id: statusId,
        nfse_id: nfseId,
        type: invoiceData.type,
        status_description: invoiceData.statusDescription || null,
        pdf_url: invoiceData.pdfUrl || null,
        xml_url: invoiceData.xmlUrl || null,
        rps_serie: invoiceData.rpsSerie || null,
        number: invoiceData.number || null,
        validation_code: invoiceData.validationCode || null,
        value: invoiceData.value.toString(),
      })
      .execute();
  }

  private async updateAccountPaymentNfSeTx(
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    accountPaymentNfseId: string,
    accountPaymentId: string,
    invoiceData: IGetAsaasInvoiceResponse,
    statusId: string,
    nfseId: string
  ): Promise<void> {
    await tx
      .update(accountPaymentNfSe)
      .set({
        account_payment_id: accountPaymentId,
        account_payment_nfse_status_id: statusId,
        nfse_id: nfseId,
        type: invoiceData.type,
        status_description: invoiceData.statusDescription || null,
        pdf_url: invoiceData.pdfUrl || null,
        xml_url: invoiceData.xmlUrl || null,
        rps_serie: invoiceData.rpsSerie || null,
        number: invoiceData.number || null,
        validation_code: invoiceData.validationCode || null,
        value: invoiceData.value.toString(),
        updated_at: new Date().toISOString(),
      })
      .where(
        eq(accountPaymentNfSe.account_payment_nfse_id, accountPaymentNfseId)
      )
      .execute();
  }

  updateNfSeStatusOnly = async (
    reference: string,
    statusName: string
  ): Promise<void> => {
    await this.db.transaction(async (tx) => {
      const status = await this.findStatusByNameTx(tx, statusName);

      if (!status) {
        throw new Error(`Status não encontrado: ${statusName}`);
      }

      const existing = await this.findNfSeByReferenceTx(tx, reference);

      if (!existing) {
        throw new Error(`Nota fiscal não encontrada: ${reference}`);
      }

      await tx
        .update(accountPaymentNfSe)
        .set({
          account_payment_nfse_status_id: status.account_payment_nfse_status_id,
          updated_at: new Date().toISOString(),
        })
        .where(
          eq(
            accountPaymentNfSe.account_payment_nfse_id,
            existing.account_payment_nfse_id
          )
        )
        .execute();
    });
  };
}
