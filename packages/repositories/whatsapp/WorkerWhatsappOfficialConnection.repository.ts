import * as schema from '@core/models';
import { worker, workerWhatsappOfficialConnection } from '@core/models';
import { ICreateWorkerWhatsappOfficialConnection } from '@core/common/interfaces/ICreateWorkerWhatsappOfficialConnection';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { currentTime } from '@core/common/functions/currentTime';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull, ne } from 'drizzle-orm';

interface ICreateWorkerWhatsappOfficialConnectionForExistingWorker {
  worker_whatsapp_official_connection_id: string;
  worker_id: string;
  account_id: string;
  number: string | null;
  connection_date: string;
  business_id?: string | null;
  waba_id: string;
  phone_number_id: string;
  display_phone_number?: string | null;
  verified_name?: string | null;
  access_token_encrypted: string;
  token_type?: string | null;
  expires_at?: string | null;
  scope?: string | null;
  api_version: string;
  connected_at: string;
}

export interface IActiveWorkerWhatsappOfficialConnectionWithWorker {
  worker_whatsapp_official_connection_id: string;
  worker_id: string;
  account_id: string;
  worker_name: string;
  business_id: string | null;
  waba_id: string;
  phone_number_id: string;
  access_token_encrypted: string;
  api_version: string;
}

