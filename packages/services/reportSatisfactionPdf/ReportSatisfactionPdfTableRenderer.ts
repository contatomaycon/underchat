import { TFunction } from 'i18next';
import PDFDocument from 'pdfkit';
import type {
  ReportSatisfactionResult,
  ReportSatisfactionOptionCount,
} from '@core/schema/reportSatisfaction/listReportSatisfaction/response.schema';
import type { ReportSatisfactionReportType } from '@core/common/interfaces/IReportSatisfactionPdf';

type PDFDoc = InstanceType<typeof PDFDocument>;

export function getTableConfig(
  t: TFunction<'translation', undefined>,
  reportType: ReportSatisfactionReportType
): { columnWidths: number[]; headers: string[] } {
  if (reportType === 'sector') {
    return {
      columnWidths: [70, 80, 140, 50, 130],
      headers: [
        t('period'),
        t('sector'),
        t('report_satisfaction_question'),
        t('total'),
        t('report_satisfaction_by_option'),
      ],
    };
  }
  if (reportType === 'analyst') {
    return {
      columnWidths: [70, 90, 130, 50, 130],
      headers: [
        t('period'),
        t('analyst'),
        t('report_satisfaction_question'),
        t('total'),
        t('report_satisfaction_by_option'),
      ],
    };
  }
  return {
    columnWidths: [70, 160, 50, 170],
    headers: [
      t('period'),
      t('report_satisfaction_question'),
      t('total'),
      t('report_satisfaction_by_option'),
    ],
  };
}

export function getCategoryLabel(
  reportType: ReportSatisfactionReportType,
  item: ReportSatisfactionResult
): string {
  if (reportType === 'sector') return item.sector || '-';
  if (reportType === 'analyst') return item.analyst || '-';
  return '-';
}

export function formatOptionBreakdown(
  optionCounts: ReportSatisfactionOptionCount[]
): string {
  const parts: string[] = [];
  for (let i = 0; i < optionCounts.length; i++) {
    const o = optionCounts[i];
    parts.push(`${o.option_text} (${o.count})`);
  }
  return parts.join('; ');
}

export function getRowCells(
  reportType: ReportSatisfactionReportType,
  item: ReportSatisfactionResult,
  questionShort: string,
  category: string,
  optionBreakdown: string
): string[] {
  if (reportType === 'sector' || reportType === 'analyst') {
    return [
      item.period,
      category,
      questionShort,
      String(item.total),
      optionBreakdown,
    ];
  }
  return [item.period, questionShort, String(item.total), optionBreakdown];
}

export function getTotalRow(
  t: TFunction<'translation', undefined>,
  reportType: ReportSatisfactionReportType,
  grandTotal: number
): string[] {
  if (reportType === 'sector' || reportType === 'analyst') {
    return [t('total'), '', '', String(grandTotal), ''];
  }
  return [t('total'), '', String(grandTotal), ''];
}

function truncateQuestion(question: string, maxLen: number): string {
  if (question.length <= maxLen) return question;
  return question.slice(0, maxLen - 3) + '...';
}

export function drawTable(
  doc: PDFDoc,
  t: TFunction<'translation', undefined>,
  data: ReportSatisfactionResult[],
  reportType: ReportSatisfactionReportType
): void {
  doc
    .fontSize(12)
    .font('Helvetica-Bold')
    .text(t('report_data'), { align: 'left' });
  doc.moveDown(0.8);

  const { columnWidths, headers } = getTableConfig(t, reportType);
  const tableLeft = 50;
  const rowHeight = 18;
  let currentY = doc.y;

  doc.fontSize(10).font('Helvetica-Bold');
  let x = tableLeft;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], x, currentY, {
      width: columnWidths[i],
      align: 'left',
    });
    x += columnWidths[i];
  }
  currentY += rowHeight;
  doc
    .strokeColor('#000000')
    .lineWidth(1)
    .moveTo(tableLeft, currentY)
    .lineTo(x, currentY)
    .stroke();
  currentY += 5;

  doc.fontSize(9).font('Helvetica');
  let grandTotal = 0;

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (currentY > 720) {
      doc.addPage();
      currentY = 50;
      doc.fontSize(10).font('Helvetica-Bold');
      x = tableLeft;
      for (let j = 0; j < headers.length; j++) {
        doc.text(headers[j], x, currentY, {
          width: columnWidths[j],
          align: 'left',
        });
        x += columnWidths[j];
      }
      currentY += rowHeight;
      doc
        .strokeColor('#000000')
        .lineWidth(1)
        .moveTo(tableLeft, currentY)
        .lineTo(x, currentY)
        .stroke();
      currentY += 5;
      doc.fontSize(9).font('Helvetica');
    }

    const questionShort = truncateQuestion(item.question, 50);
    const category = getCategoryLabel(reportType, item);
    const optionBreakdown = formatOptionBreakdown(item.option_counts);
    const rowCells = getRowCells(
      reportType,
      item,
      questionShort,
      category,
      optionBreakdown
    );

    x = tableLeft;
    for (let j = 0; j < rowCells.length; j++) {
      doc.text(rowCells[j], x, currentY, {
        width: columnWidths[j],
        align: 'left',
      });
      x += columnWidths[j];
    }
    grandTotal += item.total;
    currentY += rowHeight;
  }

  currentY += 5;
  doc
    .strokeColor('#000000')
    .lineWidth(1)
    .moveTo(tableLeft, currentY)
    .lineTo(x, currentY)
    .stroke();
  currentY += rowHeight;
  doc.fontSize(10).font('Helvetica-Bold');
  x = tableLeft;
  const totalCells = getTotalRow(t, reportType, grandTotal);
  for (let i = 0; i < totalCells.length; i++) {
    doc.text(totalCells[i], x, currentY, {
      width: columnWidths[i],
      align: 'left',
    });
    x += columnWidths[i];
  }
}
