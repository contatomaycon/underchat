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
import { drawHeader } from './reportSatisfactionPdf/ReportSatisfactionPdfHeader';
import {
  drawChart,
  drawStackedBarChartByEntity,
} from './reportSatisfactionPdf/ReportSatisfactionPdfChartDrawer';
import { drawTable } from './reportSatisfactionPdf/ReportSatisfactionPdfTableRenderer';

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
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const buffers: Buffer[] = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          resolve(Buffer.concat(buffers));
        });
        doc.on('error', reject);

        drawHeader(doc, t, summary, reportType, periodType, startDate, endDate);

        if (reportType === 'sector' || reportType === 'analyst') {
          drawStackedBarChartByEntity(doc, t, data, reportType);
        } else {
          drawChart(doc, t, data);
        }

        if (reportType === 'sector' || reportType === 'analyst') {
          const key = reportType === 'sector' ? 'sector' : 'analyst';
          const entities = [
            ...new Set(
              data.map((r) => r[key]).filter((x): x is string => Boolean(x))
            ),
          ].sort((a, b) => a.localeCompare(b));
          for (const entity of entities) {
            if (doc.y > 520) doc.addPage();
            const filtered = data.filter((r) => r[key] === entity);
            drawChart(doc, t, filtered, entity);
          }
        }

        drawTable(doc, t, data, reportType);

        doc.end();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
