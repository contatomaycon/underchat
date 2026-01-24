import { TFunction } from 'i18next';
import PDFDocument from 'pdfkit';
import type { ReportSatisfactionResult } from '@core/schema/reportSatisfaction/listReportSatisfaction/response.schema';

type PDFDoc = InstanceType<typeof PDFDocument>;

const OPTION_COLORS = [
  '#4BC0C0',
  '#36A2EB',
  '#FFCE56',
  '#FF9F40',
  '#FF6384',
  '#9966FF',
  '#E0E0E0',
  '#9E9E9E',
];

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

function buildEntityToOption(
  data: ReportSatisfactionResult[],
  entityKey: 'sector' | 'analyst'
): {
  entities: string[];
  options: string[];
  map: Map<string, Map<string, number>>;
} {
  const entitySet = new Set<string>();
  const optionSet = new Set<string>();
  const map = new Map<string, Map<string, number>>();

  for (const r of data) {
    const entity = (r[entityKey] as string) || '-';
    entitySet.add(entity);
    let optMap = map.get(entity);
    if (!optMap) {
      optMap = new Map<string, number>();
      map.set(entity, optMap);
    }
    for (const o of r.option_counts) {
      const txt = o.option_text || '-';
      optionSet.add(txt);
      optMap.set(txt, (optMap.get(txt) || 0) + o.count);
    }
  }

  const entities = Array.from(entitySet).sort((a, b) => a.localeCompare(b));
  const options = Array.from(optionSet).sort((a, b) => a.localeCompare(b));
  return { entities, options, map };
}

export function drawStackedBarChartByEntity(
  doc: PDFDoc,
  t: TFunction<'translation', undefined>,
  data: ReportSatisfactionResult[],
  entityKey: 'sector' | 'analyst'
): void {
  const { entities, options, map } = buildEntityToOption(data, entityKey);
  const title =
    entityKey === 'sector'
      ? t('report_satisfaction_quantity_by_sector')
      : t('report_satisfaction_quantity_by_analyst');

  const chartWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const chartHeight = 180;
  const chartLeft = doc.page.margins.left;

  doc.fontSize(12).font('Helvetica-Bold').text(title, chartLeft, doc.y, {
    width: chartWidth,
    align: 'left',
  });
  doc.moveDown(1.2);

  if (entities.length === 0 || options.length === 0) {
    doc.moveDown(1);
    return;
  }

  let maxTotal = 0;
  for (const e of entities) {
    const m = map.get(e);
    let s = 0;
    if (m) for (const v of m.values()) s += v;
    if (s > maxTotal) maxTotal = s;
  }
  if (maxTotal < 1) maxTotal = 1;

  const drawingBottom = doc.y + chartHeight;
  const groupWidth = chartWidth / entities.length;
  const barWidth = Math.max(14, Math.min(56, groupWidth - 12));

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const optMap = map.get(entity);
    const x = chartLeft + i * groupWidth + (groupWidth - barWidth) / 2;
    let y = drawingBottom;

    for (let j = 0; j < options.length; j++) {
      const opt = options[j];
      const cnt = optMap?.get(opt) || 0;
      if (cnt <= 0) continue;
      const h = (cnt / maxTotal) * chartHeight;
      y -= h;
      doc
        .fillColor(OPTION_COLORS[j % OPTION_COLORS.length])
        .rect(x, y, barWidth, h)
        .fill();
    }

    const labelShort =
      entity.length > 14 ? entity.slice(0, 11) + '...' : entity;
    doc
      .fontSize(7)
      .fillColor('#333333')
      .text(labelShort, chartLeft + i * groupWidth, drawingBottom + 2, {
        width: groupWidth,
        align: 'center',
      });
  }

  doc.y = drawingBottom + 18;
  doc.font('Helvetica');

  const legendY = doc.y;
  let legendX = chartLeft;
  const sq = 8;
  const gap = 4;

  for (let j = 0; j < options.length; j++) {
    const opt = options[j];
    doc
      .fillColor(OPTION_COLORS[j % OPTION_COLORS.length])
      .rect(legendX, legendY, sq, sq)
      .fill();
    doc
      .fontSize(8)
      .fillColor('#333333')
      .text(opt, legendX + sq + gap, legendY + 1, { continued: false });
    const tw = doc.widthOfString(opt);
    legendX += sq + gap + tw + 14;
  }

  doc.y = legendY + 14;
  doc.moveDown(0.5);
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
      optionText.length > 18 ? optionText.slice(0, 15) + '...' : optionText;
    const valueLabel = `${labelShort} (${v})`;

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
