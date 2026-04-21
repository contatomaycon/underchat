import 'reflect-metadata';

jest.mock('@core/services/contactGroup.service', () => ({
  ContactGroupService: class {},
}));

import { ContactGroupListerUseCase } from '@core/useCases/contactGroup/ContactGroupLister.useCase';

describe('ContactGroupListerUseCase', () => {
  it('uses default pagination values when query does not provide them', async () => {
    const results = [{ contact_group_id: 'cg-1' }];
    const service = {
      listContactGroups: jest.fn(async () => [results, 12] as const),
    };
    const useCase = new ContactGroupListerUseCase(service as never);

    await expect(useCase.execute({} as never, 'acc-1')).resolves.toEqual({
      pagings: {
        current_page: 1,
        total_pages: 2,
        per_page: 10,
        count: 1,
        total: 12,
      },
      results,
    });
  });

  it('uses query pagination values when provided', async () => {
    const results = [
      { contact_group_id: 'cg-1' },
      { contact_group_id: 'cg-2' },
    ];
    const service = {
      listContactGroups: jest.fn(async () => [results, 8] as const),
    };
    const useCase = new ContactGroupListerUseCase(service as never);

    await expect(
      useCase.execute({ per_page: 5, current_page: 2 } as never, 'acc-1')
    ).resolves.toEqual({
      pagings: {
        current_page: 2,
        total_pages: 2,
        per_page: 5,
        count: 2,
        total: 8,
      },
      results,
    });
    expect(service.listContactGroups).toHaveBeenCalledWith(
      5,
      2,
      { per_page: 5, current_page: 2 },
      'acc-1'
    );
  });
});
