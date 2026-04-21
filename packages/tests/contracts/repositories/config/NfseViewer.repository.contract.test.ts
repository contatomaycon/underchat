import 'reflect-metadata';
import { NfseViewerRepository } from '@core/repositories/config/NfseViewer.repository';

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

describe('NfseViewerRepository', () => {
  it('returns null when nfse is not configured', async () => {
    const dbRo = {
      query: {
        nfse: {
          findFirst: jest.fn(async () => null),
        },
      },
    };
    const repository = new NfseViewerRepository(dbRo as never);

    await expect(repository.viewNfse()).resolves.toBeNull();
  });

  it('maps nfse record and flag fields', async () => {
    const dbRo = {
      query: {
        nfse: {
          findFirst: jest.fn(async () => createNfseRecord()),
        },
      },
    };
    const repository = new NfseViewerRepository(dbRo as never);

    await expect(repository.viewNfse()).resolves.toEqual(
      expect.objectContaining({
        nfse_id: 'nfse-1',
        has_integration_password: true,
        has_certificate: true,
        has_certificate_password: true,
      })
    );
  });
});