@injectable()
export class WorkerWhatsappOfficialConnectionRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  findActiveByPhoneNumberId = async (
    phoneNumberId: string
  ): Promise<{ worker_id: string; phone_number_id: string } | null> => {
    const record =
      await this.dbRo.query.workerWhatsappOfficialConnection.findFirst({
        where: and(
          eq(workerWhatsappOfficialConnection.phone_number_id, phoneNumberId),
          isNull(workerWhatsappOfficialConnection.deleted_at)
        ),
        columns: {
          worker_id: true,
          phone_number_id: true,
        },
      });

    return record ?? null;
  };

  findActiveByPhoneNumberIdWithWorker = async (
    phoneNumberId: string
  ): Promise<IActiveWorkerWhatsappOfficialConnectionWithWorker | null> => {
    const [record] = await this.dbRo
      .select({
        worker_whatsapp_official_connection_id:
          workerWhatsappOfficialConnection.worker_whatsapp_official_connection_id,
        worker_id: workerWhatsappOfficialConnection.worker_id,
        account_id: worker.account_id,
        worker_name: worker.name,
        business_id: workerWhatsappOfficialConnection.business_id,
        waba_id: workerWhatsappOfficialConnection.waba_id,
        phone_number_id: workerWhatsappOfficialConnection.phone_number_id,
        access_token_encrypted:
          workerWhatsappOfficialConnection.access_token_encrypted,
        api_version: workerWhatsappOfficialConnection.api_version,
      })
      .from(workerWhatsappOfficialConnection)
      .innerJoin(
        worker,
        eq(worker.worker_id, workerWhatsappOfficialConnection.worker_id)
      )
      .where(
        and(
          eq(workerWhatsappOfficialConnection.phone_number_id, phoneNumberId),
          isNull(workerWhatsappOfficialConnection.deleted_at),
          isNull(worker.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return record ?? null;
  };

  findActiveByWabaIdWithWorker = async (
    wabaId: string
  ): Promise<IActiveWorkerWhatsappOfficialConnectionWithWorker[]> => {
    return this.dbRo
      .select({
        worker_whatsapp_official_connection_id:
          workerWhatsappOfficialConnection.worker_whatsapp_official_connection_id,
        worker_id: workerWhatsappOfficialConnection.worker_id,
        account_id: worker.account_id,
        worker_name: worker.name,
        business_id: workerWhatsappOfficialConnection.business_id,
        waba_id: workerWhatsappOfficialConnection.waba_id,
        phone_number_id: workerWhatsappOfficialConnection.phone_number_id,
        access_token_encrypted:
          workerWhatsappOfficialConnection.access_token_encrypted,
        api_version: workerWhatsappOfficialConnection.api_version,
      })
      .from(workerWhatsappOfficialConnection)
      .innerJoin(
        worker,
        eq(worker.worker_id, workerWhatsappOfficialConnection.worker_id)
      )
      .where(
        and(
          eq(workerWhatsappOfficialConnection.waba_id, wabaId),
          isNull(workerWhatsappOfficialConnection.deleted_at),
          isNull(worker.deleted_at)
        )
      )
      .execute();
  };

  findActiveByWorkerId = async (
    workerId: string
  ): Promise<{
    worker_whatsapp_official_connection_id: string;
    worker_id: string;
    business_id: string | null;
    waba_id: string;
    phone_number_id: string;
    access_token_encrypted: string;
    api_version: string;
  } | null> => {
    const record =
      await this.dbRo.query.workerWhatsappOfficialConnection.findFirst({
        where: and(
          eq(workerWhatsappOfficialConnection.worker_id, workerId),
          isNull(workerWhatsappOfficialConnection.deleted_at)
        ),
        columns: {
          worker_whatsapp_official_connection_id: true,
          worker_id: true,
          business_id: true,
          waba_id: true,
          phone_number_id: true,
          access_token_encrypted: true,
          api_version: true,
        },
      });

    return record ?? null;
  };

  countActiveByWabaIdExceptWorkerId = async (
    wabaId: string,
    workerId: string
  ): Promise<number> => {
    const [result] = await this.dbRo
      .select({ value: count() })
      .from(workerWhatsappOfficialConnection)
      .where(
        and(
          eq(workerWhatsappOfficialConnection.waba_id, wabaId),
          ne(workerWhatsappOfficialConnection.worker_id, workerId),
          isNull(workerWhatsappOfficialConnection.deleted_at)
        )
      )
      .execute();

    return result?.value ?? 0;
  };

  createWithWorker = async (
    input: ICreateWorkerWhatsappOfficialConnection
  ): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      await tx.insert(worker).values({
        worker_id: input.worker_id,
        worker_status_id: input.worker_status_id,
        worker_type_id: input.worker_type_id,
        server_id: input.server_id,
        account_id: input.account_id,
        name: input.name,
        number: input.number,
        connection_date: input.connection_date,
      });

      await tx.insert(workerWhatsappOfficialConnection).values({
        worker_whatsapp_official_connection_id:
          input.worker_whatsapp_official_connection_id,
        worker_id: input.worker_id,
        business_id: input.business_id ?? null,
        waba_id: input.waba_id,
        phone_number_id: input.phone_number_id,
        display_phone_number: input.display_phone_number ?? null,
        verified_name: input.verified_name ?? null,
        access_token_encrypted: input.access_token_encrypted,
        token_type: input.token_type ?? null,
        expires_at: input.expires_at ?? null,
        scope: input.scope ?? null,
        api_version: input.api_version,
        connected_at: input.connected_at,
      });

      return true;
    });
  };

  softDeleteByWorkerId = async (workerId: string): Promise<boolean> => {
    const deletedAt = currentTime();
    const result = await this.dbRw
      .update(workerWhatsappOfficialConnection)
      .set({
        deleted_at: deletedAt,
        updated_at: deletedAt,
      })
      .where(
        and(
          eq(workerWhatsappOfficialConnection.worker_id, workerId),
          isNull(workerWhatsappOfficialConnection.deleted_at)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };

  disconnectPreservingWorker = async (input: {
    accountId: string;
    workerId: string;
  }): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      const disconnectedAt = currentTime();

      const workerResult = await tx
        .update(worker)
        .set({
          worker_status_id: EWorkerStatus.offline,
          server_id: null,
          number: null,
          connection_date: null,
          last_connection_check_at: null,
          updated_at: disconnectedAt,
        })
        .where(
          and(
            eq(worker.account_id, input.accountId),
            eq(worker.worker_id, input.workerId),
            eq(worker.worker_type_id, EWorkerType.whatsapp),
            isNull(worker.deleted_at)
          )
        )
        .execute();

      if (workerResult.rowCount !== 1) {
        return false;
      }

      await tx
        .update(workerWhatsappOfficialConnection)
        .set({
          deleted_at: disconnectedAt,
          updated_at: disconnectedAt,
        })
        .where(
          and(
            eq(workerWhatsappOfficialConnection.worker_id, input.workerId),
            isNull(workerWhatsappOfficialConnection.deleted_at)
          )
        )
        .execute();

      return true;
    });
  };

  createForExistingWorker = async (
    input: ICreateWorkerWhatsappOfficialConnectionForExistingWorker
  ): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      const workerResult = await tx
        .update(worker)
        .set({
          worker_status_id: EWorkerStatus.online,
          server_id: null,
          number: input.number,
          connection_date: input.connection_date,
          last_connection_check_at: null,
          updated_at: input.connection_date,
        })
        .where(
          and(
            eq(worker.account_id, input.account_id),
            eq(worker.worker_id, input.worker_id),
            eq(worker.worker_type_id, EWorkerType.whatsapp),
            isNull(worker.deleted_at)
          )
        )
        .execute();

      if (workerResult.rowCount !== 1) {
        return false;
      }

      await tx.insert(workerWhatsappOfficialConnection).values({
        worker_whatsapp_official_connection_id:
          input.worker_whatsapp_official_connection_id,
        worker_id: input.worker_id,
        business_id: input.business_id ?? null,
        waba_id: input.waba_id,
        phone_number_id: input.phone_number_id,
        display_phone_number: input.display_phone_number ?? null,
        verified_name: input.verified_name ?? null,
        access_token_encrypted: input.access_token_encrypted,
        token_type: input.token_type ?? null,
        expires_at: input.expires_at ?? null,
        scope: input.scope ?? null,
        api_version: input.api_version,
        connected_at: input.connected_at,
      });

      return true;
    });
  };
}
