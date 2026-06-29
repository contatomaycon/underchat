import * as schema from '@core/models';
import { worker, workerWhatsappOfficialConnection } from '@core/models';
import { ICreateWorkerWhatsappOfficialConnection } from '@core/common/interfaces/ICreateWorkerWhatsappOfficialConnection';
import { currentTime } from '@core/common/functions/currentTime';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull, ne } from 'drizzle-orm';

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

  findActiveByWorkerId = async (
    workerId: string
  ): Promise<{
    worker_whatsapp_official_connection_id: string;
    worker_id: string;
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
}
