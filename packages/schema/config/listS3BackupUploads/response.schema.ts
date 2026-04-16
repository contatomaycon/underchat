import { ES3BackupMigrationStatus } from '@core/common/enums/ES3BackupMigrationStatus';
import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

const s3BackupUploadAccountSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.Union([Type.String(), Type.Null()]),
});

export const listS3BackupUploadsResponseSchema = Type.Object({
  s3_backup_upload_id: Type.String({ format: 'uuid' }),
  account: s3BackupUploadAccountSchema,
  bucket: Type.String(),
  object_key: Type.String(),
  file_name: Type.Union([Type.String(), Type.Null()]),
  content_type: Type.Union([Type.String(), Type.Null()]),
  size_bytes: Type.Number(),
  primary_attempts: Type.Number(),
  backup_attempts: Type.Number(),
  primary_error: Type.Union([Type.String(), Type.Null()]),
  backup_error: Type.Union([Type.String(), Type.Null()]),
  migration_status: Type.String({
    enum: Object.values(ES3BackupMigrationStatus),
  }),
  migration_attempts: Type.Number(),
  migration_last_error: Type.Union([Type.String(), Type.Null()]),
  migrated_at: Type.Union([Type.String(), Type.Null()]),
  reprocess_requested_at: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
  deleted_at: Type.Union([Type.String(), Type.Null()]),
});

export const listS3BackupUploadsFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listS3BackupUploadsResponseSchema),
});

export type ListS3BackupUploadsResponse = Static<
  typeof listS3BackupUploadsResponseSchema
>;

export type ListS3BackupUploadsFinalResponse = Static<
  typeof listS3BackupUploadsFinalResponseSchema
>;
