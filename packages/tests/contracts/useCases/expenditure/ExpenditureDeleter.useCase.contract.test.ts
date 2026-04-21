import 'reflect-metadata';
jest.mock('@core/services/expenditure.service', () => ({
  ExpenditureService: class {},
}));
import { ExpenditureDeleterUseCase } from '@core/useCases/expenditure/ExpenditureDeleter.useCase';

describe('ExpenditureDeleterUseCase', () => {
  it('throws not found when expenditure does not exist', async () => {
    const service = {
      existsExpenditureById: jest.fn(async () => false),
      deleteExpenditureById: jest.fn(),
    };
    const useCase = new ExpenditureDeleterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'exp-1')).rejects.toThrow(
      'expenditure_not_found'
    );
    expect(service.deleteExpenditureById).not.toHaveBeenCalled();
  });

  it('throws deletion error when service fails to delete', async () => {
    const service = {
      existsExpenditureById: jest.fn(async () => true),
      deleteExpenditureById: jest.fn(async () => false),
    };
    const useCase = new ExpenditureDeleterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'exp-1')).rejects.toThrow(
      'expenditure_deleter_error'
    );
  });

  it('returns true when deletion succeeds', async () => {
    const service = {
      existsExpenditureById: jest.fn(async () => true),
      deleteExpenditureById: jest.fn(async () => true),
    };
    const useCase = new ExpenditureDeleterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'exp-1')).resolves.toBe(true);
    expect(service.deleteExpenditureById).toHaveBeenCalledWith('exp-1');
  });
});
