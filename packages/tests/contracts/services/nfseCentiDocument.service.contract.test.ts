import 'reflect-metadata';
import { NfseCentiDocumentService } from '@core/services/nfseCentiDocument.service';

describe('NfseCentiDocumentService', () => {
  const baseInput = {
    accountId: 'a1',
    accountPaymentId: 'ap1',
    invoice: { pdfUrl: null },
    rawXml: '',
    centiTenant: 'tenant-a',
    centiUf: 'SP',
  };

  it('uses direct invoice pdfUrl when valid', async () => {
    const service = new NfseCentiDocumentService();

    await expect(
      service.generateAndUploadDocuments({
        ...baseInput,
        invoice: { pdfUrl: ' https://cdn.example.com/nfse.pdf ' } as never,
      } as never)
    ).resolves.toEqual({
      pdfUrl: 'https://cdn.example.com/nfse.pdf',
      xmlUrl: null,
    });
  });

  it('extracts embedded portal url from xml', async () => {
    const service = new NfseCentiDocumentService();

    await expect(
      service.generateAndUploadDocuments({
        ...baseInput,
        rawXml:
          '<xml>https://sp.centi.com.br/wcf06/wcf/portal/v2/nfse/t/x</xml>',
      } as never)
    ).resolves.toEqual({
      pdfUrl: 'https://sp.centi.com.br/wcf06/wcf/portal/v2/nfse/t/x',
      xmlUrl: null,
    });
  });

  it('builds centi portal URL from InfNfse id and tenant/uf', async () => {
    const service = new NfseCentiDocumentService();

    await expect(
      service.generateAndUploadDocuments({
        ...baseInput,
        rawXml: '<InfNfse Id="NFSE-123" />',
        centiTenant: ' tenant ',
        centiUf: 'S-P',
      } as never)
    ).resolves.toEqual({
      pdfUrl:
        'https://sp.centi.com.br/wcf06/wcf/portal/v2/nfse/tenant/NFSE-123',
      xmlUrl: null,
    });
  });

  it('returns empty pdfUrl when it cannot resolve portal url', async () => {
    const service = new NfseCentiDocumentService();

    await expect(
      service.generateAndUploadDocuments({
        ...baseInput,
        rawXml: '<xml />',
        centiTenant: null,
        centiUf: null,
      } as never)
    ).resolves.toEqual({
      pdfUrl: '',
      xmlUrl: null,
    });
  });
});
