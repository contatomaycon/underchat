import { Static, Type } from '@sinclair/typebox';

export const reprocessS3BackupUploadRequestSchema = Type.Object({
  s3_backup_upload_id: Type.String({ format: 'uuid' }),
});

export type ReprocessS3BackupUploadRequest = Static<
  typeof reprocessS3BackupUploadRequestSchema
>;
