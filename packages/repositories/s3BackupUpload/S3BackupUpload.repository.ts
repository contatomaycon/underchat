import { currentTime } from '@core/common/functions/currentTime';
import { ES3BackupMigrationStatus } from '@core/common/enums/ES3BackupMigrationStatus';
import * as schema from '@core/models';
import { account, s3BackupUpload } from '@core/models';
import { ListS3BackupUploadsRequest } from '@core/schema/config/listS3BackupUploads/request.schema';
import { ListS3BackupUploadsResponse } from '@core/schema/config/listS3BackupUploads/response.schema';
import {
  SQL,
  SQLWrapper,
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  or,
} from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

export interface CreateS3BackupUploadInput {
  account_id: string;
  bucket: string;
  object_key: string;
  file_name?: string | null;
  content_type?: string | null;
  size_bytes: number;
  primary_attempts: number;
  backup_attempts: number;
  primary_error?: string | null;
  backup_error?: string | null;
}

export interface S3BackupUploadMigrationItem {
  s3_backup_upload_id: string;
  account_id: string;
  bucket: string;
  object_key: string;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number;
  migration_status: ES3BackupMigrationStatus;
  migration_attempts: number;
  migration_last_error: string | null;
  deleted_at: string | null;
}

@injectable()
export class S3BackupUploadRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (query: ListS3BackupUploadsRequest): SQL[] => {
    if (!query.sort_by?.length) {
      return [desc(s3BackupUpload.created_at)];
    }

    const mapping: Record<string, SQLWrapper> = {
      migration_status: s3BackupUpload.migration_status,
      account: account.name,
      bucket: s3BackupUpload.bucket,
      object_key: s3BackupUpload.object_key,
      size_bytes: s3BackupUpload.size_bytes,
      created_at: s3BackupUpload.created_at,
      updated_at: s3BackupUpload.updated_at,
      migrated_at: s3BackupUpload.migrated_at,
    };

    const orders: SQL[] = [];

    for (const sort of query.sort_by) {
      const column = mapping[sort.key];
      if (!column) continue;

      const order = sort.order === 'asc' ? asc(column) : desc(column);
      orders.push(order);
    }

    if (!orders.length) {
      return [desc(s3BackupUpload.created_at)];
    }

