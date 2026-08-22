import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { container } from 'tsyringe';

jest.mock('tsyringe', () => ({
  container: {
    resolve: jest.fn(),
  },
}));

jest.mock(
  '@core/useCases/worker/WorkerWhatsappProviderHandoff.useCase',
  () => ({
    WorkerWhatsappProviderHandoffUseCase: class WorkerWhatsappProviderHandoffUseCase {},
  })
);

const { viewWhatsappProviderHandoff } = jest.requireActual<{
  viewWhatsappProviderHandoff: (request: never, reply: never) => Promise<void>;
}>(
  '../../../../../../../../apps/manager_api/src/controllers/worker/methods/viewWhatsappProviderHandoff'
);

const request = {
  t: (key: string) => `translated:${key}`,
  tokenJwtData: {
    account_id: 'account-1',
  },
  params: {
    worker_id: 'worker-1',
  },
};

type ViewLatest = (accountId: string, workerId: string) => Promise<unknown>;

function makeReply() {
  return {
    request: { id: 'request-handoff-1' },
    code: jest.fn().mockReturnThis(),
    send: jest.fn(),
  };
}

describe('viewWhatsappProviderHandoff controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a successful empty lookup when the channel has no handoff', async () => {
    const viewLatest = jest.fn<ViewLatest>().mockResolvedValue(null);
    jest.mocked(container.resolve).mockReturnValue({ viewLatest } as never);
    const reply = makeReply();

    await viewWhatsappProviderHandoff(request as never, reply as never);

    expect(viewLatest).toHaveBeenCalledWith('account-1', 'worker-1');
    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      id: 'request-handoff-1',
      status: true,
      message: 'translated:worker_provider_handoff_not_found',
      data: null,
    });
  });

  it('keeps an available handoff in the successful response', async () => {
    const handoff = { handoff_id: 'handoff-1', state: 'failed' };
    const viewLatest = jest.fn<ViewLatest>().mockResolvedValue(handoff);
    jest.mocked(container.resolve).mockReturnValue({ viewLatest } as never);
    const reply = makeReply();

    await viewWhatsappProviderHandoff(request as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      id: 'request-handoff-1',
      status: true,
      message: 'translated:worker_view_success',
      data: handoff,
    });
  });
});
