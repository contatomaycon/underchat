import * as schema from '@core/models';
import {
  userChannel,
  worker,
  workerWhatsappOfficialConnection,
} from '@core/models';
import { ICreateWorkerWhatsappOfficialConnection } from '@core/common/interfaces/ICreateWorkerWhatsappOfficialConnection';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { currentTime } from '@core/common/functions/currentTime';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import {
  and,
  count,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
} from 'drizzle-orm';

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

export interface ICreateWorkerWhatsappOfficialConnectionWithAccessMigrationResult {
  created: boolean;
  migrated_user_ids: string[];
  migrated_user_channels: Array<{
    user_id: string;
    channels: Array<{ id: string; name: string }>;
  }>;
}

const ACTIVE_PHONE_NUMBER_UNIQUE_INDEX =
  'worker_whatsapp_official_connection_active_phone_number_uidx';

export class OfficialWhatsappPhoneAlreadyConnectedError extends Error {
  constructor() {
    super('whatsapp_official_phone_already_connected');
    this.name = 'OfficialWhatsappPhoneAlreadyConnectedError';
  }
}

function isActivePhoneNumberUniqueViolation(error: unknown): boolean {
  let currentError: unknown = error;

  for (let depth = 0; depth < 4; depth += 1) {
    if (!currentError || typeof currentError !== 'object') {
      return false;
    }

    const details = currentError as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (
      details.code === '23505' &&
      details.constraint === ACTIVE_PHONE_NUMBER_UNIQUE_INDEX
    ) {
      return true;
    }

    if (!details.cause || details.cause === currentError) {
      return false;
    }

    currentError = details.cause;
  }

  return false;
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
    const [record] = await this.dbRo
      .select({
        worker_id: workerWhatsappOfficialConnection.worker_id,
        phone_number_id: workerWhatsappOfficialConnection.phone_number_id,
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

  /**
   * Repairs the legacy state where an active official Meta connection was
   * projected as QR-ready (`disponible`). Plan-blocked workers are deliberately
   * excluded: repairing a webhook must never bypass subscription limits.
   */
  reconcileActiveWorkerStatus = async (input: {
    accountId: string;
    workerId: string;
  }): Promise<boolean> => {
    const reconciledAt = currentTime();
    const result = await this.dbRw
      .update(worker)
      .set({
        worker_status_id: EWorkerStatus.online,
        lifecycle_operation_id: null,
        updated_at: reconciledAt,
      })
      .where(
        and(
          eq(worker.account_id, input.accountId),
          eq(worker.worker_id, input.workerId),
          eq(worker.worker_type_id, EWorkerType.whatsapp),
          eq(worker.worker_status_id, EWorkerStatus.disponible),
          isNull(worker.lifecycle_operation_id),
          isNull(worker.deleted_at),
          exists(
            this.dbRw
              .select({
                id: workerWhatsappOfficialConnection.worker_whatsapp_official_connection_id,
              })
              .from(workerWhatsappOfficialConnection)
              .where(
                and(
                  eq(
                    workerWhatsappOfficialConnection.worker_id,
                    input.workerId
                  ),
                  isNull(workerWhatsappOfficialConnection.deleted_at)
                )
              )
          )
        )
      )
      .execute();

    return result.rowCount === 1;
  };

  updateActiveAuthorization = async (input: {
    accountId: string;
    connectionId: string;
    workerId: string;
    businessId: string | null;
    accessTokenEncrypted: string;
    tokenType: string | null;
    expiresAt: string | null;
    scope: string | null;
    apiVersion: string;
  }): Promise<boolean> => {
    const updatedAt = currentTime();
    const result = await this.dbRw
      .update(workerWhatsappOfficialConnection)
      .set({
        business_id: input.businessId,
        access_token_encrypted: input.accessTokenEncrypted,
        token_type: input.tokenType,
        expires_at: input.expiresAt,
        scope: input.scope,
        api_version: input.apiVersion,
        updated_at: updatedAt,
      })
      .where(
        and(
          eq(
            workerWhatsappOfficialConnection.worker_whatsapp_official_connection_id,
            input.connectionId
          ),
          eq(workerWhatsappOfficialConnection.worker_id, input.workerId),
          isNull(workerWhatsappOfficialConnection.deleted_at),
          exists(
            this.dbRw
              .select({ id: worker.worker_id })
              .from(worker)
              .where(
                and(
                  eq(worker.worker_id, input.workerId),
                  eq(worker.account_id, input.accountId),
                  eq(worker.worker_type_id, EWorkerType.whatsapp),
                  isNull(worker.deleted_at)
                )
              )
          )
        )
      )
      .execute();

    return result.rowCount === 1;
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
    const result = await this.createWithWorkerAndMigrateChannelAccess(input);

    return result.created;
  };

  createWithWorkerAndMigrateChannelAccess = async (
    input: ICreateWorkerWhatsappOfficialConnection
  ): Promise<ICreateWorkerWhatsappOfficialConnectionWithAccessMigrationResult> => {
    try {
      return await this.dbRw.transaction(async (tx) => {
        const staleConnections = await tx
          .select({
            worker_whatsapp_official_connection_id:
              workerWhatsappOfficialConnection.worker_whatsapp_official_connection_id,
          })
          .from(workerWhatsappOfficialConnection)
          .innerJoin(
            worker,
            eq(worker.worker_id, workerWhatsappOfficialConnection.worker_id)
          )
          .where(
            and(
              eq(
                workerWhatsappOfficialConnection.phone_number_id,
                input.phone_number_id
              ),
              isNull(workerWhatsappOfficialConnection.deleted_at),
              isNotNull(worker.deleted_at)
            )
          )
          .execute();

        const staleConnectionIds = staleConnections.map(
          (connection) => connection.worker_whatsapp_official_connection_id
        );
        if (staleConnectionIds.length > 0) {
          await tx
            .update(workerWhatsappOfficialConnection)
            .set({
              deleted_at: input.connected_at,
              updated_at: input.connected_at,
            })
            .where(
              inArray(
                workerWhatsappOfficialConnection.worker_whatsapp_official_connection_id,
                staleConnectionIds
              )
            )
            .execute();
        }

        const replacedWorkers = await tx
          .select({
            worker_id: workerWhatsappOfficialConnection.worker_id,
          })
          .from(workerWhatsappOfficialConnection)
          .innerJoin(
            worker,
            eq(worker.worker_id, workerWhatsappOfficialConnection.worker_id)
          )
          .where(
            and(
              eq(
                workerWhatsappOfficialConnection.phone_number_id,
                input.phone_number_id
              ),
              eq(worker.account_id, input.account_id),
              or(
                isNotNull(workerWhatsappOfficialConnection.deleted_at),
                isNotNull(worker.deleted_at)
              )
            )
          )
          .execute();

        await tx.insert(worker).values({
          worker_id: input.worker_id,
          worker_status_id: input.worker_status_id,
          worker_type_id: input.worker_type_id,
          server_id: input.server_id,
          account_id: input.account_id,
          name: input.name,
          session_storage: EWorkerSessionStorage.legacy_volume,
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

        const replacedWorkerIds = Array.from(
          new Set(replacedWorkers.map((item) => item.worker_id))
        );
        if (replacedWorkerIds.length === 0) {
          return {
            created: true,
            migrated_user_ids: [],
            migrated_user_channels: [],
          };
        }

        const migratedUsers = await tx
          .select({ user_id: userChannel.user_id })
          .from(userChannel)
          .where(
            and(
              eq(userChannel.account_id, input.account_id),
              inArray(userChannel.channel_id, replacedWorkerIds)
            )
          )
          .execute();

        const migratedUserIds = Array.from(
          new Set(migratedUsers.map((item) => item.user_id))
        );

        if (migratedUserIds.length > 0) {
          await tx
            .delete(userChannel)
            .where(
              and(
                eq(userChannel.account_id, input.account_id),
                inArray(userChannel.channel_id, replacedWorkerIds)
              )
            )
            .execute();

          await tx
            .insert(userChannel)
            .values(
              migratedUserIds.map((userId) => ({
                user_channel_id: uuidv7(),
                user_id: userId,
                channel_id: input.worker_id,
                account_id: input.account_id,
                created_at: input.connected_at,
                updated_at: input.connected_at,
              }))
            )
            .execute();
        }

        const channelsByUserId = new Map(
          migratedUserIds.map((userId) => [
            userId,
            [] as Array<{ id: string; name: string }>,
          ])
        );

        if (migratedUserIds.length > 0) {
          const migratedUserChannels = await tx
            .select({
              user_id: userChannel.user_id,
              channel_id: userChannel.channel_id,
              name: worker.name,
            })
            .from(userChannel)
            .innerJoin(worker, eq(userChannel.channel_id, worker.worker_id))
            .where(
              and(
                eq(userChannel.account_id, input.account_id),
                inArray(userChannel.user_id, migratedUserIds)
              )
            )
            .execute();

          for (const channel of migratedUserChannels) {
            channelsByUserId.get(channel.user_id)?.push({
              id: channel.channel_id,
              name: channel.name,
            });
          }
        }

        return {
          created: true,
          migrated_user_ids: migratedUserIds,
          migrated_user_channels: migratedUserIds.map((userId) => ({
            user_id: userId,
            channels: channelsByUserId.get(userId) ?? [],
          })),
        };
      });
    } catch (error) {
      if (isActivePhoneNumberUniqueViolation(error)) {
        throw new OfficialWhatsappPhoneAlreadyConnectedError();
      }

      throw error;
    }
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
    try {
      return await this.dbRw.transaction(async (tx) => {
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
    } catch (error) {
      if (isActivePhoneNumberUniqueViolation(error)) {
        throw new OfficialWhatsappPhoneAlreadyConnectedError();
      }

      throw error;
    }
  };
}
