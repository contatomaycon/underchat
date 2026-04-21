import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));
import { ExpenditureService } from '@core/services/expenditure.service';

describe('ExpenditureService', () => {
  it('delegates list and CRUD methods', async () => {
    const listExpenditures = jest.fn(async () => [{ expenditure_id: 'e1' }]);
    const listExpendituresTotal = jest.fn(async () => 2);

    const service = new ExpenditureService(
      { listExpenditures, listExpendituresTotal } as never,
      { createExpenditure: jest.fn(async () => 'e1') } as never,
      {
        viewExpenditure: jest.fn(async () => ({ expenditure_id: 'e1' })),
      } as never,
      { deleteExpenditureById: jest.fn(async () => true) } as never,
      { updateExpenditureById: jest.fn(async () => true) } as never,
      { existsExpenditureById: jest.fn(async () => true) } as never
    );

    await expect(
      service.listExpenditures(20, 1, { query: 'x' } as never)
    ).resolves.toEqual([[{ expenditure_id: 'e1' }], 2]);
    await expect(service.createExpenditure({} as never)).resolves.toBe('e1');
    await expect(service.viewExpenditure('e1')).resolves.toEqual({
      expenditure_id: 'e1',
    });
    await expect(service.deleteExpenditureById('e1')).resolves.toBe(true);
    await expect(
      service.updateExpenditureById({} as never, 'e1')
    ).resolves.toBe(true);
    await expect(service.existsExpenditureById('e1')).resolves.toBe(true);
  });
});
