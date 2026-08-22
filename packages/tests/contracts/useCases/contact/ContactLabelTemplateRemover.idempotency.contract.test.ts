import 'reflect-metadata';
import { ContactLabelTemplateRemoverUseCase } from '@core/useCases/contact/ContactLabelTemplateRemover.useCase';

const accountId = '01900000-0000-7000-8000-000000000001';
const contactId = '01900000-0000-7000-8000-000000000002';
const labelTemplateId = '01900000-0000-7000-8000-000000000003';
const translate = ((key: string) => key) as never;

describe('ContactLabelTemplateRemoverUseCase webhook identity', () => {
  it('treats a retry after the assignment was already removed as successful', async () => {
    const contactService = {
      removeContactLabelTemplate: jest.fn(async () => true),
    };
    const assignmentRepository = {
      findContactLabelTemplateId: jest.fn(async () => null),
    };
    const useCase = new ContactLabelTemplateRemoverUseCase(
      contactService as never,
      {
        viewContactById: jest.fn(async () => ({
          contact_id: contactId,
          account: { account_id: accountId, name: 'Conta' },
          contact_document_type: null,
          name: 'Maycon',
          label_templates: [],
        })),
      } as never,
      assignmentRepository as never
    );

    await expect(
      useCase.execute(
        translate,
        accountId,
        contactId,
        labelTemplateId,
        undefined,
        'public_api'
      )
    ).resolves.toBe(true);
    expect(
      assignmentRepository.findContactLabelTemplateId
    ).toHaveBeenCalledWith(contactId, labelTemplateId, accountId);
    expect(contactService.removeContactLabelTemplate).not.toHaveBeenCalled();
  });

  it('uses the durable assignment id for retry and re-add semantics', async () => {
    const contact = {
      contact_id: contactId,
      account: { account_id: accountId, name: 'Conta' },
      contact_document_type: null,
      name: 'Maycon',
      phone: 'encrypted',
      label_templates: [
        { label_template_id: labelTemplateId, label: 'VIP', color: '#fff' },
      ],
    };
    const contactService = {
      removeContactLabelTemplate: jest.fn(async () => true),
      getContactById: jest.fn(async () => ({
        ...contact,
        label_templates: [],
      })),
    };
    const contactViewerRepository = {
      viewContactById: jest.fn(async () => contact),
    };
    const assignmentRepository = {
      findContactLabelTemplateId: jest
        .fn()
        .mockResolvedValueOnce('01900000-0000-7000-8000-000000000010')
        .mockResolvedValueOnce('01900000-0000-7000-8000-000000000010')
        .mockResolvedValueOnce('01900000-0000-7000-8000-000000000011'),
    };
    const useCase = new ContactLabelTemplateRemoverUseCase(
      contactService as never,
      contactViewerRepository as never,
      assignmentRepository as never
    );

    await useCase.execute(
      translate,
      accountId,
      contactId,
      labelTemplateId,
      undefined,
      'public_api'
    );
    await useCase.execute(translate, accountId, contactId, labelTemplateId);
    await useCase.execute(translate, accountId, contactId, labelTemplateId);

    const calls = contactService.removeContactLabelTemplate.mock
      .calls as unknown as Array<
      [string, string, string, { idempotencyKey: string }]
    >;
    const keys = calls.map((call) => call[3]?.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toContain('000000000010');
    expect(keys[2]).toContain('000000000011');
    expect(keys[2]).not.toBe(keys[0]);
    expect(calls[0]?.[3]).toEqual(
      expect.objectContaining({ source: 'public_api' })
    );
  });
});
