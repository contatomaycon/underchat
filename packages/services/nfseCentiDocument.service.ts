import { inject, injectable } from 'tsyringe';
import PDFDocument from 'pdfkit';
import { StorageService } from '@core/services/storage.service';
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
  xmlUrl: string;
}

@injectable()
export class NfseCentiDocumentService {
  constructor(
    @inject(StorageService)
    private readonly storageService: StorageService
  ) {}

  generateAndUploadDocuments = async (
    input: GenerateAndUploadNfseCentiDocumentsInput
  ): Promise<GenerateAndUploadNfseCentiDocumentsOutput> => {
    const documentBaseName = this.buildDocumentBaseName(input);
    const pdfKey = `nfse/centi/${input.accountPaymentId}/${documentBaseName}.pdf`;
    const xmlKey = `nfse/centi/${input.accountPaymentId}/${documentBaseName}.xml`;

    const officialPdfBuffer = await this.tryDownloadCentiOfficialPdf({
      rawXml: input.rawXml,
      tenant: input.centiTenant,
      uf: input.centiUf,
    });
    const pdfBuffer =
      officialPdfBuffer || (await this.generatePdfBuffer(input.invoice));

    const pdfUrl = await this.storageService.uploadPdf(
      pdfBuffer,
      input.accountId,
      pdfKey
    );

    try {
      const xmlUpload = await this.storageService.uploadFromBuffer(
        Buffer.from(input.rawXml, 'utf8'),
        input.accountId,
        {
          fileName: xmlKey,
          mimetype: 'application/xml; charset=utf-8',
        }
      );

      if (!xmlUpload?.url) {
        throw new Error('NFSE_CENTI_XML_UPLOAD_ERROR');
      }

      return {
        pdfUrl,
        xmlUrl: xmlUpload.url,
      };
    } catch (error) {
      await this.storageService.deleteImage(pdfUrl).catch(() => undefined);
      throw error;
    }
  };

  private buildDocumentBaseName(
    input: GenerateAndUploadNfseCentiDocumentsInput
  ): string {
    const rawReference =
      input.invoice.number ||
      input.invoice.rpsNumber ||
      input.accountPaymentId ||
      Date.now().toString();

    return `nfse-${this.toSafeSegment(rawReference)}`;
  }

  private toSafeSegment(value: string): string {
    return value.replaceAll(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'document';
  }

  private async tryDownloadCentiOfficialPdf(input: {
    rawXml: string;
    tenant: string | null;
    uf: string | null;
  }): Promise<Buffer | null> {
    const portalPdfUrl = this.resolveCentiPortalPdfUrl(input);
    if (!portalPdfUrl) {
      return null;
    }

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), 12000);

    try {
      const response = await fetch(portalPdfUrl, {
        method: 'GET',
        signal: timeoutController.signal,
      });

      if (!response.ok) {
        return null;
      }

      const contentType = response.headers.get('content-type') || '';
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length === 0) {
        return null;
      }

      if (this.isPdfContent(contentType, buffer)) {
        return buffer;
      }

      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
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

  private isPdfContent(contentType: string, buffer: Buffer): boolean {
    if (contentType.toLowerCase().includes('application/pdf')) {
      return true;
    }

    return buffer.subarray(0, 5).toString('utf8') === '%PDF-';
  }

  private generatePdfBuffer(
    invoice: IGetAsaasInvoiceResponse
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const buffers: Buffer[] = [];

        doc.on('data', (chunk) => {
          buffers.push(Buffer.from(chunk));
        });

        doc.on('end', () => {
          resolve(Buffer.concat(buffers));
        });

        doc.on('error', reject);

        doc.fontSize(18).text('NFS-e (Centi)', { align: 'left' });
        doc.moveDown(0.8);
        doc.fontSize(11);
        doc.text(`Numero: ${invoice.number || '-'}`);
        doc.text(`Codigo de validacao: ${invoice.validationCode || '-'}`);
        doc.text(`Serie RPS: ${invoice.rpsSerie || '-'}`);
        doc.text(`Numero RPS: ${invoice.rpsNumber || '-'}`);
        doc.text(`Status: ${invoice.status || '-'}`);
        doc.text(`Descricao do status: ${invoice.statusDescription || '-'}`);
        doc.text(`Data efetiva: ${invoice.effectiveDate || '-'}`);
        doc.text(`Valor: ${Number(invoice.value || 0).toFixed(2)}`);

        if (invoice.serviceDescription) {
          doc.moveDown(0.6);
          doc.font('Helvetica-Bold').text('Descricao do servico:');
          doc.font('Helvetica').text(invoice.serviceDescription);
        }

        if (invoice.observations) {
          doc.moveDown(0.6);
          doc.font('Helvetica-Bold').text('Observacoes:');
          doc.font('Helvetica').text(invoice.observations);
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}
