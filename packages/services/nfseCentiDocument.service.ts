import { inject, injectable } from 'tsyringe';
import PDFDocument from 'pdfkit';
import { StorageService } from '@core/services/storage.service';
import { IGetAsaasInvoiceResponse } from '@core/common/interfaces/IAsaasInvoice';

interface GenerateAndUploadNfseCentiDocumentsInput {
  accountId: string;
  accountPaymentId: string;
  invoice: IGetAsaasInvoiceResponse;
  rawXml: string;
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

    const pdfBuffer = await this.generatePdfBuffer(input.invoice);

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
