import {
  getSatisfactionBarWidth,
  getSatisfactionReportRows,
  normalizeSatisfactionPdfText,
} from '@core/services/reportSatisfactionPdf/ReportSatisfactionPdfRenderer';

describe('ReportSatisfactionPdfRenderer', () => {
  it('sizes distribution and detail bars by their share of responses', () => {
    expect(getSatisfactionBarWidth(1, 2, 240)).toBe(120);
    expect(getSatisfactionBarWidth(1, 2, 185)).toBe(92.5);
    expect(getSatisfactionBarWidth(1, 1, 240)).toBe(240);
    expect(getSatisfactionBarWidth(0, 2, 240)).toBe(0);
  });

  it('keeps only answered rows in the visual report and lists unanswered analysts as coverage', () => {
    const rows = [
      { analyst: 'Ana', period: '07/2026', total: 2 },
      { analyst: 'Bruno', period: '07/2026', total: 0 },
      { analyst: 'Ana', period: '08/2026', total: 0 },
    ] as never;

    expect(getSatisfactionReportRows(rows, 'analyst')).toEqual({
      activeRows: [{ analyst: 'Ana', period: '07/2026', total: 2 }],
      zeroEntities: ['Bruno'],
      activeEntityCount: 1,
    });
  });

  it('uses periods as the activity metric in the general report', () => {
    const rows = [
      { period: '07/2026', total: 1 },
      { period: '08/2026', total: 1 },
      { period: '08/2026', total: 0 },
    ] as never;

    expect(getSatisfactionReportRows(rows, 'general')).toMatchObject({
      activeEntityCount: 2,
      zeroEntities: [],
    });
  });

  it('removes decorative rating emoji while preserving the readable option text', () => {
    expect(normalizeSatisfactionPdfText('⭐ Excelente')).toBe('Excelente');
    expect(normalizeSatisfactionPdfText('Ótimo atendimento')).toBe(
      'Ótimo atendimento'
    );
  });
});
