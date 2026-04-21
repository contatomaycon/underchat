import 'reflect-metadata';
import { CountryViewerExistsRepository } from '@core/repositories/country/CountryViewerExists.repository';

function createChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('CountryViewerExistsRepository', () => {
  it('returns false when query result is empty', async () => {
    const chain = createChain([]);
    const dbRo = { select: chain.select };
    const repository = new CountryViewerExistsRepository(dbRo as never);

    await expect(repository.existsCountryById(55)).resolves.toBe(false);
  });

  it('returns true when count is greater than zero', async () => {
    const chain = createChain([{ total: 1 }]);
    const dbRo = { select: chain.select };
    const repository = new CountryViewerExistsRepository(dbRo as never);

    await expect(repository.existsCountryById(55)).resolves.toBe(true);
  });
});
