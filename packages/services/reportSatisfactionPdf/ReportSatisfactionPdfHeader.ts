import { TFunction } from 'i18next';
import PDFDocument from 'pdfkit';
import type { ReportSatisfactionSummary } from '@core/schema/reportSatisfaction/listReportSatisfaction/response.schema';
import type {
  ReportSatisfactionPeriodType,
  ReportSatisfactionReportType,
} from '@core/common/interfaces/IReportSatisfactionPdf';

type PDFDoc = InstanceType<typeof PDFDocument>;

export function getReportTitle(
  t: TFunction<'translation', undefined>,
  reportType: ReportSatisfactionReportType,
  periodType: ReportSatisfactionPeriodType
): string {
  const reportLabels: Record<ReportSatisfactionReportType, string> = {
    general: t('report_satisfaction_title_general'),
    sector: t('report_satisfaction_title_by_sector'),
    analyst: t('report_satisfaction_title_by_analyst'),
  };
  const periodLabels: Record<ReportSatisfactionPeriodType, string> = {
    month: t('month'),
    week: t('week'),
    day: t('day'),
    hour: t('hour'),
  };
  return `${reportLabels[reportType]} - ${t('report_satisfaction_by')} ${periodLabels[periodType]}`;
}

export function formatDateRange(
  t: TFunction<'translation', undefined>,
  startDate: string,
  endDate: string
): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const formatDate = (d: Date): string =>
    `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  return `${t('period')}: ${formatDate(start)} ${t('to')} ${formatDate(end)}`;
}

export function drawHeader(
  doc: PDFDoc,
  t: TFunction<'translation', undefined>,
  summary: ReportSatisfactionSummary,
  reportType: ReportSatisfactionReportType,
  periodType: ReportSatisfactionPeriodType,
  startDate: string,
  endDate: string
): void {
  const reportTitle = getReportTitle(t, reportType, periodType);
  const dateRange = formatDateRange(t, startDate, endDate);

  doc
    .fontSize(18)
    .font('Helvetica-Bold')
    .text(reportTitle, { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(12).font('Helvetica').text(dateRange, { align: 'center' });
  doc.moveDown(0.5);
  doc
    .fontSize(10)
    .font('Helvetica')
    .text(
      `${t('report_satisfaction_total_responses')}: ${summary.total_responses} | ${t('report_satisfaction_unique_satisfactions')}: ${summary.unique_satisfactions}`,
      { align: 'center' }
    );
  doc.moveDown(1);
}
