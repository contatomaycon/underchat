import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { LabelTemplateCreatorRepository } from '@core/repositories/labelTemplate/LabelTemplateCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createInsertStep(result: unknown = { rowCount: 1 }) {
  const execute = jest.fn(async () => result);
  const values = jest.fn(() => ({ execute }));

  return { values };
}

describe('LabelTemplateCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('lt-1');
  });

  it('creates label template using db connection', async () => {
    const insertStep = createInsertStep();
    const dbRw = {
      insert: jest.fn(() => ({ values: insertStep.values })),
    };
    const repository = new LabelTemplateCreatorRepository(dbRw as never);

    await expect(
      repository.createLabelTemplate(
        {
          label_status: { label_status_id: 'active' },
          label: 'VIP',
          color: '#111',
        } as never,
        'acc-1'
      )
    ).resolves.toBe('lt-1');
  });

  it('creates label template in transaction and returns null on empty result', async () => {
    const insertStepOk = createInsertStep();
    const insertStepEmpty = createInsertStep(null);
    const repository = new LabelTemplateCreatorRepository({} as never);
    const txOk = {
      insert: jest.fn(() => ({ values: insertStepOk.values })),
    };
    const txEmpty = {
      insert: jest.fn(() => ({ values: insertStepEmpty.values })),
    };

    await expect(
      repository.createLabelTemplateInTransaction(
        txOk as never,
        {
          label_status: { label_status_id: 'active' },
          label: 'VIP',
          color: '#111',
        } as never,
        'acc-1'
      )
    ).resolves.toBe('lt-1');
    await expect(
      repository.createLabelTemplateInTransaction(
        txEmpty as never,
        {
          label_status: { label_status_id: 'active' },
          label: 'VIP',
          color: '#111',
        } as never,
        'acc-1'
      )
    ).resolves.toBeNull();
  });
});
