import 'reflect-metadata';

const mockGenerateProtocol = jest.fn(() => 'PROTO-1');

jest.mock('@core/common/functions/generateProtocol', () => ({
  generateProtocol: () => mockGenerateProtocol(),
}));

import { ScheduleSendService } from '@core/services/scheduleSend.service';

describe('ScheduleSendService', () => {
  const makeService = () => {
    const contactService = {
      getContactPhoneDecrypted: jest.fn(() => ''),
    };

    const service = new ScheduleSendService(
      {} as never,
      {} as never,
      {} as never,
      contactService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    return { service, contactService };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateProtocol.mockReturnValue('PROTO-1');
  });

  it('replaces nickname with contact nickname when available', async () => {
    const { service } = makeService();

    await expect(
      (service as any).replaceTags(
        'Olá {{ nickname }} / {{ name }} / {{ protocol }}',
        {
          account_name: 'Underchat',
          worker_name: 'Canal 1',
        },
        {
          contact_id: 'ct-1',
          name: 'John',
          nickname: 'Johnny',
          phone: null,
          phone_ddi: null,
          phone_partial: null,
          is_validated: true,
        }
      )
    ).resolves.toBe('Olá Johnny / John / PROTO-1');
  });

  it('falls back from nickname to contact name', async () => {
    const { service } = makeService();

    await expect(
      (service as any).replaceTags(
        'Olá {{ nickname }}',
        {
          account_name: 'Underchat',
          worker_name: 'Canal 1',
        },
        {
          contact_id: 'ct-1',
          name: 'John',
          nickname: null,
          phone: null,
          phone_ddi: null,
          phone_partial: null,
          is_validated: true,
        }
      )
    ).resolves.toBe('Olá John');
  });

  it('keeps messages without nickname unchanged', async () => {
    const { service } = makeService();

    await expect(
      (service as any).replaceTags(
        'Mensagem fixa',
        {
          account_name: 'Underchat',
          worker_name: 'Canal 1',
        },
        {
          contact_id: 'ct-1',
          name: 'John',
          nickname: 'Johnny',
          phone: null,
          phone_ddi: null,
          phone_partial: null,
          is_validated: true,
        }
      )
    ).resolves.toBe('Mensagem fixa');
  });
});
