import 'reflect-metadata';
import {
  CreateBucketCommand,
  DeletePublicAccessBlockCommand,
  ExpirationStatus,
  HeadBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { BucketManager } from '@core/services/storage/BucketManager';

describe('BucketManager', () => {
  const makeService = () => {
    const send = jest.fn<Promise<unknown>, [unknown]>();
    const service = new BucketManager({ send } as never);

    return { service, send };
  };

  const useImmediateTimeout = () => {
    return jest.spyOn(global, 'setTimeout').mockImplementation(((
      handler: TimerHandler
    ) => {
      if (typeof handler === 'function') {
        handler();
      }

      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('validates account id and rejects invalid bucket names', () => {
    const { service } = makeService();

    expect((service as any).validateAccountId('abc-1')).toBe('abc-1');
    expect((service as any).validateAccountId('  abc-1  ')).toBe('abc-1');

    expect(() => (service as any).validateAccountId('')).toThrow(
      'Invalid accountId provided'
    );
    expect(() => (service as any).validateAccountId('ab')).toThrow(
      'Bucket name must be between 3 and 63 characters'
    );
    expect(() => (service as any).validateAccountId('A-bucket')).toThrow(
      'Bucket name can only contain lowercase letters, numbers, dots, and hyphens'
    );
    expect(() => (service as any).validateAccountId('.bucket')).toThrow(
      'Bucket name cannot start or end with a dot'
    );
    expect(() => (service as any).validateAccountId('bucket-')).toThrow(
      'Bucket name cannot start or end with a hyphen'
    );
    expect(() => (service as any).validateAccountId('a..b')).toThrow(
      'Bucket name cannot contain consecutive dots'
    );
    expect(() => (service as any).validateAccountId('127.0.0.1')).toThrow(
      'Bucket name cannot be formatted as an IP address'
    );
  });

  it('classifies bucket, retry and capability errors', () => {
    const { service } = makeService();

    expect(
      (service as any).isBucketExistsError({ name: 'BucketAlreadyExists' })
    ).toBe(true);
    expect(
      (service as any).isBucketExistsError({ Code: 'BucketNotEmpty' })
    ).toBe(true);
    expect((service as any).isBucketExistsError({ name: 'Other' })).toBe(false);

    expect((service as any).isNoSuchBucketError({ name: 'NoSuchBucket' })).toBe(
      true
    );
    expect((service as any).isNoSuchBucketError({ Code: 'NoSuchBucket' })).toBe(
      true
    );
    expect(
      (service as any).isNoSuchBucketError({
        $metadata: { httpStatusCode: 404 },
      })
    ).toBe(true);

    expect((service as any).isRetryableError({ name: 'InternalError' })).toBe(
      true
    );
    expect(
      (service as any).isRetryableError({ $metadata: { httpStatusCode: 503 } })
    ).toBe(true);
    expect((service as any).isRetryableError({ code: 'ETIMEDOUT' })).toBe(true);
    expect((service as any).isRetryableError(null)).toBe(false);
    expect((service as any).isRetryableError({ name: 'AccessDenied' })).toBe(
      false
    );

    expect(
      (service as any).isPublicAccessBlockUnsupportedError({
        name: 'InvalidRequest',
      })
    ).toBe(true);
    expect(
      (service as any).isPublicAccessBlockUnsupportedError({
        message: 'feature not supported',
      })
    ).toBe(true);
    expect((service as any).isPublicAccessBlockUnsupportedError(null)).toBe(
      false
    );

    expect(
      (service as any).isLifecycleNotSupportedError({ name: 'NotImplemented' })
    ).toBe(true);
    expect(
      (service as any).isLifecycleNotSupportedError({
        Code: 'MethodNotAllowed',
      })
    ).toBe(true);
    expect(
      (service as any).isLifecycleNotSupportedError({ name: 'Other' })
    ).toBe(false);
  });

  it('createBucket handles success, existing bucket, retry and throw branches', async () => {
    const { service, send } = makeService();
    const timeoutSpy = useImmediateTimeout();

    try {
      send.mockResolvedValueOnce({});
      await expect(
        (service as any).createBucket('bucket-1')
      ).resolves.toBeUndefined();
      expect(send).toHaveBeenCalledWith(expect.any(CreateBucketCommand));

      send.mockReset();
      send.mockRejectedValueOnce({ name: 'BucketAlreadyOwnedByYou' });
      await expect(
        (service as any).createBucket('bucket-2')
      ).resolves.toBeUndefined();
      expect(service.isBucketVerified('bucket-2')).toBe(true);

      send.mockReset();
      send
        .mockRejectedValueOnce({ name: 'ServiceUnavailable' })
        .mockResolvedValueOnce({});
      await expect(
        (service as any).createBucket('bucket-3')
      ).resolves.toBeUndefined();
      expect(timeoutSpy).toHaveBeenCalled();

      const err = new Error('create-fail');
      send.mockReset();
      send.mockRejectedValueOnce(err);
      await expect((service as any).createBucket('bucket-4')).rejects.toBe(err);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('removePublicAccessBlock handles skip, retry and throw branches', async () => {
    const { service, send } = makeService();
    const timeoutSpy = useImmediateTimeout();

    try {
      send.mockResolvedValueOnce({});
      await expect(
        (service as any).removePublicAccessBlock('bucket-1')
      ).resolves.toBeUndefined();
      expect(send).toHaveBeenCalledWith(
        expect.any(DeletePublicAccessBlockCommand)
      );

      send.mockReset();
      send.mockRejectedValueOnce({
        name: 'NoSuchPublicAccessBlockConfiguration',
      });
      await expect(
        (service as any).removePublicAccessBlock('bucket-2')
      ).resolves.toBeUndefined();

      send.mockReset();
      send.mockRejectedValueOnce({
        message: 'publicaccessblock not supported',
      });
      await expect(
        (service as any).removePublicAccessBlock('bucket-3')
      ).resolves.toBeUndefined();

      send.mockReset();
      send
        .mockRejectedValueOnce({ name: 'RequestTimeout' })
        .mockResolvedValueOnce({});
      await expect(
        (service as any).removePublicAccessBlock('bucket-4')
      ).resolves.toBeUndefined();
      expect(timeoutSpy).toHaveBeenCalled();

      const err = new Error('remove-fail');
      send.mockReset();
      send.mockRejectedValueOnce(err);
      await expect(
        (service as any).removePublicAccessBlock('bucket-5')
      ).rejects.toBe(err);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('setLifecyclePolicy handles success, unsupported, no-such-bucket and retry', async () => {
    const { service, send } = makeService();
    const timeoutSpy = useImmediateTimeout();

    try {
      send.mockResolvedValueOnce({});
      await expect(
        (service as any).setLifecyclePolicy('bucket-1')
      ).resolves.toBeUndefined();
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: 'bucket-1',
            LifecycleConfiguration: expect.objectContaining({
              Rules: expect.arrayContaining([
                expect.objectContaining({
                  ID: 'ExpireChatbotApiTemporaryAfter7Days',
                  Status: ExpirationStatus.Enabled,
                  Filter: { Prefix: 'chatbot-api-temporary/' },
                  Expiration: { Days: 7 },
                }),
                expect.objectContaining({
                  ID: 'ExpireAfter6Months',
                  Status: ExpirationStatus.Enabled,
                }),
              ]),
            }),
          }),
        })
      );

      send.mockReset();
      send.mockRejectedValueOnce({ name: 'NotImplemented' });
      await expect(
        (service as any).setLifecyclePolicy('bucket-2')
      ).resolves.toBeUndefined();

      send.mockReset();
      send.mockRejectedValueOnce({ name: 'NoSuchBucket' });
      await expect(
        (service as any).setLifecyclePolicy('bucket-3')
      ).resolves.toBeUndefined();

      send.mockReset();
      send
        .mockRejectedValueOnce({ $metadata: { httpStatusCode: 500 } })
        .mockResolvedValueOnce({});
      await expect(
        (service as any).setLifecyclePolicy('bucket-4')
      ).resolves.toBeUndefined();
      expect(timeoutSpy).toHaveBeenCalled();

      const err = new Error('lifecycle-fail');
      send.mockReset();
      send.mockRejectedValueOnce(err);
      await expect(
        (service as any).setLifecyclePolicy('bucket-5')
      ).rejects.toBe(err);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('setPublicPolicy handles no-such-bucket recreation, retry, existing bucket and throw', async () => {
    const { service, send } = makeService();
    const timeoutSpy = useImmediateTimeout();

    try {
      send.mockResolvedValueOnce({});
      await expect(
        (service as any).setPublicPolicy('bucket-1')
      ).resolves.toBeUndefined();
      expect(send).toHaveBeenCalledWith(expect.any(PutBucketPolicyCommand));

      send.mockReset();
      const createSpy = jest
        .spyOn(service as any, 'createBucket')
        .mockResolvedValue(undefined);
      send
        .mockRejectedValueOnce({ name: 'NoSuchBucket' })
        .mockResolvedValueOnce({});

      await expect(
        (service as any).setPublicPolicy('bucket-2')
      ).resolves.toBeUndefined();
      expect(createSpy).toHaveBeenCalledWith('bucket-2');
      createSpy.mockRestore();

      send.mockReset();
      send.mockRejectedValueOnce({ name: 'BucketAlreadyExists' });
      await expect(
        (service as any).setPublicPolicy('bucket-3')
      ).resolves.toBeUndefined();
      expect(service.isBucketVerified('bucket-3')).toBe(true);

      send.mockReset();
      send
        .mockRejectedValueOnce({ code: 'ECONNRESET' })
        .mockResolvedValueOnce({});
      await expect(
        (service as any).setPublicPolicy('bucket-4')
      ).resolves.toBeUndefined();
      expect(timeoutSpy).toHaveBeenCalled();

      const err = new Error('policy-fail');
      send.mockReset();
      send.mockRejectedValueOnce(err);
      await expect((service as any).setPublicPolicy('bucket-5')).rejects.toBe(
        err
      );
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('ensures bucket lifecycle and supports verified shortcuts', async () => {
    const { service } = makeService();

    const createSpy = jest
      .spyOn(service as any, 'createBucket')
      .mockResolvedValue(undefined);
    const removeSpy = jest
      .spyOn(service as any, 'removePublicAccessBlock')
      .mockResolvedValue(undefined);
    const policySpy = jest
      .spyOn(service as any, 'setPublicPolicy')
      .mockResolvedValue(undefined);
    const lifecycleSpy = jest
      .spyOn(service as any, 'setLifecyclePolicy')
      .mockResolvedValue(undefined);

    await expect(service.ensurePublicBucket('acc-test-1')).resolves.toBe(
      'acc-test-1'
    );

    expect(createSpy).toHaveBeenCalledWith('acc-test-1');
    expect(removeSpy).toHaveBeenCalledWith('acc-test-1');
    expect(policySpy).toHaveBeenCalledWith('acc-test-1');
    expect(lifecycleSpy).toHaveBeenCalledWith('acc-test-1');
    expect(service.isBucketVerified('acc-test-1')).toBe(true);

    createSpy.mockClear();
    await expect(service.ensurePublicBucket('acc-test-1')).resolves.toBe(
      'acc-test-1'
    );
    expect(createSpy).not.toHaveBeenCalled();

    expect(service.validateAndGetBucketId('acc-test-2')).toBe('acc-test-2');

    createSpy.mockRestore();
    removeSpy.mockRestore();
    policySpy.mockRestore();
    lifecycleSpy.mockRestore();
  });

  it('checks cached bucket existence before using verified shortcut', async () => {
    const { service, send } = makeService();

    jest.spyOn(service as any, 'createBucket').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'removePublicAccessBlock')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'setPublicPolicy').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'setLifecyclePolicy')
      .mockResolvedValue(undefined);

    await service.ensurePublicBucket('acc-ready');

    send.mockResolvedValueOnce({});
    await expect(service.isBucketReady('acc-ready')).resolves.toBe(true);
    expect(send.mock.calls[send.mock.calls.length - 1]?.[0]).toBeInstanceOf(
      HeadBucketCommand
    );

    send.mockRejectedValueOnce({ name: 'NoSuchBucket' });
    await expect(service.isBucketReady('acc-ready')).resolves.toBe(false);
    expect(service.isBucketVerified('acc-ready')).toBe(false);
  });

  it('recognizes an existing uncached bucket as ready without create flow', async () => {
    const { service, send } = makeService();

    send.mockResolvedValueOnce({});

    await expect(service.isBucketReady('acc-existing')).resolves.toBe(true);

    expect(service.isBucketVerified('acc-existing')).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadBucketCommand);
  });

  it('deduplicates concurrent bucket setup for the same account', async () => {
    const { service } = makeService();

    let releaseCreate: (() => void) | undefined;
    const createStarted = new Promise<void>((resolve) => {
      jest.spyOn(service as any, 'createBucket').mockImplementation(
        () =>
          new Promise<void>((release) => {
            releaseCreate = release;
            resolve();
          })
      );
    });
    const removeSpy = jest
      .spyOn(service as any, 'removePublicAccessBlock')
      .mockResolvedValue(undefined);
    const policySpy = jest
      .spyOn(service as any, 'setPublicPolicy')
      .mockResolvedValue(undefined);
    const lifecycleSpy = jest
      .spyOn(service as any, 'setLifecyclePolicy')
      .mockResolvedValue(undefined);

    const first = service.ensurePublicBucket('acc-concurrent');
    await createStarted;
    const second = service.ensurePublicBucket('acc-concurrent');

    releaseCreate?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      'acc-concurrent',
      'acc-concurrent',
    ]);

    expect((service as any).createBucket).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(policySpy).toHaveBeenCalledTimes(1);
    expect(lifecycleSpy).toHaveBeenCalledTimes(1);
  });

  it('covers command types for lifecycle and policy operations', async () => {
    const { service, send } = makeService();

    send.mockResolvedValue({});

    await expect(
      (service as any).setLifecyclePolicy('bucket-9')
    ).resolves.toBeUndefined();
    await expect(
      (service as any).setPublicPolicy('bucket-9')
    ).resolves.toBeUndefined();

    expect(
      send.mock.calls.some(([c]) => c instanceof PutBucketPolicyCommand)
    ).toBe(true);
    expect(
      send.mock.calls.some(
        ([c]) => c instanceof PutBucketLifecycleConfigurationCommand
      )
    ).toBe(true);
  });
});
