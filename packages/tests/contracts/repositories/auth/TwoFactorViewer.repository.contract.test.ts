import 'reflect-metadata';
import { TwoFactorViewerRepository } from '@core/repositories/auth/TwoFactorViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('TwoFactorViewerRepository', () => {
  it('findTwoFactorByCodeAndEmailPhone returns row when code is provided', async () => {
    const { db } = createSelectDbMock([
      {
        two_factor_id: 'tf-1',
        token: 'token-1',
      },
    ]);
    const repository = new TwoFactorViewerRepository(db as never);

    await expect(
      repository.findTwoFactorByCodeAndEmailPhone({
        emailC: 'mailc',
        phoneC: 'phonec',
        code: '123456',
      } as never)
    ).resolves.toEqual({
      two_factor_id: 'tf-1',
      token: 'token-1',
    });
  });

  it('findTwoFactorByCodeAndEmailPhone returns null when no rows exist', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new TwoFactorViewerRepository(db as never);

    await expect(
      repository.findTwoFactorByCodeAndEmailPhone({
        emailC: 'mailc',
        phoneC: 'phonec',
      } as never)
    ).resolves.toBeNull();
  });

  it('findTwoFactorByTokenAndEmailPhone returns matching row', async () => {
    const { db } = createSelectDbMock([
      {
        two_factor_id: 'tf-2',
        token: 'token-2',
      },
    ]);
    const repository = new TwoFactorViewerRepository(db as never);

    await expect(
      repository.findTwoFactorByTokenAndEmailPhone({
        token: 'token-2',
        emailC: 'mailc',
        phoneC: 'phonec',
      } as never)
    ).resolves.toEqual({
      two_factor_id: 'tf-2',
      token: 'token-2',
    });
  });

  it('findTwoFactorByCode returns null when there is no active row', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new TwoFactorViewerRepository(db as never);

    await expect(repository.findTwoFactorByCode('123456')).resolves.toBeNull();
  });

  it('findActiveValidationByCodeAndWorkerId returns matching row', async () => {
    const { db } = createSelectDbMock([
      {
        two_factor_id: 'tf-active',
        code: 'ABCD-EF12-3456-WXYZ-UNDERCHAT',
        worker_id: 'worker-1',
      },
    ]);
    const repository = new TwoFactorViewerRepository(db as never);

    await expect(
      repository.findActiveValidationByCodeAndWorkerId(
        'ABCD-EF12-3456-WXYZ-UNDERCHAT',
        'worker-1'
      )
    ).resolves.toEqual({
      two_factor_id: 'tf-active',
      code: 'ABCD-EF12-3456-WXYZ-UNDERCHAT',
      worker_id: 'worker-1',
    });
  });

  it('findActiveValidationByCodeAndWorkerId returns null when no rows exist', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new TwoFactorViewerRepository(db as never);

    await expect(
      repository.findActiveValidationByCodeAndWorkerId(
        'ABCD-EF12-3456-WXYZ-UNDERCHAT',
        'worker-1'
      )
    ).resolves.toBeNull();
  });
});
