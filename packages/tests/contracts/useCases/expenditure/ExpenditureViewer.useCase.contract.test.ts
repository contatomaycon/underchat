import 'reflect-metadata';
jest.mock('@core/services/expenditure.service', () => ({
  ExpenditureService: class {},
}));
import { ExpenditureViewerUseCase } from '@core/useCases/expenditure/ExpenditureViewer.useCase';

describe('ExpenditureViewerUseCase', () => {
  it('throws not found when expenditure does not exist', async () => {
    const service = {
      existsExpenditureById: jest.fn(async () => false),
      viewExpenditure: jest.fn(),
    };
    const useCase = new ExpenditureViewerUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'exp-1')).rejects.toThrow(
      'expenditure_not_found'
    );
    expect(service.viewExpenditure).not.toHaveBeenCalled();
  });

  it('throws not found when viewExpenditure returns null', async () => {
    const service = {
      existsExpenditureById: jest.fn(async () => true),
      viewExpenditure: jest.fn(async () => null),
    };
    const useCase = new ExpenditureViewerUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'exp-1')).rejects.toThrow(
      'expenditure_not_found'
    );
  });

  it('returns expenditure details when found', async () => {
    const payload = { id: 'exp-1' };
    const service = {
      existsExpenditureById: jest.fn(async () => true),
      viewExpenditure: jest.fn(async () => payload),
    };
    const useCase = new ExpenditureViewerUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'exp-1')).resolves.toEqual(
      payload
    );
  });
});