    return orders;
  };

  private readonly setFilters = (
    query: ListS3BackupUploadsRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.include_deleted) {
      filters.push(isNotNull(s3BackupUpload.deleted_at));
    } else {
      filters.push(isNull(s3BackupUpload.deleted_at));
    }

    if (query.status) {
      filters.push(
        eq(
          s3BackupUpload.migration_status,
          query.status as ES3BackupMigrationStatus
        )
      );
    }

    if (query.account) {
      filters.push(eq(account.account_id, query.account));
    }

    if (query.search) {
      filters.push(
        or(
          ilike(s3BackupUpload.bucket, `%${query.search}%`),
          ilike(s3BackupUpload.object_key, `%${query.search}%`),
          ilike(s3BackupUpload.file_name, `%${query.search}%`),
          ilike(account.name, `%${query.search}%`)
        ) as SQLWrapper
      );
    }

    return filters;
  };

  createFallbackUpload = async (
    input: CreateS3BackupUploadInput
  ): Promise<string | null> => {
    const s3BackupUploadId = uuidv7();

    const result = await this.dbRw
      .insert(s3BackupUpload)
      .values({
        s3_backup_upload_id: s3BackupUploadId,
        account_id: input.account_id,
        bucket: input.bucket,
        object_key: input.object_key,
        file_name: input.file_name ?? null,
        content_type: input.content_type ?? null,
        size_bytes: input.size_bytes,
        primary_attempts: input.primary_attempts,
        backup_attempts: input.backup_attempts,
        primary_error: input.primary_error ?? null,
        backup_error: input.backup_error ?? null,
        migration_status: ES3BackupMigrationStatus.pending,
        migration_attempts: 0,
        migration_last_error: null,
        created_at: currentTime(),
        updated_at: currentTime(),
      })
      .returning({
        s3_backup_upload_id: s3BackupUpload.s3_backup_upload_id,
      })
      .execute();

    return result[0]?.s3_backup_upload_id ?? null;
  };

  listS3BackupUploads = async (
    perPage: number,
    currentPage: number,
    query: ListS3BackupUploadsRequest
  ): Promise<ListS3BackupUploadsResponse[]> => {
    const orders = this.setOrders(query);
    const filters = this.setFilters(query);

    const queryBuilder = this.dbRo
      .select({
        s3_backup_upload_id: s3BackupUpload.s3_backup_upload_id,
        account: {
          id: account.account_id,
          name: account.name,
        },
        bucket: s3BackupUpload.bucket,
        object_key: s3BackupUpload.object_key,
        file_name: s3BackupUpload.file_name,
        content_type: s3BackupUpload.content_type,
        size_bytes: s3BackupUpload.size_bytes,
        primary_attempts: s3BackupUpload.primary_attempts,
        backup_attempts: s3BackupUpload.backup_attempts,
        primary_error: s3BackupUpload.primary_error,
        backup_error: s3BackupUpload.backup_error,
        migration_status: s3BackupUpload.migration_status,
        migration_attempts: s3BackupUpload.migration_attempts,
        migration_last_error: s3BackupUpload.migration_last_error,
        migrated_at: s3BackupUpload.migrated_at,
        reprocess_requested_at: s3BackupUpload.reprocess_requested_at,
        created_at: s3BackupUpload.created_at,
        updated_at: s3BackupUpload.updated_at,
        deleted_at: s3BackupUpload.deleted_at,
      })
      .from(s3BackupUpload)
      .innerJoin(account, eq(account.account_id, s3BackupUpload.account_id))
      .where(and(isNull(account.deleted_at), ...filters));

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((item) => ({
      s3_backup_upload_id: item.s3_backup_upload_id,
      account: item.account,
      bucket: item.bucket,
      object_key: item.object_key,
      file_name: item.file_name,
      content_type: item.content_type,
      size_bytes: item.size_bytes,
      primary_attempts: item.primary_attempts,
      backup_attempts: item.backup_attempts,
      primary_error: item.primary_error,
      backup_error: item.backup_error,
      migration_status: item.migration_status,
      migration_attempts: item.migration_attempts,
      migration_last_error: item.migration_last_error,
      migrated_at: item.migrated_at,
      reprocess_requested_at: item.reprocess_requested_at,
      created_at: item.created_at,
      updated_at: item.updated_at,
      deleted_at: item.deleted_at,
    }));
  };

  listS3BackupUploadsTotal = async (
    query: ListS3BackupUploadsRequest
  ): Promise<number> => {
    const filters = this.setFilters(query);

    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(s3BackupUpload)
      .innerJoin(account, eq(account.account_id, s3BackupUpload.account_id))
      .where(and(isNull(account.deleted_at), ...filters))
      .execute();

    return result[0]?.count ?? 0;
  };

  listPendingMigrations = async (
    limit: number
  ): Promise<S3BackupUploadMigrationItem[]> => {
    const result = await this.dbRo
      .select({
        s3_backup_upload_id: s3BackupUpload.s3_backup_upload_id,
        account_id: s3BackupUpload.account_id,
        bucket: s3BackupUpload.bucket,
        object_key: s3BackupUpload.object_key,
        file_name: s3BackupUpload.file_name,
        content_type: s3BackupUpload.content_type,
        size_bytes: s3BackupUpload.size_bytes,
        migration_status: s3BackupUpload.migration_status,
        migration_attempts: s3BackupUpload.migration_attempts,
        migration_last_error: s3BackupUpload.migration_last_error,
        deleted_at: s3BackupUpload.deleted_at,
      })
      .from(s3BackupUpload)
      .where(
        and(
          isNull(s3BackupUpload.deleted_at),
          or(
            eq(
              s3BackupUpload.migration_status,
              ES3BackupMigrationStatus.pending
            ),
            eq(s3BackupUpload.migration_status, ES3BackupMigrationStatus.failed)
          ) as SQLWrapper
        )
      )
      .orderBy(asc(s3BackupUpload.created_at))
      .limit(limit)
      .execute();

    return result.map((item) => ({
      ...item,
      migration_attempts: item.migration_attempts ?? 0,
      migration_last_error: item.migration_last_error ?? null,
      file_name: item.file_name ?? null,
      content_type: item.content_type ?? null,
      deleted_at: item.deleted_at ?? null,
    }));
  };

  viewById = async (
    s3BackupUploadId: string
  ): Promise<S3BackupUploadMigrationItem | null> => {
    const result = await this.dbRo
      .select({
        s3_backup_upload_id: s3BackupUpload.s3_backup_upload_id,
        account_id: s3BackupUpload.account_id,
        bucket: s3BackupUpload.bucket,
        object_key: s3BackupUpload.object_key,
        file_name: s3BackupUpload.file_name,
        content_type: s3BackupUpload.content_type,
        size_bytes: s3BackupUpload.size_bytes,
        migration_status: s3BackupUpload.migration_status,
        migration_attempts: s3BackupUpload.migration_attempts,
        migration_last_error: s3BackupUpload.migration_last_error,
        deleted_at: s3BackupUpload.deleted_at,
      })
      .from(s3BackupUpload)
      .where(eq(s3BackupUpload.s3_backup_upload_id, s3BackupUploadId))
      .limit(1)
      .execute();

    const item = result[0];
    if (!item) {
      return null;
    }

    return {
      ...item,
      migration_attempts: item.migration_attempts ?? 0,
      migration_last_error: item.migration_last_error ?? null,
      file_name: item.file_name ?? null,
      content_type: item.content_type ?? null,
      deleted_at: item.deleted_at ?? null,
    };
  };

  updateAsProcessing = async (
    s3BackupUploadId: string,
    migrationAttempts: number
  ): Promise<boolean> => {
    const result = await this.dbRw
      .update(s3BackupUpload)
      .set({
        migration_status: ES3BackupMigrationStatus.processing,
        migration_attempts: migrationAttempts,
        migration_last_error: null,
        updated_at: currentTime(),
      })
      .where(eq(s3BackupUpload.s3_backup_upload_id, s3BackupUploadId))
      .execute();

    return (result.rowCount ?? 0) > 0;
  };

  updateAsFailed = async (
    s3BackupUploadId: string,
    errorMessage: string,
    migrationAttempts: number
  ): Promise<boolean> => {
    const result = await this.dbRw
      .update(s3BackupUpload)
      .set({
        migration_status: ES3BackupMigrationStatus.failed,
        migration_attempts: migrationAttempts,
        migration_last_error: errorMessage,
        updated_at: currentTime(),
      })
      .where(eq(s3BackupUpload.s3_backup_upload_id, s3BackupUploadId))
      .execute();

    return (result.rowCount ?? 0) > 0;
  };

  softDeleteAsMigrated = async (
    s3BackupUploadId: string,
    migrationAttempts: number
  ): Promise<boolean> => {
    const now = currentTime();

    const result = await this.dbRw
      .update(s3BackupUpload)
      .set({
        migration_status: ES3BackupMigrationStatus.migrated,
        migration_attempts: migrationAttempts,
        migration_last_error: null,
        migrated_at: now,
        deleted_at: now,
        updated_at: now,
      })
      .where(eq(s3BackupUpload.s3_backup_upload_id, s3BackupUploadId))
      .execute();

    return (result.rowCount ?? 0) > 0;
  };

  markReprocessRequested = async (
    s3BackupUploadId: string
  ): Promise<boolean> => {
    const now = currentTime();

    const result = await this.dbRw
      .update(s3BackupUpload)
      .set({
        reprocess_requested_at: now,
        migration_status: ES3BackupMigrationStatus.pending,
        migration_last_error: null,
        updated_at: now,
      })
      .where(
        and(
          eq(s3BackupUpload.s3_backup_upload_id, s3BackupUploadId),
          isNull(s3BackupUpload.deleted_at)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
