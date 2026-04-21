import 'reflect-metadata';
import { EReportConversationHistoryPdfStatus } from '@core/common/enums/EReportConversationHistoryPdfStatus';
import { ReportConversationHistoryPdfUpdaterRepository } from '@core/repositories/reportConversationHistory/ReportConversationHistoryPdfUpdater.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

describe('ReportConversationHistoryPdfUpdaterRepository', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-21T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('updateStatus updates status and updated_at', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new ReportConversationHistoryPdfUpdaterRepository(
      db as never
    );

    await expect(
      repository.updateStatus(
        'pdf-1',
        EReportConversationHistoryPdfStatus.processing
      )
    ).resolves.toBeUndefined();

    expect(set).toHaveBeenCalledWith({
      status: EReportConversationHistoryPdfStatus.processing,
      updated_at: '2026-04-21T12:00:00.000Z',
    });
  });

  it('updatePdfUrl updates url, status and timestamps', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new ReportConversationHistoryPdfUpdaterRepository(
      db as never
    );

    await expect(
      repository.updatePdfUrl(
        'pdf-1',
        'https://cdn/pdf-1.pdf',
        EReportConversationHistoryPdfStatus.done
      )
    ).resolves.toBeUndefined();

    expect(set).toHaveBeenCalledWith({
      url_pdf: 'https://cdn/pdf-1.pdf',
      status: EReportConversationHistoryPdfStatus.done,
      generated_at: '2026-04-21T12:00:00.000Z',
      updated_at: '2026-04-21T12:00:00.000Z',
    });
  });
});
