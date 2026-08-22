import 'reflect-metadata';
import { createHash } from 'node:crypto';
import {
  IInboundActiveValidationAcquiredClaim,
  InboundActiveValidationLedgerService,
} from '@core/services/inboundActiveValidationLedger.service';

describe('InboundActiveValidationLedgerService', () => {
  const input = {
    accountId: 'account-1',
    workerId: 'worker-1',
    eventId: 'waevt_v1_event-1',
  };

  it('builds a provider-neutral key from stable event identity only', () => {
    const service = new InboundActiveValidationLedgerService({} as never);
    const digest = createHash('sha256')
      .update('account-1\0worker-1\0waevt_v1_event-1')
      .digest('hex');

    expect(service.buildKey(input)).toBe(
      `inbound-active-validation:ledger:v1:${digest}`
    );
    expect(
      service.buildKey({ ...input, eventId: 'waevt_v1_event-2' })
    ).not.toBe(service.buildKey(input));
    expect(service.buildKey({ ...input, eventId: ' ' })).toBeNull();
  });

  it('claims before side effects with a seven-day durable reservation', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue(['acquired', 'reserved']);
    const service = new InboundActiveValidationLedgerService({
      eval: evalMock,
    } as never);

    await expect(service.claim(input)).resolves.toMatchObject({
      status: 'acquired',
      state: 'reserved',
      eventId: input.eventId,
    });

    expect(evalMock.mock.calls[0][4]).toBe(input.eventId);
    expect(evalMock.mock.calls[0][6]).toBe(
      String(InboundActiveValidationLedgerService.TTL_SECONDS)
    );
    const claimScript = String(evalMock.mock.calls[0][0]);
    expect(claimScript).toContain("'state', 'reserved'");
    expect(claimScript).toContain("redis.call('EXPIRE', key, ttl_seconds)");
  });

  it.each(['reserved', 'handled', 'ambiguous'] as const)(
    'treats a %s ledger record as a fail-closed duplicate',
    async (state) => {
      const service = new InboundActiveValidationLedgerService({
        eval: jest.fn(async () => ['duplicate', state]),
      } as never);

      await expect(service.claim(input)).resolves.toMatchObject({
        status: 'duplicate',
        state,
        owner: null,
      });
    }
  );

  it('normalizes corrupt existing records to ambiguous atomically', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue(['duplicate', 'ambiguous']);
    const service = new InboundActiveValidationLedgerService({
      eval: evalMock,
    } as never);

    await expect(service.claim(input)).resolves.toMatchObject({
      status: 'duplicate',
      state: 'ambiguous',
    });

    const claimScript = String(evalMock.mock.calls[0][0]);
    expect(claimScript).toContain("'error', 'invalid_ledger_record'");
    expect(claimScript).toContain("return {'duplicate', state}");
  });

  it('marks handled and ambiguous outcomes with owner-CAS and never deletes on transition failure', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValueOnce(['acquired', 'reserved'])
      .mockResolvedValueOnce('transitioned')
      .mockResolvedValueOnce('owner_mismatch');
    const service = new InboundActiveValidationLedgerService({
      eval: evalMock,
    } as never);
    const claim = (await service.claim(
      input
    )) as IInboundActiveValidationAcquiredClaim;

    await expect(service.markHandled(claim)).resolves.toBe('transitioned');
    await expect(
      service.markAmbiguous(claim, new Error('provider side effect uncertain'))
    ).resolves.toBe('owner_mismatch');

    expect(evalMock.mock.calls[1][3]).toBe(claim.owner);
    expect(evalMock.mock.calls[1][4]).toBe('handled');
    expect(evalMock.mock.calls[2][3]).toBe(claim.owner);
    expect(evalMock.mock.calls[2][4]).toBe('ambiguous');
    const transitionScript = String(evalMock.mock.calls[1][0]);
    expect(transitionScript).toContain("state ~= 'reserved'");
    expect(transitionScript).not.toContain("redis.call('DEL'");
  });

  it('releases a false outcome only through owner-CAS on a reserved claim', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValueOnce(['acquired', 'reserved'])
      .mockResolvedValueOnce('transitioned');
    const service = new InboundActiveValidationLedgerService({
      eval: evalMock,
    } as never);
    const claim = (await service.claim(
      input
    )) as IInboundActiveValidationAcquiredClaim;

    await expect(service.release(claim)).resolves.toBe('transitioned');

    expect(evalMock.mock.calls[1][3]).toBe(claim.owner);
    const releaseScript = String(evalMock.mock.calls[1][0]);
    expect(releaseScript).toContain("state ~= 'reserved'");
    expect(releaseScript).toContain("redis.call('DEL', key)");
  });

  it('fails closed on invalid identity, Redis errors, and malformed replies', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockRejectedValueOnce(new Error('redis unavailable'))
      .mockResolvedValueOnce(['unexpected', 'reserved']);
    const service = new InboundActiveValidationLedgerService({
      eval: evalMock,
    } as never);

    await expect(
      service.claim({ ...input, eventId: '' })
    ).resolves.toMatchObject({ status: 'error' });
    await expect(service.claim(input)).resolves.toMatchObject({
      status: 'error',
    });
    await expect(service.claim(input)).resolves.toMatchObject({
      status: 'error',
    });
  });
});
