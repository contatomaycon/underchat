import 'reflect-metadata';

const mockBuildCandidatesWithDdi = jest.fn();
const mockOnlyDigits = jest.fn();

jest.mock('@core/repositories/contact/ChatContactLister.repository', () => ({
  ChatContactListerRepository: class {},
}));

jest.mock('@core/repositories/contact/ChatContactViewer.repository', () => ({
  ChatContactViewerRepository: class {},
}));

jest.mock(
  '@core/repositories/labelTemplate/ChatLabelTemplateAllLister.repository',
  () => ({
    ChatLabelTemplateAllListerRepository: class {},
  })
);

jest.mock('@core/services/contact.service', () => ({
  ContactService: class {},
}));

jest.mock('@core/services/encrypt.service', () => ({
  EncryptService: class {},
}));

jest.mock('@core/common/functions/buildCandidatesBR', () => ({
  buildCandidatesWithDdi: (...args: unknown[]) =>
    mockBuildCandidatesWithDdi(...args),
}));

jest.mock('@core/common/functions/onlyDigits', () => ({
  onlyDigits: (...args: unknown[]) => mockOnlyDigits(...args),
}));

import { ChatContactService } from '@core/services/chatContact.service';

describe('ChatContactService', () => {
  const makeService = () => {
    const chatContactListerRepository = {
      listChatContacts: jest.fn(async () => [
        {
          contact_id: 'c-1',
          name: 'Ana',
        },
      ]),
      listChatContactsTotal: jest.fn(async () => 1),
    };

    const chatContactViewerRepository = {
      viewChatContactById: jest.fn(async () => ({
        contact_id: 'c-1',
        name: 'Ana',
      })),
      viewChatContactByPhone: jest.fn(async () => ({
        contact_id: 'c-1',
        phone: '55119999',
      })),
      viewChatContactsByIds: jest.fn(async () => [
        {
          contact_id: 'c-1',
          name: 'Ana',
        },
      ]),
    };

    const chatLabelTemplateAllListerRepository = {
      listChatLabelTemplateAll: jest.fn(async () => [
        {
          label_template_id: 'lbl-1',
          name: 'Vip',
        },
      ]),
    };

    const contactService = {
      getContactSensitiveDataDecrypted: jest.fn<Promise<any | null>, any[]>(
        async () => null
      ),
    };

    const encryptService = {
      encrypt: jest.fn((value: string) => `enc:${value}`),
    };

    const service = new ChatContactService(
      chatContactListerRepository as never,
      chatContactViewerRepository as never,
      chatLabelTemplateAllListerRepository as never,
      contactService as never,
      encryptService as never
    );

    return {
      service,
      chatContactListerRepository,
      chatContactViewerRepository,
      chatLabelTemplateAllListerRepository,
      contactService,
      encryptService,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildCandidatesWithDdi.mockReset();
    mockOnlyDigits.mockReset();
  });

  it('lists chat contacts with encrypted filters for email/phone/document', async () => {
    const { service, chatContactListerRepository, encryptService } =
      makeService();

    mockOnlyDigits
      .mockReturnValueOnce('11999998888')
      .mockReturnValueOnce('12345678901');
    mockBuildCandidatesWithDdi.mockReturnValueOnce([
      '5511999998888',
      '5511988887777',
    ]);

    await expect(
      service.listChatContacts(
        10,
        2,
        'acc-1',
        {
          filter_email: 'ana@example.com',
          filter_phone: '+55 (11) 99999-8888',
          filter_phone_ddi: '55',
          filter_document: '123.456.789-01',
        } as never,
        ['ch-1', 'ch-2']
      )
    ).resolves.toEqual([
      [
        {
          contact_id: 'c-1',
          name: 'Ana',
        },
      ],
      1,
    ]);

    expect(encryptService.encrypt).toHaveBeenCalledWith('ana@example.com');
    expect(encryptService.encrypt).toHaveBeenCalledWith('5511999998888');
    expect(encryptService.encrypt).toHaveBeenCalledWith('5511988887777');
    expect(encryptService.encrypt).toHaveBeenCalledWith('12345678901');

    expect(chatContactListerRepository.listChatContacts).toHaveBeenCalledWith(
      10,
      2,
      'acc-1',
      {
        filter_email: 'ana@example.com',
        filter_phone: '+55 (11) 99999-8888',
        filter_phone_ddi: '55',
        filter_document: '123.456.789-01',
      },
      'enc:ana@example.com',
      ['enc:5511999998888', 'enc:5511988887777'],
      'enc:12345678901',
      ['ch-1', 'ch-2']
    );
    expect(
      chatContactListerRepository.listChatContactsTotal
    ).toHaveBeenCalledWith(
      'acc-1',
      {
        filter_email: 'ana@example.com',
        filter_phone: '+55 (11) 99999-8888',
        filter_phone_ddi: '55',
        filter_document: '123.456.789-01',
      },
      'enc:ana@example.com',
      ['enc:5511999998888', 'enc:5511988887777'],
      'enc:12345678901',
      ['ch-1', 'ch-2']
    );
  });

  it('lists chat contacts without filters using null hashes and default allowed channels', async () => {
    const { service, chatContactListerRepository } = makeService();

    await expect(service.listChatContacts(20, 1, 'acc-1')).resolves.toEqual([
      [
        {
          contact_id: 'c-1',
          name: 'Ana',
        },
      ],
      1,
    ]);

    expect(chatContactListerRepository.listChatContacts).toHaveBeenCalledWith(
      20,
      1,
      'acc-1',
      undefined,
      null,
      null,
      null,
      []
    );
  });

  it('views contacts by id, by ids and by phone with ddi fallback and phone candidates', async () => {
    const { service, chatContactViewerRepository, encryptService } =
      makeService();

    await expect(
      service.viewChatContactById('c-1', 'acc-1', ['ch-1'])
    ).resolves.toEqual({
      contact_id: 'c-1',
      name: 'Ana',
    });
    expect(
      chatContactViewerRepository.viewChatContactById
    ).toHaveBeenCalledWith('c-1', 'acc-1', ['ch-1']);

    await expect(
      service.viewChatContactsByIds(['c-1', 'c-2'], 'acc-1', ['ch-1'])
    ).resolves.toEqual([
      {
        contact_id: 'c-1',
        name: 'Ana',
      },
    ]);
    expect(
      chatContactViewerRepository.viewChatContactsByIds
    ).toHaveBeenCalledWith(['c-1', 'c-2'], 'acc-1', ['ch-1']);

    mockOnlyDigits.mockReturnValueOnce('11988887777');
    mockBuildCandidatesWithDdi.mockReturnValueOnce(['5511988887777']);

    await expect(
      service.viewChatContactByPhone(
        'acc-1',
        '+55 (11) 98888-7777',
        undefined as never
      )
    ).resolves.toEqual({
      contact_id: 'c-1',
      phone: '55119999',
    });

    expect(encryptService.encrypt).toHaveBeenCalledWith('5511988887777');
    expect(
      chatContactViewerRepository.viewChatContactByPhone
    ).toHaveBeenCalledWith('acc-1', ['enc:5511988887777'], '55', []);
  });

  it('returns decrypted sensitive fields and null when sensitive data is absent', async () => {
    const { service, contactService } = makeService();

    contactService.getContactSensitiveDataDecrypted.mockResolvedValueOnce(null);
    await expect(
      service.getChatContactEmailDecrypted('c-1')
    ).resolves.toBeNull();

    contactService.getContactSensitiveDataDecrypted.mockResolvedValueOnce(null);
    await expect(
      service.getChatContactPhoneDecrypted('c-1')
    ).resolves.toBeNull();

    contactService.getContactSensitiveDataDecrypted.mockResolvedValueOnce(null);
    await expect(
      service.getChatContactDocumentDecrypted('c-1')
    ).resolves.toBeNull();

    contactService.getContactSensitiveDataDecrypted.mockResolvedValueOnce({
      email: 'ana@example.com',
      phone: '55119999',
      document: '123',
    });
    await expect(service.getChatContactEmailDecrypted('c-1')).resolves.toBe(
      'ana@example.com'
    );

    contactService.getContactSensitiveDataDecrypted.mockResolvedValueOnce({
      email: 'ana@example.com',
      phone: '55119999',
      document: '123',
    });
    await expect(service.getChatContactPhoneDecrypted('c-1')).resolves.toBe(
      '55119999'
    );

    contactService.getContactSensitiveDataDecrypted.mockResolvedValueOnce({
      email: 'ana@example.com',
      phone: '55119999',
      document: '123',
    });
    await expect(service.getChatContactDocumentDecrypted('c-1')).resolves.toBe(
      '123'
    );
  });

  it('lists chat label templates for account', async () => {
    const { service, chatLabelTemplateAllListerRepository } = makeService();

    await expect(service.listChatLabelTemplates('acc-1')).resolves.toEqual([
      {
        label_template_id: 'lbl-1',
        name: 'Vip',
      },
    ]);
    expect(
      chatLabelTemplateAllListerRepository.listChatLabelTemplateAll
    ).toHaveBeenCalledWith('acc-1');
  });
});
