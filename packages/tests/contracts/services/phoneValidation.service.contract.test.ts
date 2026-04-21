import 'reflect-metadata';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-validation-1'),
}));

jest.mock(
  '@core/repositories/worker/WorkerActiveByAccountViewer.repository',
  () => ({
    WorkerActiveByAccountViewerRepository: class {},
  })
);

jest.mock('@core/services/workerGrpcClient.service', () => ({
  WorkerGrpcClientService: class {},
}));

import { PhoneValidationService } from '@core/services/phoneValidation.service';

describe('PhoneValidationService', () => {
  const worker1 = {
    worker_id: 'w1',
    server_id: 's1',
    account_id: 'acc-1',
  };
  const worker2 = {
    worker_id: 'w2',
    server_id: 's2',
    account_id: 'acc-1',
  };
  const worker3 = {
    worker_id: 'w3',
    server_id: 's3',
    account_id: 'acc-1',
  };
  const worker4 = {
    worker_id: 'w4',
    server_id: 's4',
    account_id: 'acc-1',
  };

  const makeService = () => {
    const workerActiveByAccountViewerRepository = {
      viewWorkerActiveByAccount: jest.fn<Promise<any[]>, [string]>(async () => [
        worker1,
      ]),
    };

    const workerGrpcClientService = {
      validatePhone: jest.fn<Promise<any>, [string, any, number]>(async () => ({
        request_id: 'uuid-validation-1',
        account_id: 'acc-1',
        worker_id: 'w1',
        valid: true,
        jid: '55119999@c.us',
      })),
    };

    const redis = {
      get: jest.fn<Promise<string | null>, [string]>(async () => null),
      set: jest.fn<Promise<'OK'>, [string, string, 'EX', number]>(
        async () => 'OK'
      ),
      del: jest.fn<Promise<number>, [string]>(async () => 1),
    };

    const service = new PhoneValidationService(
      workerActiveByAccountViewerRepository as never,
      workerGrpcClientService as never,
      redis as never
    );

    return {
      service,
      workerActiveByAccountViewerRepository,
      workerGrpcClientService,
      redis,
    };
  };

  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds cache key with normalized phone and ddi', () => {
    const { service } = makeService();

    expect(
      (service as any).getCacheKey('acc-1', '+55 (11) 99999-8888', '+55')
    ).toBe('phone_validation_result:acc-1:555511999998888');
    expect((service as any).getCacheKey('acc-1', '(11) 99999-8888', null)).toBe(
      'phone_validation_result:acc-1:11999998888'
    );
  });

  it('gets/sets/removes cached results', async () => {
    const { service, redis } = makeService();

    const payload = {
      request_id: 'id-1',
      account_id: 'acc-1',
      worker_id: 'w1',
      valid: true,
      jid: '5511@c.us',
    };

    redis.get.mockResolvedValueOnce(JSON.stringify(payload));
    await expect(
      (service as any).getCachedResult('acc-1', '55119999', '+55')
    ).resolves.toEqual(payload);

    redis.get.mockResolvedValueOnce(null);
    await expect(
      (service as any).getCachedResult('acc-1', '55119999', '+55')
    ).resolves.toBeNull();

    await expect(
      (service as any).setCachedResult('acc-1', '55119999', '+55', payload)
    ).resolves.toBeUndefined();
    expect(redis.set).toHaveBeenCalledWith(
      'phone_validation_result:acc-1:5555119999',
      JSON.stringify(payload),
      'EX',
      30
    );

    await expect(
      (service as any).removeCachedResult('acc-1', '55119999', '+55')
    ).resolves.toBeUndefined();
    expect(redis.del).toHaveBeenCalledWith(
      'phone_validation_result:acc-1:5555119999'
    );
  });

  it('validateWithWorker sends request payload with generated request id', async () => {
    const { service, workerGrpcClientService } = makeService();

    const response = {
      request_id: 'uuid-validation-1',
      account_id: 'acc-1',
      worker_id: 'w1',
      valid: true,
    };
    workerGrpcClientService.validatePhone.mockResolvedValueOnce(response);

    await expect(
      (service as any).validateWithWorker(
        worker1,
        'acc-1',
        '55119999',
        '+55',
        1234
      )
    ).resolves.toEqual(response);

    expect(workerGrpcClientService.validatePhone).toHaveBeenCalledWith(
      's1',
      {
        request_id: 'uuid-validation-1',
        account_id: 'acc-1',
        worker_id: 'w1',
        phone: '55119999',
        phone_ddi: '+55',
      },
      1234
    );

    await expect(
      (service as any).validateWithWorker(worker1, 'acc-1', '55119999')
    ).resolves.toEqual(
      expect.objectContaining({
        worker_id: 'w1',
      })
    );
  });

  it('classifies validation and retryable errors', () => {
    const { service } = makeService();

    expect(
      (service as any).isValidationError(
        new Error('phone_number_not_valid_on_whatsapp')
      )
    ).toBe(true);
    expect(
      (service as any).isValidationError(
        new Error('Phone number is valid on WhatsApp')
      )
    ).toBe(true);
    expect((service as any).isValidationError(new Error('other'))).toBe(false);

    expect(
      (service as any).isRetryableError(new Error('deadline exceeded'))
    ).toBe(true);
    expect(
      (service as any).isRetryableError(new Error('connection unavailable'))
    ).toBe(true);
    expect(
      (service as any).isRetryableError(new Error('fatal bad request'))
    ).toBe(false);
  });

  it('processes validation response branches and caches expected values', async () => {
    const { service } = makeService();
    const setSpy = jest
      .spyOn(service as any, 'setCachedResult')
      .mockResolvedValue(undefined);

    const validResponse = {
      request_id: 'r1',
      account_id: 'acc-1',
      worker_id: 'w1',
      valid: true,
    };
    await expect(
      (service as any).processValidationResponse(
        validResponse,
        'acc-1',
        '5511',
        '+55'
      )
    ).resolves.toEqual(validResponse);

    const validationErrorResponse = {
      request_id: 'r2',
      account_id: 'acc-1',
      worker_id: 'w1',
      error: 'Phone number is not valid on WhatsApp',
    };
    await expect(
      (service as any).processValidationResponse(
        validationErrorResponse,
        'acc-1',
        '5511',
        '+55'
      )
    ).resolves.toEqual(validationErrorResponse);

    const nonValidationErrorResponse = {
      request_id: 'r3',
      account_id: 'acc-1',
      worker_id: 'w1',
      error: 'grpc internal',
    };
    await expect(
      (service as any).processValidationResponse(
        nonValidationErrorResponse,
        'acc-1',
        '5511',
        '+55'
      )
    ).resolves.toBeNull();

    const fallbackResponse = {
      request_id: 'r4',
      account_id: 'acc-1',
      worker_id: 'w1',
    };
    await expect(
      (service as any).processValidationResponse(
        fallbackResponse,
        'acc-1',
        '5511',
        '+55'
      )
    ).resolves.toEqual(fallbackResponse);

    expect(setSpy).toHaveBeenCalledTimes(3);
  });

  it('handles validation error branches with retry decision', async () => {
    const { service } = makeService();
    const removeSpy = jest
      .spyOn(service as any, 'removeCachedResult')
      .mockResolvedValue(undefined);

    await expect(
      (service as any).handleValidationError(
        'non-error',
        'acc-1',
        '5511',
        '+55'
      )
    ).resolves.toEqual({
      shouldRetry: false,
      error: new Error('non-error'),
    });

    await expect(
      (service as any).handleValidationError(
        new Error('timeout on grpc'),
        'acc-1',
        '5511',
        '+55'
      )
    ).resolves.toEqual({
      shouldRetry: true,
      error: new Error('timeout on grpc'),
    });

    await expect(
      (service as any).handleValidationError(
        new Error('Phone number is valid on WhatsApp'),
        'acc-1',
        '5511',
        '+55'
      )
    ).rejects.toThrow('Phone number is valid on WhatsApp');

    await expect(
      (service as any).handleValidationError(
        new Error('bad worker payload'),
        'acc-1',
        '5511',
        '+55'
      )
    ).resolves.toEqual({
      shouldRetry: true,
      error: new Error('bad worker payload'),
    });

    expect(removeSpy).toHaveBeenCalledTimes(3);
  });

  it('prioritizes preferred worker when present', () => {
    const { service } = makeService();

    expect(
      (service as any).prioritizeWorkersForValidation([worker1, worker2], 'w2')
    ).toEqual([worker2, worker1]);
    expect(
      (service as any).prioritizeWorkersForValidation([worker1, worker2], 'w3')
    ).toEqual([worker1, worker2]);
    expect(
      (service as any).prioritizeWorkersForValidation([worker1, worker2])
    ).toEqual([worker1, worker2]);
  });

  it('tries validation with up to 3 workers and returns first processed response', async () => {
    const { service } = makeService();

    const validateSpy = jest
      .spyOn(service as any, 'validateWithWorker')
      .mockResolvedValueOnce({
        request_id: 'r1',
        account_id: 'acc-1',
        worker_id: 'w1',
        valid: false,
      });
    const processSpy = jest
      .spyOn(service as any, 'processValidationResponse')
      .mockResolvedValueOnce({
        request_id: 'r1',
        account_id: 'acc-1',
        worker_id: 'w1',
        valid: false,
      });

    await expect(
      (service as any).tryValidateWithWorkers(
        [worker1, worker2, worker3, worker4],
        'acc-1',
        '5511',
        '+55',
        5000
      )
    ).resolves.toEqual({
      request_id: 'r1',
      account_id: 'acc-1',
      worker_id: 'w1',
      valid: false,
    });

    expect(validateSpy).toHaveBeenCalledTimes(1);
    expect(processSpy).toHaveBeenCalledTimes(1);
  });

  it('propagates handled error when worker strategy fails', async () => {
    const { service } = makeService();

    jest
      .spyOn(service as any, 'validateWithWorker')
      .mockRejectedValue(new Error('deadline exceeded'));
    jest.spyOn(service as any, 'handleValidationError').mockResolvedValue({
      shouldRetry: false,
      error: new Error('hard-stop'),
    });

    await expect(
      (service as any).tryValidateWithWorkers(
        [worker1],
        'acc-1',
        '5511',
        '+55',
        5000
      )
    ).rejects.toThrow('hard-stop');
  });

  it('stores last error from null processed response and throws it after workers end', async () => {
    const { service } = makeService();

    jest
      .spyOn(service as any, 'removeCachedResult')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'validateWithWorker').mockResolvedValue({
      request_id: 'r-null',
      account_id: 'acc-1',
      worker_id: 'w1',
      error: 'worker returned empty processed response',
    });
    jest
      .spyOn(service as any, 'processValidationResponse')
      .mockResolvedValueOnce(null);

    await expect(
      (service as any).tryValidateWithWorkers(
        [worker1],
        'acc-1',
        '5511',
        '+55',
        5000
      )
    ).rejects.toThrow('worker returned empty processed response');
  });

  it('uses unknown validation fallback message when response.error is empty', async () => {
    const { service } = makeService();

    jest
      .spyOn(service as any, 'removeCachedResult')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'validateWithWorker').mockResolvedValue({
      request_id: 'r-empty',
      account_id: 'acc-1',
      worker_id: 'w1',
    });
    jest
      .spyOn(service as any, 'processValidationResponse')
      .mockResolvedValueOnce(null);

    await expect(
      (service as any).tryValidateWithWorkers(
        [worker1],
        'acc-1',
        '5511',
        undefined,
        5000
      )
    ).rejects.toThrow('Unknown validation error');
  });

  it('retries on handled retryable errors and throws last handled error after loop', async () => {
    const { service } = makeService();

    jest
      .spyOn(service as any, 'removeCachedResult')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'validateWithWorker')
      .mockRejectedValue(new Error('transient timeout'));
    jest.spyOn(service as any, 'handleValidationError').mockResolvedValue({
      shouldRetry: true,
      error: new Error('retryable-processed-error'),
    });

    await expect(
      (service as any).tryValidateWithWorkers(
        [worker1],
        'acc-1',
        '5511',
        '+55',
        5000
      )
    ).rejects.toThrow('retryable-processed-error');
  });

  it('logs non-Error worker exception payload branch and still retries', async () => {
    const { service } = makeService();

    jest
      .spyOn(service as any, 'removeCachedResult')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'validateWithWorker')
      .mockRejectedValue('raw-failure');
    jest.spyOn(service as any, 'handleValidationError').mockResolvedValue({
      shouldRetry: true,
      error: new Error('converted-failure'),
    });

    await expect(
      (service as any).tryValidateWithWorkers(
        [worker1],
        'acc-1',
        '5511',
        undefined,
        5000
      )
    ).rejects.toThrow('converted-failure');
  });

  it('throws generic error when no worker attempt generates a result', async () => {
    const { service } = makeService();

    jest
      .spyOn(service as any, 'removeCachedResult')
      .mockResolvedValue(undefined);

    await expect(
      (service as any).tryValidateWithWorkers([], 'acc-1', '5511', '+55', 5000)
    ).rejects.toThrow('Failed to validate phone with all available workers');
  });

  it('validatePhone returns cached result, supports bypass and preferred worker', async () => {
    const { service, workerActiveByAccountViewerRepository, redis } =
      makeService();

    const cachedResponse = {
      request_id: 'cached-id',
      account_id: 'acc-1',
      worker_id: 'w1',
      valid: true,
    };

    redis.get.mockResolvedValueOnce(JSON.stringify(cachedResponse));

    await expect(
      service.validatePhone('acc-1', '55119999', '+55')
    ).resolves.toEqual(cachedResponse);
    expect(
      workerActiveByAccountViewerRepository.viewWorkerActiveByAccount
    ).not.toHaveBeenCalled();

    redis.get.mockResolvedValueOnce(null);
    workerActiveByAccountViewerRepository.viewWorkerActiveByAccount.mockResolvedValueOnce(
      []
    );

    await expect(
      service.validatePhone('acc-1', '55119999', '+55', 5000, {
        bypassCache: true,
      })
    ).rejects.toThrow('No active worker found for this account');

    redis.get.mockResolvedValueOnce(null);
    workerActiveByAccountViewerRepository.viewWorkerActiveByAccount.mockResolvedValueOnce(
      [worker1, worker2]
    );

    const trySpy = jest
      .spyOn(service as any, 'tryValidateWithWorkers')
      .mockResolvedValueOnce({
        request_id: 'r-final',
        account_id: 'acc-1',
        worker_id: 'w2',
        valid: true,
      });

    await expect(
      service.validatePhone('acc-1', '55119999', '+55', 4000, {
        preferredWorkerId: 'w2',
      })
    ).resolves.toEqual({
      request_id: 'r-final',
      account_id: 'acc-1',
      worker_id: 'w2',
      valid: true,
    });

    expect(trySpy).toHaveBeenCalledWith(
      [worker2, worker1],
      'acc-1',
      '55119999',
      '+55',
      4000
    );

    redis.get.mockResolvedValueOnce(null);
    workerActiveByAccountViewerRepository.viewWorkerActiveByAccount.mockResolvedValueOnce(
      [worker1, worker2]
    );
    trySpy.mockResolvedValueOnce({
      request_id: 'r-order',
      account_id: 'acc-1',
      worker_id: 'w1',
      valid: true,
    });

    await expect(service.validatePhone('acc-1', '55119999')).resolves.toEqual({
      request_id: 'r-order',
      account_id: 'acc-1',
      worker_id: 'w1',
      valid: true,
    });

    expect(trySpy).toHaveBeenLastCalledWith(
      [worker1, worker2],
      'acc-1',
      '55119999',
      undefined,
      5000
    );
  });
});
