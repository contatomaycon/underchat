import 'reflect-metadata';

const mockRandomUUID = jest.fn(() => 'uuid-123');

class MockCreateBucketCommand {
  public readonly input: any;

  constructor(input: any) {
    this.input = input;
  }
}

class MockDeleteObjectCommand {
  public readonly input: any;

  constructor(input: any) {
    this.input = input;
  }
}

class MockGetObjectCommand {
  public readonly input: any;

  constructor(input: any) {
    this.input = input;
  }
}

jest.mock('node:crypto', () => ({
  randomUUID: mockRandomUUID,
}));

jest.mock('@aws-sdk/client-s3', () => ({
  CreateBucketCommand: MockCreateBucketCommand,
  DeleteObjectCommand: MockDeleteObjectCommand,
  GetObjectCommand: MockGetObjectCommand,
  S3Client: class {},
}));

jest.mock('@core/config/environments', () => ({
  s3Environment: {
    s3NfseCertificateBucket: 'nfse-certs-bucket',
  },
}));

jest.mock('@core/services/storage/S3Uploader', () => ({
  S3Uploader: class {},
}));

import { NfseCertificateStorageService } from '@core/services/nfseCertificateStorage.service';

describe('NfseCertificateStorageService', () => {
  const makeService = () => {
    const client = {
      send: jest.fn(),
    };

    const backupClient = {
      send: jest.fn(),
    };

    const s3Uploader = {
      uploadWithRetry: jest.fn(async () => ({ usedBackup: false })),
    };

    const service = new NfseCertificateStorageService(
      client as never,
      backupClient as never,
      s3Uploader as never
    );

    return {
      service,
      client,
      backupClient,
      s3Uploader,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRandomUUID.mockReturnValue('uuid-123');
    jest
      .spyOn(Date.prototype, 'toISOString')
      .mockReturnValue('2026-04-21T12:00:00.000Z');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uploads certificate, ensures bucket and returns metadata', async () => {
    const { service, client, backupClient, s3Uploader } = makeService();

    client.send.mockResolvedValue({});
    backupClient.send.mockResolvedValue({});

    const file = {
      filename: 'certificado.p12',
      mimetype: 'application/pkcs12',
      toBuffer: jest.fn(async () => Buffer.from('p12-data')),
    };

    await expect(
      service.uploadCertificate(file as never, 'acc-1')
    ).resolves.toEqual({
      bucket: 'nfse-certs-bucket',
      key: 'nfse/certificates/acc-1/uuid-123.p12',
      fileName: 'certificado.p12',
      uploadedAt: '2026-04-21T12:00:00.000Z',
    });

    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({ input: { Bucket: 'nfse-certs-bucket' } })
    );
    expect(backupClient.send).toHaveBeenCalledWith(
      expect.objectContaining({ input: { Bucket: 'nfse-certs-bucket' } })
    );
    expect(s3Uploader.uploadWithRetry).toHaveBeenCalledWith({
      bucket: 'nfse-certs-bucket',
      key: 'nfse/certificates/acc-1/uuid-123.p12',
      body: Buffer.from('p12-data'),
      contentType: 'application/pkcs12',
      accountId: 'acc-1',
    });
  });

  it('accepts bucket already exists errors and continues upload with default content-type', async () => {
    const { service, client, backupClient, s3Uploader } = makeService();

    client.send.mockRejectedValueOnce({ name: 'BucketAlreadyOwnedByYou' });
    backupClient.send.mockResolvedValueOnce({});

    const file = {
      filename: 'certificado.pfx',
      mimetype: undefined,
      toBuffer: jest.fn(async () => Buffer.from('pfx-data')),
    };

    await expect(
      service.uploadCertificate(file as never, 'acc-2')
    ).resolves.toEqual({
      bucket: 'nfse-certs-bucket',
      key: 'nfse/certificates/acc-2/uuid-123.pfx',
      fileName: 'certificado.pfx',
      uploadedAt: '2026-04-21T12:00:00.000Z',
    });

    expect(s3Uploader.uploadWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'application/x-pkcs12' })
    );
  });

  it('rejects invalid format and size limit errors', async () => {
    const { service } = makeService();

    await expect(
      service.uploadCertificate(
        {
          filename: 'certificado.txt',
          mimetype: 'text/plain',
          toBuffer: jest.fn(async () => Buffer.from('bad')),
        } as never,
        'acc-1'
      )
    ).rejects.toThrow('NFSE_CERTIFICATE_INVALID_FORMAT');

    await expect(
      service.uploadCertificate(
        {
          filename: 'certificado.p12',
          mimetype: 'text/plain',
          toBuffer: jest.fn(async () => Buffer.from('bad')),
        } as never,
        'acc-1'
      )
    ).rejects.toThrow('NFSE_CERTIFICATE_INVALID_FORMAT');

    await expect(
      service.uploadCertificate(
        {
          filename: 'certificado.p12',
          mimetype: 'application/pkcs12',
          toBuffer: jest.fn(async () => Buffer.alloc(10 * 1024 * 1024 + 1)),
        } as never,
        'acc-1'
      )
    ).rejects.toThrow('NFSE_CERTIFICATE_SIZE_LIMIT_EXCEEDED');
  });

  it('throws when both providers fail bucket creation', async () => {
    const { service, client, backupClient } = makeService();

    client.send.mockRejectedValueOnce(new Error('create failed 1'));
    backupClient.send.mockRejectedValueOnce(new Error('create failed 2'));

    await expect(
      service.uploadCertificate(
        {
          filename: 'certificado.p12',
          mimetype: 'application/pkcs12',
          toBuffer: jest.fn(async () => Buffer.from('ok')),
        } as never,
        'acc-1'
      )
    ).rejects.toThrow('NFSE_CERTIFICATE_BUCKET_CREATE_ERROR');
  });

  it('deletes certificate from both providers and ignores failures', async () => {
    const { service, client, backupClient } = makeService();

    await expect(service.deleteCertificate('', 'k')).resolves.toBeUndefined();
    await expect(service.deleteCertificate('b', '')).resolves.toBeUndefined();
    expect(client.send).not.toHaveBeenCalled();

    client.send.mockResolvedValueOnce({});
    backupClient.send.mockRejectedValueOnce(new Error('backup delete fail'));

    await expect(
      service.deleteCertificate('bucket-1', 'key-1')
    ).resolves.toBeUndefined();

    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({ input: { Bucket: 'bucket-1', Key: 'key-1' } })
    );
    expect(backupClient.send).toHaveBeenCalledWith(
      expect.objectContaining({ input: { Bucket: 'bucket-1', Key: 'key-1' } })
    );
  });

  it('downloads certificate using transformToByteArray and async iterable fallback', async () => {
    const { service, client } = makeService();

    client.send.mockResolvedValueOnce({
      Body: {
        transformToByteArray: jest.fn(async () => new Uint8Array([1, 2, 3])),
      },
    });

    await expect(
      (service as any).downloadCertificateWithClient(client, 'bucket', 'key')
    ).resolves.toEqual(Buffer.from([1, 2, 3]));

    async function* makeStream() {
      yield new Uint8Array([4, 5]);
      yield new Uint8Array([6]);
    }

    client.send.mockResolvedValueOnce({
      Body: makeStream(),
    });

    await expect(
      (service as any).downloadCertificateWithClient(client, 'bucket', 'key')
    ).resolves.toEqual(Buffer.from([4, 5, 6]));

    client.send.mockResolvedValueOnce({ Body: null });
    await expect(
      (service as any).downloadCertificateWithClient(client, 'bucket', 'key')
    ).rejects.toThrow('NFSE_CERTIFICATE_NOT_FOUND');
  });

  it('falls back to backup client when primary download fails', async () => {
    const { service, client, backupClient } = makeService();

    client.send.mockRejectedValueOnce(new Error('primary unavailable'));
    backupClient.send.mockResolvedValueOnce({
      Body: {
        transformToByteArray: jest.fn(async () => new Uint8Array([9, 8, 7])),
      },
    });

    await expect(service.downloadCertificate('bucket', 'key')).resolves.toEqual(
      Buffer.from([9, 8, 7])
    );
  });
});
