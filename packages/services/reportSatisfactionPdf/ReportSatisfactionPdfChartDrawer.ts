import { TFunction } from 'i18next';
import PDFDocument from 'pdfkit';
import type { ReportSatisfactionResult } from '@core/schema/reportSatisfaction/listReportSatisfaction/response.schema';

type PDFDoc = InstanceType<typeof PDFDocument>;

function buildOptionToCount(
  data: ReportSatisfactionResult[]
): Map<string, number> {
  const optionToCount = new Map<string, number>();
  for (const r of data) {
    for (const o of r.option_counts) {
      optionToCount.set(
        o.option_text,
        (optionToCount.get(o.option_text) || 0) + o.count
      );
    }
  }
  return optionToCount;
}

export function drawChart(
  doc: PDFDoc,
  t: TFunction<'translation', undefined>,
  data: ReportSatisfactionResult[],
  entityLabel?: string
): void {
  const optionToCount = buildOptionToCount(data);
  const labels = Array.from(optionToCount.keys()).sort((a, b) =>
    a.localeCompare(b)
  );
  const values = labels.map((l) => optionToCount.get(l) || 0);
  const maxVal = Math.max(...values, 1);

  const chartWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const chartHeight = 180;
  const chartLeft = doc.page.margins.left;

  const title = entityLabel
    ? `${t('report_satisfaction_responses_by_option')} - ${entityLabel}`
    : t('report_satisfaction_responses_by_option');
  doc.fontSize(12).font('Helvetica-Bold').text(title, chartLeft, doc.y, {
    width: chartWidth,
    align: 'left',
  });
  doc.moveDown(1.2);

  if (labels.length === 0) {
    doc.moveDown(1);
    return;
  }

  const drawingTop = doc.y;
  const drawingBottom = drawingTop + chartHeight;

  const groupWidth = chartWidth / labels.length;
  const barWidth = Math.max(12, Math.min(48, groupWidth - 16));

  for (let i = 0; i < labels.length; i++) {
    const optionText = labels[i];
    const v = values[i] || 0;
    const h = (v / maxVal) * chartHeight;
    const x = chartLeft + i * groupWidth + (groupWidth - barWidth) / 2;
    const y = drawingBottom - h;

    if (h > 0) {
      doc.fillColor('#36A2EB').rect(x, y, barWidth, h).fill();
    }

    const labelShort =
      optionText.length > 14 ? optionText.slice(0, 11) + '...' : optionText;
    const valueLabel = `${v} - ${labelShort}`;

    doc
      .fontSize(7)
      .fillColor('#333333')
      .text(valueLabel, chartLeft + i * groupWidth, drawingBottom + 2, {
        width: groupWidth,
        align: 'center',
      });
  }

  doc.y = drawingBottom + 20;
  doc.moveDown(0.5);
}
