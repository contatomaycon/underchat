import 'reflect-metadata';
import { ContactValidatorUseCase } from '@core/useCases/contact/ContactValidator.useCase';

describe('ContactValidatorUseCase outbound webhook context', () => {
  it('propagates account, actor, source and a durable base idempotency key', async () => {
    const validateContact = jest.fn(async () => true);
    const contactService = {
      getContactById: jest.fn(async () => ({
        contact_id: 'contact-1',
        account: { account_id: 'account-1', name: 'Account' },
        label_templates: [],
        contact_document_type: null,
        name: 'Contact',
        phone_ddi: '55',
        is_valided: false,
      })),
      getContactSensitiveDataDecrypted: jest.fn(async () => ({
        phone: '11999991234',
      })),
      validateContact,
    };
    const phoneValidationService = {
      validatePhone: jest.fn(async () => ({
        valid: true,
        phone: '5511999991234',
      })),
    };
    const useCase = new ContactValidatorUseCase(
      contactService as never,
      phoneValidationService as never
    );

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        'contact-1',
        'account-1',
        'user-1',
        'public_api'
      )
    ).resolves.toBe(true);

    expect(validateContact).toHaveBeenCalledWith(
      'contact-1',
      '11999991234',
      '55',
      'account-1',
      {
        source: 'public_api',
        idempotencyKey: 'contact-manual-validation:contact-1',
        actor: { type: 'user', id: 'user-1' },
        changes: { validation_origin: 'manual' },
      },
      'whatsapp_lookup'
    );
  });

  it('validates an official-only contact without calling a remote worker', async () => {
    const validateContact = jest.fn(async () => true);
    const phoneValidationService = { validatePhone: jest.fn() };
    const useCase = new ContactValidatorUseCase(
      {
        getContactById: jest.fn(async () => ({
          contact_id: 'contact-1',
          phone_ddi: '55',
          is_valided: false,
        })),
        getContactSensitiveDataDecrypted: jest.fn(async () => ({
          phone: '11999991234',
        })),
        validateContact,
      } as never,
      phoneValidationService as never,
      {
        resolve: jest.fn(async () => ({
          channelIds: ['official-1'],
          isOfficialOnly: true,
          areAllChannelsResolved: true,
        })),
      } as never
    );

    await expect(
      useCase.execute(((key: string) => key) as never, 'contact-1', 'account-1')
    ).resolves.toBe(true);

    expect(phoneValidationService.validatePhone).not.toHaveBeenCalled();
    expect(validateContact).toHaveBeenCalledWith(
      'contact-1',
      '11999991234',
      '55',
      'account-1',
      expect.any(Object),
      'official_assumed'
    );
  });
});
