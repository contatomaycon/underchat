import { injectable } from 'tsyringe';
import { IGetAsaasInvoiceResponse } from '@core/common/interfaces/IAsaasInvoice';

interface GenerateAndUploadNfseCentiDocumentsInput {
  accountId: string;
  accountPaymentId: string;
  invoice: IGetAsaasInvoiceResponse;
  rawXml: string;
  centiTenant: string | null;
  centiUf: string | null;
}

interface GenerateAndUploadNfseCentiDocumentsOutput {
  pdfUrl: string;
  xmlUrl: string | null;
}

@injectable()
export class NfseCentiDocumentService {
  generateAndUploadDocuments = async (
    input: GenerateAndUploadNfseCentiDocumentsInput
  ): Promise<GenerateAndUploadNfseCentiDocumentsOutput> => {
    const pdfUrl = this.resolveDirectCentiPdfUrl(input) || '';

    return {
      pdfUrl,
      xmlUrl: null,
    };
  };

  private resolveDirectCentiPdfUrl(
    input: GenerateAndUploadNfseCentiDocumentsInput
  ): string | null {
    if (
      input.invoice.pdfUrl &&
      /^https?:\/\//i.test(input.invoice.pdfUrl.trim())
    ) {
      return input.invoice.pdfUrl.trim();
    }

    return this.resolveCentiPortalPdfUrl({
      rawXml: input.rawXml,
      tenant: input.centiTenant,
      uf: input.centiUf,
    });
  }

  private resolveCentiPortalPdfUrl(input: {
    rawXml: string;
    tenant: string | null;
    uf: string | null;
  }): string | null {
    const embeddedPortalUrl = this.extractEmbeddedPortalUrl(input.rawXml);
    if (embeddedPortalUrl) {
      return embeddedPortalUrl;
    }

    const infNfseId = this.extractInfNfseId(input.rawXml);
    if (!infNfseId) {
      return null;
    }

    const normalizedTenant = (input.tenant || '').trim();
    const normalizedUf = (input.uf || '')
      .trim()
      .replaceAll(/[^A-Za-z]/g, '')
      .toLowerCase();

    if (!normalizedTenant || normalizedUf.length !== 2) {
      return null;
    }

    return `https://${normalizedUf}.centi.com.br/wcf06/wcf/portal/v2/nfse/${encodeURIComponent(normalizedTenant)}/${encodeURIComponent(infNfseId)}`;
  }

  private extractInfNfseId(rawXml: string): string | null {
    const match = rawXml.match(/<(?:\w+:)?InfNfse\b[^>]*\bId="([^"]+)"/i);
    const id = match?.[1]?.trim();
    return id || null;
  }

  private extractEmbeddedPortalUrl(rawXml: string): string | null {
    const matches = rawXml.match(/https?:\/\/[^<>"'\s]+/gi) || [];

    const portalUrl = matches.find((value) =>
      /\/portal\/v2\/nfse\//i.test(value)
    );

    return portalUrl || null;
  }
}
