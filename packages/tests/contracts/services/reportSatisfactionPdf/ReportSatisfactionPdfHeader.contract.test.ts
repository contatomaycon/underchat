import {
  drawHeader,
  formatDateRange,
  getReportTitle,
} from '@core/services/reportSatisfactionPdf/ReportSatisfactionPdfHeader';

describe('ReportSatisfactionPdfHeader', () => {
  const t = (key: string) =>
    ({
      report_satisfaction_title_general: 'Geral',
      report_satisfaction_title_by_sector: 'Por setor',
      report_satisfaction_title_by_analyst: 'Por analista',
      report_satisfaction_by: 'por',
      month: 'mes',
      week: 'semana',
      day: 'dia',
      hour: 'hora',
      period: 'Periodo',
      to: 'a',
      report_satisfaction_total_responses: 'Total',
      report_satisfaction_unique_satisfactions: 'Unicas',
    })[key] ?? key;

  it('builds report title and date range', () => {
    expect(getReportTitle(t as never, 'general', 'month')).toBe(
      'Geral - por mes'
    );
    expect(formatDateRange(t as never, '2026-01-02', '2026-01-31')).toBe(
      'Periodo: 02/01/2026 a 31/01/2026'
    );
  });

  it('draws header content on pdf document', () => {
    const chain = {
      fontSize: jest.fn().mockReturnThis(),
      font: jest.fn().mockReturnThis(),
      text: jest.fn().mockReturnThis(),
      moveDown: jest.fn().mockReturnThis(),
    };

    drawHeader(
      chain as never,
      t as never,
      { total_responses: 10, unique_satisfactions: 4 } as never,
      'sector',
      'week',
      '2026-01-01',
      '2026-01-07'
    );

    expect(chain.text).toHaveBeenCalledWith('Por setor - por semana', {
      align: 'center',
    });
    expect(chain.text).toHaveBeenCalledWith(
      'Periodo: 01/01/2026 a 07/01/2026',
      {
        align: 'center',
      }
    );
    expect(chain.text).toHaveBeenCalledWith('Total: 10 | Unicas: 4', {
      align: 'center',
    });
  });
});
