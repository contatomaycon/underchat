import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { LabelTemplateDeleterRepository } from '@core/repositories/labelTemplate/LabelTemplateDeleter.repository';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

function createRepository(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const dbRw = {
    update: jest.fn(() => ({ set })),
  };

  return {
    repository: new LabelTemplateDeleterRepository(dbRw as never),
    set,
  };
}

describe('LabelTemplateDeleterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-01-01T00:00:00.000Z'
    );
  });

  it('sets deleted_at and returns true on success', async () => {
    const { repository, set } = createRepository(1);

    await expect(
      repository.deleteLabelTemplateById('lt-1', 'acc-1')
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({
      deleted_at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('returns false when no row is updated', async () => {
    const { repository } = createRepository(0);

    await expect(
      repository.deleteLabelTemplateById('lt-1', 'acc-1')
    ).resolves.toBe(false);
  });
});
