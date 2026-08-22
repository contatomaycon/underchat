import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { TFunction } from 'i18next';
import type {
  ReportSatisfactionResult,
  ReportSatisfactionSummary,
} from '@core/schema/reportSatisfaction/listReportSatisfaction/response.schema';
import type {
  ReportSatisfactionPeriodType,
  ReportSatisfactionReportType,
} from '@core/common/interfaces/IReportSatisfactionPdf';
import { formatDateRange, getReportTitle } from './ReportSatisfactionPdfHeader';

type PDFDoc = InstanceType<typeof PDFDocument>;

const COLORS = ['#1BA39C', '#3D7CF4', '#F3B33D', '#E9674F', '#8E63CE'];
const INK = '#17233A';
const MUTED = '#64748B';
const BORDER = '#DCE4EE';
const PAGE_BOTTOM = 780;
const unicodeFontDocuments = new WeakSet<object>();

function registerReportFonts(doc: PDFDoc): void {
  const regular = '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf';
  const bold = '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf';

  if (fs.existsSync(regular) && fs.existsSync(bold)) {
    doc.registerFont('ReportRegular', regular);
    doc.registerFont('ReportBold', bold);
    unicodeFontDocuments.add(doc);
    doc.font('ReportRegular');
    return;
  }

  // The fallback keeps PDF generation available in minimal runtime images.
  doc.font('Helvetica');
}

function font(doc: PDFDoc, weight: 'regular' | 'bold' = 'regular'): PDFDoc {
  if (!unicodeFontDocuments.has(doc))
    return doc.font(weight === 'bold' ? 'Helvetica-Bold' : 'Helvetica');
  return doc.font(weight === 'bold' ? 'ReportBold' : 'ReportRegular');
}

