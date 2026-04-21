import 'reflect-metadata';
jest.mock('@core/services/expenditure.service', () => ({
  ExpenditureService: class {},
}));
import { ExpenditureListerUseCase } from '@core/useCases/expenditure/ExpenditureLister.useCase';

describe('ExpenditureListerUseCase', () => {
  it('uses default pagination when query does not provide values', async () => {
    const results = [{ id: 'exp-1' }];
    const service = {
      listExpenditures: jest.fn(async () => [results, 21] as const),
    };
    const useCase = new ExpenditureListerUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, {} as never)
    ).resolves.toEqual({
      pagings: {
        current_page: 1,
        total_pages: 3,
        per_page: 10,
        count: 1,
        total: 21,
      },
      results,
    });

    expect(service.listExpenditures).toHaveBeenCalledWith(10, 1, {});
  });

  it('uses query pagination values when provided', async () => {
    const query = { per_page: 5, current_page: 2 } as never;
    const results = [{ id: 'exp-1' }, { id: 'exp-2' }];
    const service = {
      listExpenditures: jest.fn(async () => [results, 12] as const),
    };
    const useCase = new ExpenditureListerUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, query)).resolves.toEqual({
      pagings: {
        current_page: 2,
        total_pages: 3,
        per_page: 5,
        count: 2,
        total: 12,
      },
      results,
    });
  });
});
