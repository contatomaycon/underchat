import 'reflect-metadata';
import { ReportConversationHistoryPdfDeleterRepository } from '@core/repositories/reportConversationHistory/ReportConversationHistoryPdfDeleter.repository';
import { createDeleteDbMock } from '@core/tests/helpers/drizzleMock';

describe('ReportConversationHistoryPdfDeleterRepository', () => {
  it('returns true when delete affects rows', async () => {
    const { db } = createDeleteDbMock({ rowCount: 1 });
    const repository = new ReportConversationHistoryPdfDeleterRepository(
      db as never
    );

    await expect(
      repository.deletePdfByAccountAndChat('acc-1', 'chat-1')
    ).resolves.toBe(true);
  });

  it('returns false when delete affects no rows', async () => {
    const { db } = createDeleteDbMock({ rowCount: 0 });
    const repository = new ReportConversationHistoryPdfDeleterRepository(
      db as never
    );

    await expect(
      repository.deletePdfByAccountAndChat('acc-1', 'chat-1')
    ).resolves.toBe(false);
  });
});
