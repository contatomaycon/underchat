import 'reflect-metadata';
import { ContactGroupAssignmentCreatorUseCase } from '@core/useCases/contactGroup/ContactGroupAssignmentCreator.useCase';

const accountId = '01900000-0000-7000-8000-000000000001';
const contactId = '01900000-0000-7000-8000-000000000002';
const groupId = '01900000-0000-7000-8000-000000000003';
const labelId = '01900000-0000-7000-8000-000000000004';

const translate = ((key: string) => key) as never;

function makeUseCase(existingContact: object | null) {
  const contactService = {
    getContactByPhone: jest.fn(async () => existingContact),
    updateContactFromImport: jest.fn(async () => true),
    getContactSensitiveDataDecrypted: jest.fn(async () => ({
      phone: '61999999999',
    })),
    updateContactValidation: jest.fn(async () => true),
    addContactToGroupIfNotExists: jest.fn(async () => true),
    addContactLabelTemplateIfNotExists: jest.fn(async () => true),
    createContactWithGroup: jest.fn(async () => true),
  };
  const phoneValidationService = {
    validatePhone: jest.fn(async () => ({
      valid: true,
      phone: '5561999999999',
    })),
  };
  const useCase = new ContactGroupAssignmentCreatorUseCase(
    {} as never,
    contactService as never,
    phoneValidationService as never,
    { validateCanCreateContact: jest.fn(async () => true) } as never,
    {} as never,
    {
      viewLabelTemplateByName: jest.fn(async () => ({
        label_template_id: labelId,
      })),
    } as never,
    {} as never
  );

  return { useCase, contactService, phoneValidationService };
}

describe('CSV contact import outbound webhook coverage', () => {
  it('passes durable import context to update, group and label mutations', async () => {
    const { useCase, contactService } = makeUseCase({
      contact_id: contactId,
      phone_ddi: '55',
      is_valided: true,
    });

    await (
      useCase as unknown as {
        processContact(
          t: unknown,
          contact: object,
          requestedAccountId: string,
          contactGroupId: string,
          webhookContext: { operationId: string; actorUserId: string }
        ): Promise<unknown>;
      }
    ).processContact(
      translate,
      {
        name: 'Maycon',
        phone: '61999999999',
        phone_ddi: '55',
        label: 'Cliente',
      },
      accountId,
      groupId,
      { operationId: 'import-session:0', actorUserId: 'user-1' }
    );

    expect(contactService.updateContactFromImport).toHaveBeenCalledWith(
      contactId,
      accountId,
      expect.any(Object),
      expect.objectContaining({
        source: 'contact_import',
        idempotencyKey: `contact-import-updated:import-session:0:${contactId}`,
        actor: { type: 'user', id: 'user-1' },
      })
    );
    expect(contactService.addContactToGroupIfNotExists).toHaveBeenCalledWith(
      contactId,
      groupId,
      accountId,
      expect.objectContaining({ source: 'contact_import' })
    );
    expect(
      contactService.addContactLabelTemplateIfNotExists
    ).toHaveBeenCalledWith(
      contactId,
      labelId,
      accountId,
      expect.objectContaining({ source: 'contact_import' })
    );
  });

  it('passes a durable import operation key when creating a new contact', async () => {
    const { useCase, contactService } = makeUseCase(null);

    await (
      useCase as unknown as {
        processContact(
          t: unknown,
          contact: object,
          requestedAccountId: string,
          contactGroupId: null,
          webhookContext: { operationId: string }
        ): Promise<unknown>;
      }
    ).processContact(
      translate,
      {
        name: 'Maycon',
        phone: '61999999999',
        phone_ddi: '55',
      },
      accountId,
      null,
      { operationId: 'import-session:1' }
    );

    expect(contactService.createContactWithGroup).toHaveBeenCalledWith(
      translate,
      expect.any(Object),
      null,
      accountId,
      true,
      expect.objectContaining({
        source: 'contact_import',
        idempotencyKey: 'contact-import-created:import-session:1',
        actor: { type: 'system' },
      }),
      'whatsapp_lookup'
    );
  });

  it('skips per-contact lookup for an official-only import policy', async () => {
    const { useCase, contactService, phoneValidationService } =
      makeUseCase(null);

    await (
      useCase as unknown as {
        processContact(
          t: unknown,
          contact: object,
          requestedAccountId: string,
          contactGroupId: null,
          webhookContext: { operationId: string },
          isOfficialOnly: boolean
        ): Promise<unknown>;
      }
    ).processContact(
      translate,
      {
        name: 'Official import',
        phone: '61999999999',
        phone_ddi: '55',
      },
      accountId,
      null,
      { operationId: 'import-session:official' },
      true
    );

    expect(phoneValidationService.validatePhone).not.toHaveBeenCalled();
    expect(contactService.createContactWithGroup).toHaveBeenCalledWith(
      translate,
      expect.any(Object),
      null,
      accountId,
      true,
      expect.any(Object),
      'official_assumed'
    );
  });
});
