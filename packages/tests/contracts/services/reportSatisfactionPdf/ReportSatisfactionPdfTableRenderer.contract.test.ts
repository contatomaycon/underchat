import {
  drawTable,
  formatOptionBreakdown,
  getCategoryLabel,
  getRowCells,
  getTableConfig,
  getTotalRow,
} from '@core/services/reportSatisfactionPdf/ReportSatisfactionPdfTableRenderer';

describe('ReportSatisfactionPdfTableRenderer', () => {
  const t = ((key: string) => key) as never;

  const makeDoc = (initialY = 50) => {
    const doc = {
      y: initialY,
      page: {
        width: 595,
        margins: {
          left: 50,
          right: 50,
        },
      },
      fontSize: jest.fn(function (this: any) {
        return this;
      }),
      font: jest.fn(function (this: any) {
        return this;
      }),
      text: jest.fn(function (this: any) {
        return this;
      }),
      moveDown: jest.fn(function (this: any, lines = 1) {
        this.y += lines * 10;
        return this;
      }),
      strokeColor: jest.fn(function (this: any) {
        return this;
      }),
      lineWidth: jest.fn(function (this: any) {
        return this;
      }),
      moveTo: jest.fn(function (this: any) {
        return this;
      }),
      lineTo: jest.fn(function (this: any) {
        return this;
      }),
      stroke: jest.fn(function (this: any) {
        return this;
      }),
      addPage: jest.fn(function (this: any) {
        this.y = 0;
        return this;
      }),
    };

    return doc;
  };

  it('returns table config for each report type', () => {
    expect(getTableConfig(t, 'sector')).toEqual({
      columnWidths: [70, 80, 140, 50, 130],
      headers: [
        'period',
        'sector',
        'report_satisfaction_question',
        'total',
        'report_satisfaction_by_option',
      ],
    });

    expect(getTableConfig(t, 'analyst')).toEqual({
      columnWidths: [70, 90, 130, 50, 130],
      headers: [
        'period',
        'analyst',
        'report_satisfaction_question',
        'total',
        'report_satisfaction_by_option',
      ],
    });

    expect(getTableConfig(t, 'general')).toEqual({
      columnWidths: [70, 160, 50, 170],
      headers: [
        'period',
        'report_satisfaction_question',
        'total',
        'report_satisfaction_by_option',
      ],
    });
  });

  it('builds category label, rows and totals with expected shape', () => {
    const item = {
      period: '2026-01',
      sector: 'Support',
      analyst: 'Ana',
      total: 4,
    };

    expect(getCategoryLabel('sector', item as never)).toBe('Support');
    expect(getCategoryLabel('analyst', item as never)).toBe('Ana');
    expect(getCategoryLabel('general', item as never)).toBe('-');

    expect(getCategoryLabel('sector', { ...item, sector: null } as never)).toBe(
      '-'
    );
    expect(
      getCategoryLabel('analyst', { ...item, analyst: null } as never)
    ).toBe('-');

    expect(
      getRowCells('sector', item as never, 'Q?', 'Support', 'Yes (2)')
    ).toEqual(['2026-01', 'Support', 'Q?', '4', 'Yes (2)']);

    expect(getRowCells('general', item as never, 'Q?', '-', 'Yes (2)')).toEqual(
      ['2026-01', 'Q?', '4', 'Yes (2)']
    );

    expect(getTotalRow(t, 'analyst', 9)).toEqual(['total', '', '', '9', '']);
    expect(getTotalRow(t, 'general', 9)).toEqual(['total', '', '9', '']);
  });

  it('formats option breakdown values', () => {
    expect(
      formatOptionBreakdown([
        { option_text: 'Great', count: 2 },
        { option_text: 'Bad', count: 1 },
      ] as never)
    ).toBe('Great (2); Bad (1)');

    expect(formatOptionBreakdown([])).toBe('');
  });

  it('draws table rows including truncated questions and total row', () => {
    const doc = makeDoc();

    drawTable(
      doc as never,
      t,
      [
        {
          period: '2026-01',
          question:
            'Question with a very long text that must be truncated for table rendering purposes',
          total: 3,
          option_counts: [{ option_text: 'Great', count: 3 }],
        },
      ] as never,
      'general'
    );

    const textCalls = (doc.text.mock.calls as unknown as unknown[][]).map(
      (call) => call[0]
    );

    expect(textCalls).toContain('report_data');
    expect(textCalls).toContain('period');
    expect(textCalls).toContain('report_satisfaction_question');
    expect(textCalls).toContain('total');
    expect(textCalls).toContain('Great (3)');
    expect(
      textCalls.some(
        (value) => typeof value === 'string' && value.includes('...')
      )
    ).toBe(true);
  });

  it('adds a new page when current row exceeds page limit', () => {
    const doc = makeDoc(730);

    drawTable(
      doc as never,
      t,
      [
        {
          period: '2026-01',
          question: 'Short question',
          total: 1,
          option_counts: [{ option_text: 'Yes', count: 1 }],
          sector: 'Support',
        },
      ] as never,
      'sector'
    );

    expect(doc.addPage).toHaveBeenCalledTimes(1);
  });
});
