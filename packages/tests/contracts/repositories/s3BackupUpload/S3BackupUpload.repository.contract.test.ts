import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { ES3BackupMigrationStatus } from '@core/common/enums/ES3BackupMigrationStatus';
import { S3BackupUploadRepository } from '@core/repositories/s3BackupUpload/S3BackupUpload.repository';
import {
  createInsertDbMock,
  createSelectDbMock,
  createUpdateDbMock,
} from '@core/tests/helpers/drizzleMock';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('S3BackupUploadRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('s3-id-1');
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-21T15:00:00.000Z'
    );
  });

  it('setOrders returns default order when sort is empty or invalid', () => {
    const repository = new S3BackupUploadRepository({} as never, {} as never);

    const withNoSort = (repository as any).setOrders({});
    const withInvalidSort = (repository as any).setOrders({
      sort_by: [{ key: 'invalid_column', order: 'asc' }],
    });

    expect(withNoSort).toHaveLength(1);
    expect(withInvalidSort).toHaveLength(1);
  });

  it('setFilters includes deleted/status/account/search filters', () => {
    const repository = new S3BackupUploadRepository({} as never, {} as never);

    const filters = (repository as any).setFilters({
      include_deleted: true,
      status: ES3BackupMigrationStatus.failed,
      account: 'acc-1',
      search: 'invoice',
    });

    expect(filters).toHaveLength(4);
  });

  it('createFallbackUpload inserts row and returns generated id', async () => {
    const { db, values } = createInsertDbMock([
      {
        s3_backup_upload_id: 's3-id-1',
      },
    ]);
    const repository = new S3BackupUploadRepository({} as never, db as never);

    await expect(
      repository.createFallbackUpload({
        account_id: 'acc-1',
        bucket: 'bucket-a',
        object_key: 'path/file.zip',
        size_bytes: 1024,
        primary_attempts: 1,
        backup_attempts: 0,
      })
    ).resolves.toBe('s3-id-1');

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        s3_backup_upload_id: 's3-id-1',
        migration_status: ES3BackupMigrationStatus.pending,
        migration_attempts: 0,
        file_name: null,
        content_type: null,
      })
    );
  });

  it('createFallbackUpload returns null when insert does not return id', async () => {
    const { db } = createInsertDbMock([]);
    const repository = new S3BackupUploadRepository({} as never, db as never);

    await expect(
      repository.createFallbackUpload({
        account_id: 'acc-1',
        bucket: 'bucket-a',
        object_key: 'path/file.zip',
        size_bytes: 1024,
        primary_attempts: 1,
        backup_attempts: 0,
      })
    ).resolves.toBeNull();
  });

  it('listS3BackupUploads returns empty list when query has no rows', async () => {
    const selectMock = createSelectDbMock([]);
    const repository = new S3BackupUploadRepository(
      selectMock.db as never,
      {} as never
    );

    await expect(
      repository.listS3BackupUploads(10, 1, {} as never)
    ).resolves.toEqual([]);
  });

  it('listS3BackupUploads maps db rows to response payload', async () => {
    const row = {
      s3_backup_upload_id: 's3-id-1',
      account: { id: 'acc-1', name: 'Account A' },
      bucket: 'bucket-a',
      object_key: 'path/file.zip',
      file_name: 'file.zip',
      content_type: 'application/zip',
      size_bytes: 1024,
      primary_attempts: 1,
      backup_attempts: 0,
      primary_error: null,
      backup_error: null,
      migration_status: ES3BackupMigrationStatus.pending,
      migration_attempts: 0,
      migration_last_error: null,
      migrated_at: null,
      reprocess_requested_at: null,
      created_at: '2026-04-21T10:00:00.000Z',
      updated_at: '2026-04-21T10:00:00.000Z',
      deleted_at: null,
    };

    const selectMock = createSelectDbMock([row]);
    const repository = new S3BackupUploadRepository(
      selectMock.db as never,
      {} as never
    );

    await expect(
      repository.listS3BackupUploads(10, 2, {} as never)
    ).resolves.toEqual([row]);
    expect(selectMock.orderBy).toHaveBeenCalled();
    expect(selectMock.offset).toHaveBeenCalledWith(10);
  });

  it('listS3BackupUploadsTotal returns count from query', async () => {
    const withCount = createSelectDbMock([{ count: 9 }]);
    const repository = new S3BackupUploadRepository(
      withCount.db as never,
      {} as never
    );

    await expect(
      repository.listS3BackupUploadsTotal({} as never)
    ).resolves.toBe(9);
  });

  it('listS3BackupUploadsTotal returns zero when count is missing', async () => {
    const withoutCount = createSelectDbMock([]);
    const repository = new S3BackupUploadRepository(
      withoutCount.db as never,
      {} as never
    );

    await expect(
      repository.listS3BackupUploadsTotal({} as never)
    ).resolves.toBe(0);
  });

  it('listPendingMigrations normalizes nullable fields', async () => {
    const selectMock = createSelectDbMock([
      {
        s3_backup_upload_id: 's3-id-1',
        account_id: 'acc-1',
        bucket: 'bucket-a',
        object_key: 'path/file.zip',
        file_name: undefined,
        content_type: undefined,
        size_bytes: 1024,
        migration_status: ES3BackupMigrationStatus.pending,
        migration_attempts: undefined,
        migration_last_error: undefined,
        deleted_at: undefined,
      },
    ]);

    const repository = new S3BackupUploadRepository(
      selectMock.db as never,
      {} as never
    );

    await expect(repository.listPendingMigrations(20)).resolves.toEqual([
      {
        s3_backup_upload_id: 's3-id-1',
        account_id: 'acc-1',
        bucket: 'bucket-a',
        object_key: 'path/file.zip',
        file_name: null,
        content_type: null,
        size_bytes: 1024,
        migration_status: ES3BackupMigrationStatus.pending,
        migration_attempts: 0,
        migration_last_error: null,
        deleted_at: null,
      },
    ]);
  });

  it('viewById returns null when upload is not found', async () => {
    const selectMock = createSelectDbMock([]);
    const repository = new S3BackupUploadRepository(
      selectMock.db as never,
      {} as never
    );

    await expect(repository.viewById('s3-id-1')).resolves.toBeNull();
  });

  it('viewById normalizes nullable fields', async () => {
    const selectMock = createSelectDbMock([
      {
        s3_backup_upload_id: 's3-id-1',
        account_id: 'acc-1',
        bucket: 'bucket-a',
        object_key: 'path/file.zip',
        file_name: undefined,
        content_type: undefined,
        size_bytes: 1024,
        migration_status: ES3BackupMigrationStatus.failed,
        migration_attempts: undefined,
        migration_last_error: undefined,
        deleted_at: undefined,
      },
    ]);

    const repository = new S3BackupUploadRepository(
      selectMock.db as never,
      {} as never
    );

    await expect(repository.viewById('s3-id-1')).resolves.toEqual({
      s3_backup_upload_id: 's3-id-1',
      account_id: 'acc-1',
      bucket: 'bucket-a',
      object_key: 'path/file.zip',
      file_name: null,
      content_type: null,
      size_bytes: 1024,
      migration_status: ES3BackupMigrationStatus.failed,
      migration_attempts: 0,
      migration_last_error: null,
      deleted_at: null,
    });
  });

  it.each([
    'updateAsProcessing',
    'updateAsFailed',
    'softDeleteAsMigrated',
    'markReprocessRequested',
  ] as const)(
    '%s returns true when update affects rows',
    async (methodName) => {
      const withRows = createUpdateDbMock({ rowCount: 1 });
      const repository = new S3BackupUploadRepository(
        {} as never,
        withRows.db as never
      );

      if (methodName === 'updateAsProcessing') {
        await expect(repository.updateAsProcessing('s3-id-1', 2)).resolves.toBe(
          true
        );
      }

      if (methodName === 'updateAsFailed') {
        await expect(
          repository.updateAsFailed('s3-id-1', 'migration failed', 2)
        ).resolves.toBe(true);
      }

      if (methodName === 'softDeleteAsMigrated') {
        await expect(
          repository.softDeleteAsMigrated('s3-id-1', 3)
        ).resolves.toBe(true);
      }

      if (methodName === 'markReprocessRequested') {
        await expect(
          repository.markReprocessRequested('s3-id-1')
        ).resolves.toBe(true);
      }
    }
  );

  it.each([
    'updateAsProcessing',
    'updateAsFailed',
    'softDeleteAsMigrated',
    'markReprocessRequested',
  ] as const)(
    '%s returns false when update affects no rows',
    async (methodName) => {
      const withoutRows = createUpdateDbMock({ rowCount: 0 });
      const repository = new S3BackupUploadRepository(
        {} as never,
        withoutRows.db as never
      );

      if (methodName === 'updateAsProcessing') {
        await expect(repository.updateAsProcessing('s3-id-1', 2)).resolves.toBe(
          false
        );
      }

      if (methodName === 'updateAsFailed') {
        await expect(
          repository.updateAsFailed('s3-id-1', 'migration failed', 2)
        ).resolves.toBe(false);
      }

      if (methodName === 'softDeleteAsMigrated') {
        await expect(
          repository.softDeleteAsMigrated('s3-id-1', 3)
        ).resolves.toBe(false);
      }

      if (methodName === 'markReprocessRequested') {
        await expect(
          repository.markReprocessRequested('s3-id-1')
        ).resolves.toBe(false);
      }
    }
  );
});
