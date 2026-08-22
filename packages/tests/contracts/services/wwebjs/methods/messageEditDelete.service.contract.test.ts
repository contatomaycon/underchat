import 'reflect-metadata';

jest.mock('@core/services/wwebjs/methods/helpers.service', () => ({
  WwebjsHelpersService: class {},
}));

jest.mock('@core/services/wwebjs/util/messageToWaLike', () => ({
  messageToWaLike: jest.fn((message: unknown) =>
    message ? { key: { id: 'normalized-message' } } : undefined
  ),
}));

import { WwebjsMessageEditDeleteService } from '@core/services/wwebjs/methods/messageEditDelete.service';

describe('WwebjsMessageEditDeleteService provider boundary', () => {
  const key = {
    id: 'stanza-1',
    remoteJid: '5511999999999@c.us',
    fromMe: true,
  };

  function makeService() {
    const client = {};

    return new WwebjsMessageEditDeleteService({
      getClient: jest.fn(() => client),
      invokeProviderLookup: jest.fn(
        async (
          _client: unknown,
          _operation: string,
          invoke: () => Promise<unknown>
        ) => invoke()
      ),
      invokeProviderMutation: jest.fn(
        async (
          _client: unknown,
          _operation: string,
          beforeProviderInvoke: (() => Promise<void>) | undefined,
          invoke: () => Promise<unknown>
        ) => {
          await beforeProviderInvoke?.();
          return invoke();
        }
      ),
    } as never);
  }

  it('does not mark provider_invoked when delete preflight cannot resolve the message', async () => {
    const service = makeService();
    jest.spyOn(service as any, 'resolveMessageByKey').mockResolvedValue(null);
    const beforeProviderInvoke = jest.fn(async () => undefined);

    await expect(
      service.deleteMessage(key, beforeProviderInvoke)
    ).rejects.toThrow('message_not_found');
    expect(beforeProviderInvoke).not.toHaveBeenCalled();
  });

  it('marks provider_invoked after edit preflight and immediately before edit', async () => {
    const order: string[] = [];
    const service = makeService();
    const edit = jest.fn(async () => {
      order.push('provider');
      return { id: 'edited-message' };
    });
    jest
      .spyOn(service as any, 'resolveMessageByKey')
      .mockResolvedValue({ edit });

    await service.editText('novo texto', key, async () => {
      order.push('ledger');
    });

    expect(order).toEqual(['ledger', 'provider']);
  });

  it('marks provider_invoked only after forward resolution and snapshot preflight', async () => {
    const order: string[] = [];
    const service = makeService();
    const forward = jest.fn(async () => {
      order.push('provider');
      return { id: 'forwarded-message' };
    });
    jest
      .spyOn(service as any, 'resolveMessageByKey')
      .mockResolvedValue({ forward });
    jest
      .spyOn(service as any, 'snapshotDestinationMessageIds')
      .mockImplementation(async () => {
        order.push('preflight');
        return new Set<string>();
      });

    await service.forwardMessage('5511888888888@c.us', key, async () => {
      order.push('ledger');
    });

    expect(order).toEqual(['preflight', 'ledger', 'provider']);
  });

  it('propagates ledger and provider failures after forward preflight', async () => {
    const service = makeService();
    const forward = jest.fn(async () => {
      throw new Error('provider timeout');
    });
    jest
      .spyOn(service as any, 'resolveMessageByKey')
      .mockResolvedValue({ forward });
    jest
      .spyOn(service as any, 'snapshotDestinationMessageIds')
      .mockResolvedValue(new Set<string>());

    await expect(
      service.forwardMessage('5511888888888@c.us', key, async () => {
        throw new Error('ledger unavailable');
      })
    ).rejects.toThrow('ledger unavailable');
    expect(forward).not.toHaveBeenCalled();

    await expect(
      service.forwardMessage('5511888888888@c.us', key, async () => undefined)
    ).rejects.toThrow('provider timeout');
    expect(forward).toHaveBeenCalledTimes(1);
  });
});
