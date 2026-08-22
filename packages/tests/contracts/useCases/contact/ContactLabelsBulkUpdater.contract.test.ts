import 'reflect-metadata';
import { ContactLabelsBulkUpdaterUseCase } from '@core/useCases/contact/ContactLabelsBulkUpdater.useCase';

const accountId = '01900000-0000-7000-8000-000000000001';
const firstContactId = '01900000-0000-7000-8000-000000000002';
const secondContactId = '01900000-0000-7000-8000-000000000003';
const labelTemplateId = '01900000-0000-7000-8000-000000000004';
const translate = ((key: string) => key) as never;

describe('ContactLabelsBulkUpdaterUseCase', () => {
  const createUseCase = (overrides: {
    getContactById?: jest.Mock;
    findContactLabelTemplateId?: jest.Mock;
    addContactLabelTemplateIfNotExists?: jest.Mock;
    removeContactLabelTemplate?: jest.Mock;
    listLabelTemplateAll?: jest.Mock;
  } = {}) => {
    const contactService = {
      getContactById:
        overrides.getContactById ?? jest.fn(async () => ({ contact_id: firstContactId })),
      addContactLabelTemplateIfNotExists:
        overrides.addContactLabelTemplateIfNotExists ?? jest.fn(async () => true),
      removeContactLabelTemplate:
        overrides.removeContactLabelTemplate ?? jest.fn(async () => true),
    };
    const labelTemplateService = {
      listLabelTemplateAll:
        overrides.listLabelTemplateAll ??
        jest.fn(async () => [
          {
            label_template_id: labelTemplateId,
            label: 'VIP',
            color: '#000000',
          },
        ]),
    };
    const assignmentRepository = {
      findContactLabelTemplateId:
        overrides.findContactLabelTemplateId ?? jest.fn(async () => null),
    };

    return {
      useCase: new ContactLabelsBulkUpdaterUseCase(
        contactService as never,
        labelTemplateService as never,
        assignmentRepository as never
      ),
      contactService,
      labelTemplateService,
      assignmentRepository,
    };
  };

  it('adds only missing labels and deduplicates the requested ids', async () => {
    const { useCase, contactService, assignmentRepository } = createUseCase();

    await expect(
      useCase.execute(translate, accountId, {
        contact_ids: [firstContactId, firstContactId],
        label_template_ids: [labelTemplateId, labelTemplateId],
        operation: 'add',
      })
    ).resolves.toEqual({
      processed_count: 1,
      changed_count: 1,
      failed_count: 0,
    });

    expect(assignmentRepository.findContactLabelTemplateId).toHaveBeenCalledWith(
      firstContactId,
      labelTemplateId,
      accountId
    );
    expect(contactService.addContactLabelTemplateIfNotExists).toHaveBeenCalledTimes(
      1
    );
    expect(contactService.removeContactLabelTemplate).not.toHaveBeenCalled();
  });

  it('does not change contacts when the requested label is already assigned', async () => {
    const { useCase, contactService } = createUseCase({
      findContactLabelTemplateId: jest.fn(async () => 'assignment-id'),
    });

    await expect(
      useCase.execute(translate, accountId, {
        contact_ids: [firstContactId],
        label_template_ids: [labelTemplateId],
        operation: 'add',
      })
    ).resolves.toEqual({
      processed_count: 1,
      changed_count: 0,
      failed_count: 0,
    });

    expect(contactService.addContactLabelTemplateIfNotExists).not.toHaveBeenCalled();
  });

  it('reports contacts that cannot be found as failed without updating them', async () => {
    const { useCase, contactService } = createUseCase({
      getContactById: jest.fn(async (contactId: string) =>
        contactId === firstContactId ? { contact_id: contactId } : null
      ),
    });

    await expect(
      useCase.execute(translate, accountId, {
        contact_ids: [firstContactId, secondContactId],
        label_template_ids: [labelTemplateId],
        operation: 'remove',
      })
    ).resolves.toEqual({
      processed_count: 1,
      changed_count: 0,
      failed_count: 1,
    });

    expect(contactService.removeContactLabelTemplate).not.toHaveBeenCalled();
  });

  it('rejects labels that do not belong to the account before mutating contacts', async () => {
    const { useCase, contactService } = createUseCase({
      listLabelTemplateAll: jest.fn(async () => []),
    });

    await expect(
      useCase.execute(translate, accountId, {
        contact_ids: [firstContactId],
        label_template_ids: [labelTemplateId],
        operation: 'remove',
      })
    ).rejects.toThrow('label_template_not_found');

    expect(contactService.getContactById).not.toHaveBeenCalled();
  });
});
