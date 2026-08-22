import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import PDFDocument from 'pdfkit';
import {
  ReportSatisfactionSummary,
  ReportSatisfactionResult,
} from '@core/schema/reportSatisfaction/listReportSatisfaction/response.schema';
import type {
  ReportSatisfactionPeriodType,
  ReportSatisfactionReportType,
} from '@core/common/interfaces/IReportSatisfactionPdf';
import { drawSatisfactionReport } from './reportSatisfactionPdf/ReportSatisfactionPdfRenderer';

@injectable()
export class ReportSatisfactionPdfService {
  async generatePdf(
    t: TFunction<'translation', undefined>,
    summary: ReportSatisfactionSummary,
    data: ReportSatisfactionResult[],
    reportType: ReportSatisfactionReportType,
    periodType: ReportSatisfactionPeriodType,
    startDate: string,
    endDate: string
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          margin: 50,
          size: 'A4',
          bufferPages: true,
        });
        const buffers: Buffer[] = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          resolve(Buffer.concat(buffers));
        });
        doc.on('error', reject);

        drawSatisfactionReport(
          doc,
          t,
          summary,
          data,
          reportType,
          periodType,
          startDate,
          endDate
        );

        doc.end();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
