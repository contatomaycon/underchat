import 'reflect-metadata';
jest.mock('@core/services/expenditure.service', () => ({
  ExpenditureService: class {},
}));
import { ExpenditureCreatorUseCase } from '@core/useCases/expenditure/ExpenditureCreator.useCase';

describe('ExpenditureCreatorUseCase', () => {
  it('returns true when creation succeeds', async () => {
    const service = {
      createExpenditure: jest.fn(async () => true),
    };
    const useCase = new ExpenditureCreatorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, {} as never)).resolves.toBe(true);
    expect(service.createExpenditure).toHaveBeenCalledWith({});
  });

  it('throws translated error when creation fails', async () => {
    const service = {
      createExpenditure: jest.fn(async () => false),
    };
    const useCase = new ExpenditureCreatorUseCase(service as never);
    const t = jest.fn((key: string) => `translated:${key}`);

    await expect(useCase.execute(t as never, {} as never)).rejects.toThrow(
      'translated:expenditure_creation_failed'
    );
  });

  it('propagates service errors', async () => {
    const serviceError = new Error('db down');
    const service = {
      createExpenditure: jest.fn(async () => {
        throw serviceError;
      }),
    };
    const useCase = new ExpenditureCreatorUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, {} as never)).rejects.toBe(
      serviceError
    );
  });
});
