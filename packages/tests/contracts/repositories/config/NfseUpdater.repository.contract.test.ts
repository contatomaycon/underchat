import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NfseUpdaterRepository } from '@core/repositories/config/NfseUpdater.repository';

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}));

function createNfseRecord(overrides?: Record<string, unknown>) {
  return {
    nfse_id: 'nfse-1',
    external_id: 123,
    name: 'NFSe',
    municipal_service_code: '001',
    municipal_service_description_field: 'desc',
    retain_iss: true,
    iss_value: '1',
    cofins_value: '2',
    csll_value: '3',
    inss_value: '4',
    ir_value: '5',
    pis_value: '6',
    deductions: '7',
    integration_enabled: true,
    integration_base_url: 'http://base',
    integration_uf: 'SP',
    integration_tenant: 'tenant',
    integration_username: 'user',
    integration_municipality_code: '3550308',
    integration_rps_series: 'A',
    integration_prestador_document: '123',
    integration_prestador_municipal_inscription: '456',
    integration_password_encrypted: 'secret',
    certificate_bucket: 'bucket',
    certificate_key: 'key',
    certificate_file_name: 'cert.pfx',
    certificate_password_encrypted: 'pwd',
    certificate_uploaded_at: '2026-01-01',
    default_product: true,
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
    ...overrides,
  };
}

describe('NfseUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (randomUUID as unknown as jest.Mock).mockReturnValue('nfse-new-id');
  });

  it('returns null/default metadata when default nfse is missing', async () => {
    const dbRw = {
      query: {
        nfse: {
          findFirst: jest.fn(async () => null),
        },
      },
      transaction: jest.fn(),
    };
    const repository = new NfseUpdaterRepository(dbRw as never);

    await expect(
      repository.viewDefaultNfseCertificateMetadata()
    ).resolves.toBeNull();
    await expect(
      repository.viewDefaultNfseIntegrationMetadata()
    ).resolves.toBeNull();
  });

  it('returns mapped default metadata when nfse exists', async () => {
    const dbRw = {
      query: {
        nfse: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({
              nfse_id: 'nfse-1',
              certificate_bucket: 'bucket',
              certificate_key: 'key',
            })
            .mockResolvedValueOnce({
              nfse_id: 'nfse-1',
              integration_password_encrypted: 'pwd',
            }),
        },
      },
      transaction: jest.fn(),
    };
    const repository = new NfseUpdaterRepository(dbRw as never);

    await expect(
      repository.viewDefaultNfseCertificateMetadata()
    ).resolves.toEqual({
      nfse_id: 'nfse-1',
      certificate_bucket: 'bucket',
      certificate_key: 'key',
    });
    await expect(
      repository.viewDefaultNfseIntegrationMetadata()
    ).resolves.toEqual({
      nfse_id: 'nfse-1',
      integration_password_encrypted: 'pwd',
    });
  });

  it('updates integration (disabled path) and returns mapped response', async () => {
    const updateExecute = jest.fn(async () => ({ rowCount: 1 }));
    const updateWhere = jest.fn(() => ({ execute: updateExecute }));
    const updateSet = jest.fn(() => ({ where: updateWhere }));
    const tx = {
      update: jest.fn(() => ({ set: updateSet })),
      query: {
        nfse: {
          findFirst: jest.fn(async () =>
            createNfseRecord({ integration_enabled: false })
          ),
        },
      },
    };
    const dbRw = {
      query: {
        nfse: {
          findFirst: jest.fn(),
        },
      },
      transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
        cb(tx)
      ),
    };
    const repository = new NfseUpdaterRepository(dbRw as never);

    await expect(
      repository.updateNfseIntegration('nfse-1', { integration_enabled: false })
    ).resolves.toEqual(
      expect.objectContaining({
        nfse_id: 'nfse-1',
        integration_enabled: false,
      })
    );
  });
});
