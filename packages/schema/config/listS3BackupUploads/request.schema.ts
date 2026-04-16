import { ES3BackupMigrationStatus } from '@core/common/enums/ES3BackupMigrationStatus';
import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listS3BackupUploadsRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  status: Type.Optional(
    Type.Union([
      Type.String({ enum: Object.values(ES3BackupMigrationStatus) }),
      Type.Null(),
    ])
  ),
  account: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  search: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  include_deleted: Type.Optional(Type.Boolean()),
});

export type ListS3BackupUploadsRequest = Static<
  typeof listS3BackupUploadsRequestSchema
>;
