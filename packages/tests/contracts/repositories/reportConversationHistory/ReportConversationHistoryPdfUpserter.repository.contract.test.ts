import 'reflect-metadata';
import { EReportConversationHistoryPdfStatus } from '@core/common/enums/EReportConversationHistoryPdfStatus';
import { ReportConversationHistoryPdfUpserterRepository } from '@core/repositories/reportConversationHistory/ReportConversationHistoryPdfUpserter.repository';

type UpsertTx = {
  select: jest.Mock;
  update: jest.Mock;
  insert: jest.Mock;
};

function createSelectStep(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const limit = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

function createUpsertTx(args: {
  existing: Array<{
    id: string;
    status: EReportConversationHistoryPdfStatus;
    url_pdf: string | null;
  }>;
  updated?: Array<{ id: string; status: EReportConversationHistoryPdfStatus }>;
  created?: Array<{ id: string; status: EReportConversationHistoryPdfStatus }>;
}): UpsertTx {
  const selectStep = createSelectStep(args.existing);

  const updateExecute = jest.fn(async () => args.updated ?? []);
  const updateReturning = jest.fn(() => ({ execute: updateExecute }));
  const updateWhere = jest.fn(() => ({ returning: updateReturning }));
  const updateSet = jest.fn(() => ({ where: updateWhere }));
  const update = jest.fn(() => ({ set: updateSet }));

  const insertExecute = jest.fn(async () => args.created ?? []);
  const insertReturning = jest.fn(() => ({ execute: insertExecute }));
  const insertValues = jest.fn(() => ({ returning: insertReturning }));
  const insert = jest.fn(() => ({ values: insertValues }));

  return {
    select: selectStep.select,
    update,
    insert,
  };
}

describe('ReportConversationHistoryPdfUpserterRepository', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-21T13:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('updates existing pdf and returns old url', async () => {
    const tx = createUpsertTx({
      existing: [
        {
          id: 'pdf-1',
          status: EReportConversationHistoryPdfStatus.failed,
          url_pdf: 'https://cdn/old.pdf',
        },
      ],
      updated: [
        {
          id: 'pdf-1',
          status: EReportConversationHistoryPdfStatus.pending,
        },
      ],
    });

    const dbRw = {
      transaction: jest.fn(async (cb: (trx: UpsertTx) => Promise<unknown>) =>
        cb(tx)
      ),
    };

    const repository = new ReportConversationHistoryPdfUpserterRepository(
      dbRw as never
    );

    await expect(repository.upsertPdf('acc-1', 'chat-1')).resolves.toEqual({
      id: 'pdf-1',
      status: EReportConversationHistoryPdfStatus.pending,
      oldUrlPdf: 'https://cdn/old.pdf',
    });

    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('creates pdf when no previous record exists', async () => {
    const tx = createUpsertTx({
      existing: [],
      created: [
        {
          id: 'pdf-2',
          status: EReportConversationHistoryPdfStatus.pending,
        },
      ],
    });

    const dbRw = {
      transaction: jest.fn(async (cb: (trx: UpsertTx) => Promise<unknown>) =>
        cb(tx)
      ),
    };

    const repository = new ReportConversationHistoryPdfUpserterRepository(
      dbRw as never
    );

    await expect(repository.upsertPdf('acc-1', 'chat-2')).resolves.toEqual({
      id: 'pdf-2',
      status: EReportConversationHistoryPdfStatus.pending,
      oldUrlPdf: null,
    });

    expect(tx.update).not.toHaveBeenCalled();
  });
});
