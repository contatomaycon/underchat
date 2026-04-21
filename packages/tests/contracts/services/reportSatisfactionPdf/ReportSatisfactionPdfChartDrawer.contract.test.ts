import {
  drawChart,
  drawStackedBarChartByEntity,
} from '@core/services/reportSatisfactionPdf/ReportSatisfactionPdfChartDrawer';

describe('ReportSatisfactionPdfChartDrawer', () => {
  const t = ((key: string) => key) as never;

  const makeDoc = (initialY = 60) => {
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
      fillColor: jest.fn(function (this: any) {
        return this;
      }),
      rect: jest.fn(function (this: any) {
        return this;
      }),
      fill: jest.fn(function (this: any) {
        return this;
      }),
      widthOfString: jest.fn((text: string) => text.length * 4),
    };

    return doc;
  };

  it('returns early for stacked chart when there is no entity/option data', () => {
    const doc = makeDoc();

    drawStackedBarChartByEntity(doc as never, t, [] as never, 'sector');

    expect(doc.text).toHaveBeenCalledWith(
      'report_satisfaction_quantity_by_sector',
      50,
      60,
      {
        width: 495,
        align: 'left',
      }
    );
    expect(doc.rect).not.toHaveBeenCalled();
  });

  it('draws stacked chart bars, truncates long entity labels and renders legend', () => {
    const doc = makeDoc();

    drawStackedBarChartByEntity(
      doc as never,
      t,
      [
        {
          sector: 'Support Team With Very Long Name',
          option_counts: [
            { option_text: 'Excellent', count: 3 },
            { option_text: 'Bad', count: 1 },
          ],
        },
        {
          sector: 'Sales',
          option_counts: [{ option_text: 'Excellent', count: 2 }],
        },
      ] as never,
      'sector'
    );

    const textCalls = (doc.text.mock.calls as unknown as unknown[][]).map(
      (call) => call[0]
    );

    expect(doc.rect).toHaveBeenCalled();
    expect(
      textCalls.some(
        (value) => typeof value === 'string' && value.includes('...')
      )
    ).toBe(true);
    expect(textCalls).toContain('Excellent');
    expect(textCalls).toContain('Bad');
    expect(doc.widthOfString).toHaveBeenCalled();
  });

  it('handles analyst chart with fallback labels and zero totals', () => {
    const doc = makeDoc();

    drawStackedBarChartByEntity(
      doc as never,
      t,
      [
        {
          analyst: null,
          option_counts: [{ option_text: '', count: 0 }],
        },
      ] as never,
      'analyst'
    );

    const textCalls = (doc.text.mock.calls as unknown as unknown[][]).map(
      (call) => call[0]
    );

    expect(textCalls).toContain('report_satisfaction_quantity_by_analyst');
    expect(textCalls).toContain('-');
  });

  it('returns early for drawChart when there are no option counts', () => {
    const doc = makeDoc();

    drawChart(doc as never, t, [] as never);

    expect(doc.text).toHaveBeenCalledWith(
      'report_satisfaction_responses_by_option',
      50,
      60,
      {
        width: 495,
        align: 'left',
      }
    );
    expect(doc.rect).not.toHaveBeenCalled();
  });

  it('draws chart bars, supports entity label in title and truncates long option text', () => {
    const doc = makeDoc();

    drawChart(
      doc as never,
      t,
      [
        {
          option_counts: [
            {
              option_text: 'Very long option text for truncation behavior',
              count: 4,
            },
            { option_text: 'Short', count: 1 },
          ],
        },
        {
          option_counts: [{ option_text: 'Short', count: 2 }],
        },
      ] as never,
      'Support'
    );

    const textCalls = (doc.text.mock.calls as unknown as unknown[][]).map(
      (call) => call[0]
    );

    expect(textCalls).toContain(
      'report_satisfaction_responses_by_option - Support'
    );
    expect(doc.rect).toHaveBeenCalled();
    expect(textCalls).toContain('Short (3)');
    expect(
      textCalls.some(
        (value) => typeof value === 'string' && value.includes('... (4)')
      )
    ).toBe(true);
  });

  it('keeps zero-value options in labels without drawing bars', () => {
    const doc = makeDoc();

    drawChart(doc as never, t, [
      {
        option_counts: [{ option_text: 'ZeroCount', count: 0 }],
      },
    ] as never);

    const textCalls = (doc.text.mock.calls as unknown as unknown[][]).map(
      (call) => call[0]
    );

    expect(textCalls).toContain('ZeroCount (0)');
  });
});
