import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { ContactGroupDeleterRepository } from '@core/repositories/contactGroup/ContactGroupDeleter.repository';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('ContactGroupDeleterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-01-01T00:00:00.000Z'
    );
  });

  it('sets deleted_at and returns update status', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute }));
    const set = jest.fn(() => ({ where }));
    const tx = {
      update: jest.fn(() => ({ set })),
    };
    const repository = new ContactGroupDeleterRepository({} as never);

    await expect(
      repository.deleteContactGroupById(tx as never, 'cg-1')
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({
      deleted_at: '2026-01-01T00:00:00.000Z',
    });
  });
});
