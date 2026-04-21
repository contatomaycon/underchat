import 'reflect-metadata';
import { LabelStatusViewerExistsRepository } from '@core/repositories/labelTemplate/LabelStatusViewerExists.repository';

function createChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('LabelStatusViewerExistsRepository', () => {
  it('returns false when there are no rows', async () => {
    const chain = createChain([]);
    const dbRo = { select: chain.select };
    const repository = new LabelStatusViewerExistsRepository(dbRo as never);

    await expect(repository.existsLabelStatusById('active')).resolves.toBe(
      false
    );
  });

  it('returns true when total is greater than zero', async () => {
    const chain = createChain([{ total: 1 }]);
    const dbRo = { select: chain.select };
    const repository = new LabelStatusViewerExistsRepository(dbRo as never);

    await expect(repository.existsLabelStatusById('active')).resolves.toBe(
      true
    );
  });
});
