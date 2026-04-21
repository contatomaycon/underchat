import 'reflect-metadata';
import { ContactGroupAssignmentViewerExistsRepository } from '@core/repositories/contactGroup/ContactGroupAssignmentViewerExists.repository';

function createCountChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('ContactGroupAssignmentViewerExistsRepository', () => {
  it('checks assignment existence using readonly db', async () => {
    const chain = createCountChain([{ total: 1 }]);
    const repository = new ContactGroupAssignmentViewerExistsRepository({
      select: chain.select,
    } as never);

    await expect(
      repository.existsContactGroupAssignmentByContactAndGroup('cg-1', 'c-1')
    ).resolves.toBe(true);
  });

  it('checks assignment existence inside transaction', async () => {
    const chain = createCountChain([]);
    const repository = new ContactGroupAssignmentViewerExistsRepository({
      select: jest.fn(),
    } as never);
    const tx = {
      select: chain.select,
    };

    await expect(
      repository.existsContactGroupAssignmentById(tx as never, 'cg-1')
    ).resolves.toBe(false);
  });
});
