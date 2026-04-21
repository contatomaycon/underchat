import 'reflect-metadata';
jest.mock('@core/services/s3BackupUpload.service', () => ({
  S3BackupUploadService: class {},
}));
jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { container } from 'tsyringe';
import { S3Uploader } from '@core/services/storage/S3Uploader';

describe('S3Uploader', () => {
  const baseParams = {
    bucket: 'bucket-1',
    key: 'folder/file.jpg',
    body: Buffer.from('payload'),
    contentType: 'image/jpeg',
  };

  const makeService = () => {
    const primarySend = jest.fn<Promise<unknown>, [unknown]>();
    const backupSend = jest.fn<Promise<unknown>, [unknown]>();
    const grpcRegister = jest.fn<Promise<void>, [unknown]>();

    const service = new S3Uploader(
      { send: primarySend } as never,
      { send: backupSend } as never,
      {
        registerS3BackupFallbackUpload: grpcRegister,
      } as never
    );

    const sleep = jest.fn<Promise<void>, [number]>(async () => undefined);
    (service as any).sleep = sleep;

    return {
      service,
      primarySend,
      backupSend,
      grpcRegister,
      sleep,
    };
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uploads with primary client on first try', async () => {
    const { service, primarySend, backupSend } = makeService();
    primarySend.mockResolvedValueOnce({});

    await expect(service.uploadWithRetry(baseParams)).resolves.toEqual({
      usedBackup: false,
      primaryAttempts: 1,
      backupAttempts: 0,
      primaryError: null,
      backupError: null,
    });

    expect(primarySend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    expect(backupSend).not.toHaveBeenCalled();
  });

  it('retries primary upload and reports attempts', async () => {
    const { service, primarySend, sleep } = makeService();

    primarySend
      .mockRejectedValueOnce(new Error('temporary-1'))
      .mockRejectedValueOnce(new Error('temporary-2'))
      .mockResolvedValueOnce({});

    await expect(service.uploadWithRetry(baseParams)).resolves.toMatchObject({
      usedBackup: false,
      primaryAttempts: 3,
    });

    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000);
  });

  it('falls back to backup client and registers locally when primary fails', async () => {
    const { service, primarySend, backupSend, grpcRegister } = makeService();
    const localRegister = jest.fn<Promise<void>, [unknown]>(
      async () => undefined
    );
    const resolveSpy = jest
      .spyOn(container, 'resolve')
      .mockReturnValue({ registerFallbackUpload: localRegister } as never);

    primarySend.mockRejectedValue(new Error('primary-down'));
    backupSend
      .mockRejectedValueOnce(new Error('backup-temporary'))
      .mockResolvedValueOnce({});

    await expect(
      service.uploadWithRetry({
        ...baseParams,
        accountId: 'acc-1',
      })
    ).resolves.toEqual({
      usedBackup: true,
      primaryAttempts: 3,
      backupAttempts: 2,
      primaryError: 'primary-down',
      backupError: null,
    });

    expect(resolveSpy).toHaveBeenCalled();
    expect(localRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'acc-1',
        file_name: 'file.jpg',
        size_bytes: baseParams.body.byteLength,
        primary_attempts: 3,
        backup_attempts: 2,
      })
    );
    expect(grpcRegister).not.toHaveBeenCalled();
  });

  it('uses grpc fallback registration when local registration fails', async () => {
    const { service, grpcRegister } = makeService();
    jest.spyOn(container, 'resolve').mockReturnValue({
      registerFallbackUpload: jest.fn(async () => {
        throw new Error('db-down');
      }),
    } as never);

    await expect(
      (service as any).registerBackupFallbackUpload(
        {
          ...baseParams,
          accountId: 'acc-2',
        },
        {
          primaryAttempts: 3,
          backupAttempts: 1,
          primaryError: 'x',
          backupError: null,
        }
      )
    ).resolves.toBeUndefined();

    expect(grpcRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'acc-2',
        object_key: 'folder/file.jpg',
      })
    );
  });

  it('swallows grpc registration error and logs', async () => {
    const { service, grpcRegister } = makeService();
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    jest.spyOn(container, 'resolve').mockImplementation(() => {
      throw new Error('resolve-fail');
    });
    grpcRegister.mockRejectedValueOnce(new Error('grpc-down'));

    try {
      await expect(
        (service as any).registerBackupFallbackUpload(
          {
            ...baseParams,
            bucket: ' ',
            key: 'nfse/certificates/account-9/cert.pfx',
          },
          {
            primaryAttempts: 3,
            backupAttempts: 1,
            primaryError: 'x',
            backupError: null,
          }
        )
      ).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Erro ao registrar fallback no S3 backup:',
        expect.any(Error)
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('does not register fallback when account id cannot be resolved', async () => {
    const { service, grpcRegister } = makeService();
    const resolveSpy = jest.spyOn(container, 'resolve');

    await expect(
      (service as any).registerBackupFallbackUpload(
        {
          ...baseParams,
          bucket: '   ',
          key: 'folder/no-account/file.bin',
        },
        {
          primaryAttempts: 3,
          backupAttempts: 1,
          primaryError: 'x',
          backupError: null,
        }
      )
    ).resolves.toBeUndefined();

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(grpcRegister).not.toHaveBeenCalled();
  });

  it('throws aggregated error when primary and backup uploads both fail', async () => {
    const { service, primarySend, backupSend } = makeService();

    primarySend.mockRejectedValue(new Error('primary-hard-fail'));
    backupSend.mockRejectedValue(new Error('backup-hard-fail'));

    await expect(service.uploadWithRetry(baseParams)).rejects.toThrow(
      'S3 upload failed on primary and backup: primary=primary-hard-fail; backup=backup-hard-fail'
    );
  });

  it('covers helper branches for attempts and error message normalization', () => {
    const { service } = makeService();

    expect((service as any).getAttemptsFromError({ attempts: 9 })).toBe(9);
    expect((service as any).getAttemptsFromError({ attempts: 'x' })).toBe(3);

    expect((service as any).toErrorMessage(null)).toBe('Unknown upload error');
    expect((service as any).toErrorMessage(new Error('boom'))).toBe('boom');
    expect((service as any).toErrorMessage('plain-error')).toBe('plain-error');
    expect((service as any).toErrorMessage({ message: 'obj' })).toBe(
      JSON.stringify({ message: 'obj' })
    );

    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect((service as any).toErrorMessage(circular)).toBe(
      'Unknown upload error'
    );

    const wrapped = (service as any).buildAttemptsExceededError(
      new Error('internal-fail'),
      7
    );

    expect(wrapped).toBeInstanceOf(Error);
    expect((wrapped as any).attempts).toBe(7);
    expect((wrapped as any).originalError).toBeInstanceOf(Error);
  });

  it('covers helper branches for accountId and filename extraction', () => {
    const { service } = makeService();

    expect((service as any).extractFileName('folder/a/b/file.ext')).toBe(
      'file.ext'
    );
    expect((service as any).extractFileName('////')).toBeNull();

    expect((service as any).resolveAccountId('bucket-x', 'ignored')).toBe(
      'bucket-x'
    );
    expect(
      (service as any).resolveAccountId(
        '   ',
        'nfse/certificates/account-55/my-cert.pfx'
      )
    ).toBe('account-55');
    expect(
      (service as any).resolveAccountId('   ', 'folder/no-match')
    ).toBeNull();
  });
});
