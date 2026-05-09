import 'reflect-metadata';
import { ReportConversationHistoryListerUseCase } from '@core/useCases/reportConversationHistory/ReportConversationHistoryLister.useCase';

describe('ReportConversationHistoryListerUseCase', () => {
  it('includes channel filter when channel_id is provided', async () => {
    const elasticDatabaseService = {
      select: jest.fn(async () => ({
        hits: { hits: [], total: { value: 0, relation: 'eq' } },
      })),
    };
    const pdfViewerRepository = {
      listPdfsByAccountAndChatIds: jest.fn(async () => new Map()),
    };

    const useCase = new ReportConversationHistoryListerUseCase(
      elasticDatabaseService as never,
      pdfViewerRepository as never
    );

    await useCase.execute('acc-1', {
      current_page: 1,
      per_page: 10,
      channel_id: 'worker-1',
    });

    const selectMock = elasticDatabaseService.select as jest.Mock;
    expect(selectMock).toHaveBeenCalledTimes(1);
    const elasticQuery = selectMock.mock.calls[0][1] as any;
    const serializedFilter = JSON.stringify(elasticQuery.query.bool.filter);

    expect(serializedFilter).toContain('"path":"worker"');
    expect(serializedFilter).toContain('"worker.id":"worker-1"');
  });

  it('does not include channel filter when channel_id is not provided', async () => {
    const elasticDatabaseService = {
      select: jest.fn(async () => ({
        hits: { hits: [], total: { value: 0, relation: 'eq' } },
      })),
    };
    const pdfViewerRepository = {
      listPdfsByAccountAndChatIds: jest.fn(async () => new Map()),
    };

    const useCase = new ReportConversationHistoryListerUseCase(
      elasticDatabaseService as never,
      pdfViewerRepository as never
    );

    await useCase.execute('acc-1', {
      current_page: 1,
      per_page: 10,
    });

    const selectMock = elasticDatabaseService.select as jest.Mock;
    expect(selectMock).toHaveBeenCalledTimes(1);
    const elasticQuery = selectMock.mock.calls[0][1] as any;
    const serializedFilter = JSON.stringify(elasticQuery.query.bool.filter);

    expect(serializedFilter).not.toContain('"worker.id"');
  });
});
