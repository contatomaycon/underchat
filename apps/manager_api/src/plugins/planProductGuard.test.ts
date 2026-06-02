import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { container } from 'tsyringe';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { planProductGuard } from './planProductGuard';

jest.mock('tsyringe', () => ({
  container: {
    resolve: jest.fn(),
  },
}));

jest.mock('@core/services/account.service', () => ({
  AccountService: class AccountService {},
}));

function buildReply() {
  return {
    request: { id: 'request-1' },
    code: jest.fn().mockReturnThis(),
    send: jest.fn(),
  };
}

describe('planProductGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows the request when the account has the required product', async () => {
    jest.mocked(container.resolve).mockReturnValue({
      listActivePlanProductIds: jest.fn(async () => [
        EPlanProduct.internal_chat,
      ]),
    } as never);
    const guard = planProductGuard(EPlanProduct.internal_chat);
    const reply = buildReply();

    await guard(
      {
        tokenJwtData: { account_id: 'account-1' },
        t: (key: string) => key,
      } as never,
      reply as never
    );

    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('blocks the request when the account does not have the required product', async () => {
    jest.mocked(container.resolve).mockReturnValue({
      listActivePlanProductIds: jest.fn(async () => []),
    } as never);
    const guard = planProductGuard(EPlanProduct.internal_chat);
    const reply = buildReply();

    await guard(
      {
        tokenJwtData: { account_id: 'account-1' },
        t: (key: string) => key,
      } as never,
      reply as never
    );

    expect(reply.code).toHaveBeenCalledWith(402);
    expect(reply.send).toHaveBeenCalledWith({
      id: 'request-1',
      status: false,
      message: 'internal_chat_not_available',
      data: null,
    });
  });
});
