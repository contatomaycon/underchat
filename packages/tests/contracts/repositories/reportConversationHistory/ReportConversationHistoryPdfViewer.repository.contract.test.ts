import 'reflect-metadata';
import { EReportConversationHistoryPdfStatus } from '@core/common/enums/EReportConversationHistoryPdfStatus';
import { ReportConversationHistoryPdfViewerRepository } from '@core/repositories/reportConversationHistory/ReportConversationHistoryPdfViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ReportConversationHistoryPdfViewerRepository', () => {
  it('viewPdfByAccountAndChat returns null when no record exists', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ReportConversationHistoryPdfViewerRepository(
      db as never
    );

    await expect(
      repository.viewPdfByAccountAndChat('acc-1', 'chat-1')
    ).resolves.toBeNull();
  });

  it('viewPdfByAccountAndChat returns first record', async () => {
    const row = {
      id: 'pdf-1',
      url_pdf: 'https://cdn/pdf.pdf',
      status: EReportConversationHistoryPdfStatus.done,
      requested_at: '2026-04-21T10:00:00.000Z',
      generated_at: '2026-04-21T10:05:00.000Z',
    };
    const { db } = createSelectDbMock([row]);
    const repository = new ReportConversationHistoryPdfViewerRepository(
      db as never
    );

    await expect(
      repository.viewPdfByAccountAndChat('acc-1', 'chat-1')
    ).resolves.toEqual(row);
  });

  it('listPdfsByAccountAndChatIds returns empty map when chatIds are empty', async () => {
    const select = jest.fn();
    const repository = new ReportConversationHistoryPdfViewerRepository({
      select,
    } as never);

    await expect(
      repository.listPdfsByAccountAndChatIds('acc-1', [])
    ).resolves.toEqual(new Map());

    expect(select).not.toHaveBeenCalled();
  });

  it('listPdfsByAccountAndChatIds maps status by chat id', async () => {
    const { db } = createSelectDbMock([
      {
        chat_id: 'chat-1',
        status: EReportConversationHistoryPdfStatus.pending,
      },
      {
        chat_id: 'chat-2',
        status: EReportConversationHistoryPdfStatus.done,
      },
    ]);

    const repository = new ReportConversationHistoryPdfViewerRepository(
      db as never
    );

    const result = await repository.listPdfsByAccountAndChatIds('acc-1', [
      'chat-1',
      'chat-2',
    ]);

    expect(result.get('chat-1')).toBe(
      EReportConversationHistoryPdfStatus.pending
    );
    expect(result.get('chat-2')).toBe(EReportConversationHistoryPdfStatus.done);
  });
});
