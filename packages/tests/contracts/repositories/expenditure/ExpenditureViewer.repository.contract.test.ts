import 'reflect-metadata';
import { ExpenditureViewerRepository } from '@core/repositories/expenditure/ExpenditureViewer.repository';

describe('ExpenditureViewerRepository', () => {
  it('returns null when no record is found', async () => {
    const dbRo = {
      query: {
        expenditure: {
          findMany: jest.fn(async () => []),
        },
      },
    };
    const repository = new ExpenditureViewerRepository(dbRo as never);

    await expect(repository.viewExpenditure('exp-1')).resolves.toBeNull();
  });

  it('maps expenditure details and converts price to number', async () => {
    const dbRo = {
      query: {
        expenditure: {
          findMany: jest.fn(async () => [
            {
              expenditure_id: 'exp-1',
              name: 'Infra',
              description: 'Cloud',
              price: '12.7',
              created_at: '2026-01-01',
              updated_at: '2026-01-02',
            },
          ]),
        },
      },
    };
    const repository = new ExpenditureViewerRepository(dbRo as never);

    await expect(repository.viewExpenditure('exp-1')).resolves.toEqual({
      expenditure_id: 'exp-1',
      name: 'Infra',
      description: 'Cloud',
      price: 12.7,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
  });
});