export function normalizeSatisfactionPdfText(value: string): string {
  // Rating builders often prefix labels with decorative emoji. PDFKit's
  // standard fallback font cannot render these reliably; the textual rating is
  // the semantic value and remains intact (e.g. "⭐ Excelente" -> "Excelente").
  return value
    .replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureSpace(doc: PDFDoc, height: number): void {
  if (doc.y + height <= PAGE_BOTTOM) return;
  doc.addPage();
  doc.y = doc.page.margins.top;
}

function aggregateOptions(
  data: ReportSatisfactionResult[]
): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of data) {
    for (const option of row.option_counts) {
      const label = normalizeSatisfactionPdfText(option.option_text) || '-';
      counts.set(label, (counts.get(label) ?? 0) + option.count);
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function drawPageFooter(
  doc: PDFDoc,
  t: TFunction<'translation', undefined>
): void {
  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page++) {
    doc.switchToPage(page);
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const text = `${t('report_satisfaction_page')} ${page + 1} ${t('report_satisfaction_of')} ${range.count}`;
    font(doc)
      .fontSize(8)
      .fillColor(MUTED)
      .text(text, 50, 802, {
        width: doc.page.width - 100,
        align: 'right',
      });
    doc.page.margins.bottom = originalBottomMargin;
  }
}

function drawHeader(
  doc: PDFDoc,
  t: TFunction<'translation', undefined>,
  summary: ReportSatisfactionSummary,
  reportType: ReportSatisfactionReportType,
  periodType: ReportSatisfactionPeriodType,
  startDate: string,
  endDate: string,
  activeEntityCount: number
): void {
  doc.rect(0, 0, doc.page.width, 112).fill('#12375C');
  const titleWidth = doc.page.width - 100;
  const title = getReportTitle(t, reportType, periodType);
  font(doc, 'bold').fontSize(19);
  const titleHeight = doc.heightOfString(title, { width: titleWidth });
  font(doc, 'bold')
    .fontSize(19)
    .fillColor('#FFFFFF')
    .text(title, 50, 22, { width: titleWidth });
  font(doc)
    .fontSize(9)
    .fillColor('#D9E9F8')
    .text(formatDateRange(t, startDate, endDate), 50, 28 + titleHeight, {
      width: titleWidth,
    });
  doc.y = 138;

  const cards = [
    [t('report_satisfaction_total_responses'), String(summary.total_responses)],
    [
      t('report_satisfaction_unique_satisfactions'),
      String(summary.unique_satisfactions),
    ],
    [
      reportType === 'general'
        ? t('report_satisfaction_periods_with_answers')
        : t('report_satisfaction_active_entities'),
      String(activeEntityCount),
    ],
  ];
  const gap = 10;
  const width = (doc.page.width - 100 - gap * 2) / 3;
  const cardTop = doc.y;
  for (let index = 0; index < cards.length; index++) {
    const x = 50 + index * (width + gap);
    doc.roundedRect(x, cardTop, width, 58, 6).fillAndStroke('#F4F8FC', BORDER);
    font(doc)
      .fontSize(8)
      .fillColor(MUTED)
      .text(cards[index][0], x + 10, cardTop + 10, { width: width - 20 });
    font(doc, 'bold')
      .fontSize(20)
      .fillColor(INK)
      .text(cards[index][1], x + 10, cardTop + 27, { width: width - 20 });
  }
  doc.y = cardTop + 80;
}

function drawSectionTitle(doc: PDFDoc, title: string, subtitle?: string): void {
  ensureSpace(doc, subtitle ? 48 : 30);
  font(doc, 'bold')
    .fontSize(13)
    .fillColor(INK)
    .text(title, 50, doc.y, { width: doc.page.width - 100 });
  if (subtitle)
    font(doc)
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(subtitle, 50, doc.y + 3, { width: doc.page.width - 100 });
  doc.moveDown(subtitle ? 1.5 : 0.8);
}

export function getSatisfactionBarWidth(
  count: number,
  total: number,
  barWidth: number
): number {
  if (count <= 0 || total <= 0) return 0;

  return Math.min(barWidth, Math.max(2, (count / total) * barWidth));
}

function drawHorizontalBars(
  doc: PDFDoc,
  entries: Array<{ label: string; count: number }>,
  total: number
): void {
  if (entries.length === 0) return;
  const barLeft = 205;
  const barWidth = 240;
  for (let index = 0; index < entries.length; index++) {
    ensureSpace(doc, 27);
    const entry = entries[index];
    const y = doc.y;
    const label =
      entry.label.length > 29 ? `${entry.label.slice(0, 26)}...` : entry.label;
    const percent = total > 0 ? (entry.count / total) * 100 : 0;
    font(doc)
      .fontSize(8.5)
      .fillColor(INK)
      .text(label, 50, y + 2, { width: 145, ellipsis: true });
    doc.roundedRect(barLeft, y + 4, barWidth, 9, 4).fill('#E9EFF6');
    const filledWidth = getSatisfactionBarWidth(entry.count, total, barWidth);
    if (filledWidth > 0) {
      doc
        .roundedRect(barLeft, y + 4, filledWidth, 9, 4)
        .fill(COLORS[index % COLORS.length]);
    }
    font(doc, 'bold')
      .fontSize(8.5)
      .fillColor(INK)
      .text(`${entry.count}  (${percent.toFixed(1)}%)`, 455, y + 2, {
        width: 90,
        align: 'right',
      });
    doc.y = y + 24;
  }
  doc.moveDown(0.4);
}

function drawCoverage(
  doc: PDFDoc,
  t: TFunction<'translation', undefined>,
  entities: string[]
): void {
  if (entities.length === 0) return;
  drawSectionTitle(doc, t('report_satisfaction_without_answers'));
  const names = entities.sort((a, b) => a.localeCompare(b)).join(' • ');
  const height = Math.max(35, doc.heightOfString(names, { width: 455 }) + 22);
  ensureSpace(doc, height);
  doc
    .roundedRect(50, doc.y, 495, height, 6)
    .fillAndStroke('#FFF8E8', '#F4D889');
  font(doc)
    .fontSize(9)
    .fillColor('#705917')
    .text(names, 70, doc.y + 11, { width: 455 });
  doc.y += height + 12;
}

function drawDetailCard(
  doc: PDFDoc,
  t: TFunction<'translation', undefined>,
  row: ReportSatisfactionResult,
  reportType: ReportSatisfactionReportType
): void {
  const category =
    reportType === 'sector'
      ? row.sector
      : reportType === 'analyst'
        ? row.analyst
        : null;
  const options = aggregateOptions([row]);
  const headerParts = [row.period, category].filter(Boolean).join('  •  ');
  const question =
    normalizeSatisfactionPdfText(row.question) ||
    t('report_satisfaction_question');
  const optionHeight = Math.max(0, options.length * 24);
  const cardHeight = Math.max(
    112,
    65 + doc.heightOfString(question, { width: 420 }) + optionHeight
  );
  ensureSpace(doc, cardHeight + 12);

  const top = doc.y;
  doc.roundedRect(50, top, 495, cardHeight, 7).fillAndStroke('#FFFFFF', BORDER);
  doc.roundedRect(50, top, 5, cardHeight, 3).fill('#1BA39C');
  font(doc)
    .fontSize(8)
    .fillColor(MUTED)
    .text(headerParts, 68, top + 12, { width: 350 });
  font(doc, 'bold')
    .fontSize(10)
    .fillColor(INK)
    .text(question, 68, top + 27, { width: 355 });
  font(doc, 'bold')
    .fontSize(18)
    .fillColor('#12375C')
    .text(String(row.total), 440, top + 19, { width: 85, align: 'right' });
  font(doc)
    .fontSize(7.5)
    .fillColor(MUTED)
    .text(t('report_satisfaction_answers'), 440, top + 40, {
      width: 85,
      align: 'right',
    });

  let y = top + 59 + doc.heightOfString(question, { width: 355 });
  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    const percent = row.total > 0 ? (option.count / row.total) * 100 : 0;
    const label =
      option.label.length > 34
        ? `${option.label.slice(0, 31)}...`
        : option.label;
    font(doc)
      .fontSize(8)
      .fillColor(INK)
      .text(label, 68, y + 3, { width: 175, ellipsis: true });
    doc.roundedRect(250, y + 5, 185, 7, 3).fill('#E9EFF6');
    const filledWidth = getSatisfactionBarWidth(option.count, row.total, 185);
    if (filledWidth > 0) {
      doc
        .roundedRect(250, y + 5, filledWidth, 7, 3)
        .fill(COLORS[index % COLORS.length]);
    }
    font(doc, 'bold')
      .fontSize(8)
      .fillColor(INK)
      .text(`${option.count} (${percent.toFixed(1)}%)`, 443, y + 2, {
        width: 82,
        align: 'right',
      });
    y += 22;
  }
  doc.y = top + cardHeight + 12;
}

