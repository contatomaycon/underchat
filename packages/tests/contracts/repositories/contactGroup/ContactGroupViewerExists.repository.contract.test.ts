import 'reflect-metadata';
import { ContactGroupViewerExistsRepository } from '@core/repositories/contactGroup/ContactGroupViewerExists.repository';

function createChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  return { select };
}

describe('ContactGroupViewerExistsRepository', () => {
  it('returns false when no row is found', async () => {
    const chain = createChain([]);
    const repository = new ContactGroupViewerExistsRepository({
      select: chain.select,
    } as never);

    await expect(repository.existsContactGroupById('cg-1')).resolves.toBe(
      false
    );
  });

  it('returns true when count is greater than zero', async () => {
    const chain = createChain([{ total: 1 }]);
    const repository = new ContactGroupViewerExistsRepository({
      select: chain.select,
    } as never);

    await expect(repository.existsContactGroupById('cg-1')).resolves.toBe(true);
  });
});
