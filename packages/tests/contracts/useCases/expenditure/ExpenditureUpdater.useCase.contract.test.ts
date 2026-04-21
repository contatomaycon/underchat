import 'reflect-metadata';
jest.mock('@core/services/expenditure.service', () => ({
  ExpenditureService: class {},
}));
import { ExpenditureUpdaterUseCase } from '@core/useCases/expenditure/ExpenditureUpdater.useCase';

describe('ExpenditureUpdaterUseCase', () => {
  it('throws not found when expenditure does not exist', async () => {
    const service = {
      existsExpenditureById: jest.fn(async () => false),
      updateExpenditureById: jest.fn(),
    };
    const useCase = new ExpenditureUpdaterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'exp-1', { description: 'x' } as never)
    ).rejects.toThrow('expenditure_not_found');
    expect(service.updateExpenditureById).not.toHaveBeenCalled();
  });

  it('throws update error when service returns false', async () => {
    const service = {
      existsExpenditureById: jest.fn(async () => true),
      updateExpenditureById: jest.fn(async () => false),
    };
    const useCase = new ExpenditureUpdaterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'exp-1', { description: 'x' } as never)
    ).rejects.toThrow('expenditure_update_error');
  });

  it('returns true when update succeeds', async () => {
    const body = { description: 'updated' } as never;
    const service = {
      existsExpenditureById: jest.fn(async () => true),
      updateExpenditureById: jest.fn(async () => true),
    };
    const useCase = new ExpenditureUpdaterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'exp-1', body)).resolves.toBe(
      true
    );
    expect(service.updateExpenditureById).toHaveBeenCalledWith(body, 'exp-1');
  });
});
