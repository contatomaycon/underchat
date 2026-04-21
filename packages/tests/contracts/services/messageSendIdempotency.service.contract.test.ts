import 'reflect-metadata';
import { MessageSendIdempotencyService } from '@core/services/messageSendIdempotency.service';

describe('MessageSendIdempotencyService', () => {
  it('claimSend returns error for invalid segments', async () => {
    const redis = { set: jest.fn(), exists: jest.fn() };
    const service = new MessageSendIdempotencyService(redis as never);

    await expect(service.claimSend('', 'hash')).resolves.toBe('error');
    await expect(service.lookupClaim('acc', '   ')).resolves.toBe('error');
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.exists).not.toHaveBeenCalled();
  });

  it('claimSend returns acquired/duplicate and serializes meta', async () => {
    const set = jest
      .fn<Promise<string | null>, unknown[]>()
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce(null);

    const service = new MessageSendIdempotencyService({
      set,
      exists: jest.fn(),
    } as never);

    await expect(service.claimSend('acc', 'hash', { a: 1 })).resolves.toBe(
      'acquired'
    );
    await expect(service.claimSend('acc', 'hash')).resolves.toBe('duplicate');

    expect(set).toHaveBeenCalledWith(
      'message-send:idempotency:v1:acc:hash',
      JSON.stringify({ a: 1 }),
      'EX',
      expect.any(Number),
      'NX'
    );
  });

  it('claimSend and lookupClaim return error on redis exceptions', async () => {
    const set = jest.fn(async () => {
      throw new Error('set failure');
    });
    const exists = jest.fn(async () => {
      throw new Error('exists failure');
    });

    const service = new MessageSendIdempotencyService({ set, exists } as never);

    await expect(service.claimSend('acc', 'hash')).resolves.toBe('error');
    await expect(service.lookupClaim('acc', 'hash')).resolves.toBe('error');
  });

  it('lookupClaim returns claimed/not_found', async () => {
    const exists = jest
      .fn<Promise<number>, unknown[]>()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const service = new MessageSendIdempotencyService({
      set: jest.fn(),
      exists,
    } as never);

    await expect(service.lookupClaim('acc', 'hash')).resolves.toBe('claimed');
    await expect(service.lookupClaim('acc', 'hash')).resolves.toBe('not_found');
  });
});