export function getSatisfactionReportRows(
  data: ReportSatisfactionResult[],
  reportType: ReportSatisfactionReportType
): {
  activeRows: ReportSatisfactionResult[];
  zeroEntities: string[];
  activeEntityCount: number;
} {
  const activeRows = data.filter((row) => row.total > 0);
  const entityKey =
    reportType === 'sector'
      ? 'sector'
      : reportType === 'analyst'
        ? 'analyst'
        : null;
  const activeEntities = new Set(
    activeRows
      .map((row) => (entityKey ? row[entityKey] : row.period))
      .filter(Boolean)
  );
  const zeroEntities = entityKey
    ? [
        ...new Set(
          data
            .filter((row) => row.total === 0)
            .map((row) => row[entityKey])
            .filter(
              (value): value is string =>
                Boolean(value) && !activeEntities.has(value)
            )
        ),
      ]
    : [];
  return { activeRows, zeroEntities, activeEntityCount: activeEntities.size };
}

export function drawSatisfactionReport(
  doc: PDFDoc,
  t: TFunction<'translation', undefined>,
  summary: ReportSatisfactionSummary,
  data: ReportSatisfactionResult[],
  reportType: ReportSatisfactionReportType,
  periodType: ReportSatisfactionPeriodType,
  startDate: string,
  endDate: string
): void {
  registerReportFonts(doc);
  const { activeRows, zeroEntities, activeEntityCount } =
    getSatisfactionReportRows(data, reportType);
  const entityKey =
    reportType === 'sector'
      ? 'sector'
      : reportType === 'analyst'
        ? 'analyst'
        : null;

  drawHeader(
    doc,
    t,
    summary,
    reportType,
    periodType,
    startDate,
    endDate,
    activeEntityCount
  );

  if (activeRows.length === 0) {
    drawSectionTitle(doc, t('report_satisfaction_no_answers'));
    doc.roundedRect(50, doc.y, 495, 70, 7).fillAndStroke('#F4F8FC', BORDER);
    font(doc)
      .fontSize(10)
      .fillColor(MUTED)
      .text(t('report_satisfaction_no_answers_description'), 72, doc.y + 26, {
        width: 450,
        align: 'center',
      });
    doc.y += 88;
    drawCoverage(doc, t, zeroEntities);
    drawPageFooter(doc, t);
    return;
  }

  const options = aggregateOptions(activeRows);
  drawSectionTitle(doc, t('report_satisfaction_distribution'));
  drawHorizontalBars(doc, options, summary.total_responses);

  if (entityKey) {
    const ranking = [
      ...new Map(
        activeRows.reduce((map, row) => {
          const entity = row[entityKey] || '-';
          map.set(entity, (map.get(entity) ?? 0) + row.total);
          return map;
        }, new Map<string, number>())
      ).entries(),
    ]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    drawSectionTitle(
      doc,
      reportType === 'sector'
        ? t('report_satisfaction_quantity_by_sector')
        : t('report_satisfaction_quantity_by_analyst')
    );
    drawHorizontalBars(doc, ranking, summary.total_responses);
  }

  drawCoverage(doc, t, zeroEntities);
  ensureSpace(doc, 165);
  drawSectionTitle(doc, t('report_satisfaction_details'));
  for (const row of activeRows) drawDetailCard(doc, t, row, reportType);
  drawPageFooter(doc, t);
}
