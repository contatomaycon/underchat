import 'reflect-metadata';
import { ZipcodeCityViewRepository } from '@core/repositories/zipcode/ZipcodeCityView.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ZipcodeCityViewRepository', () => {
  it('returns cities ordered by city name', async () => {
    const rows = [
      {
        id_zipcode_city: 1,
        city: 'São Paulo',
        fiscal_code: '3550308',
      },
    ];
    const selectMock = createSelectDbMock(rows);
    const repository = new ZipcodeCityViewRepository(selectMock.db as never);

    await expect(
      repository.listCities({ id_zipcode_state: 10 } as never)
    ).resolves.toEqual(rows);

    expect(selectMock.orderBy).toHaveBeenCalled();
  });
});
