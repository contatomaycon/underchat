import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import PDFDocument from 'pdfkit';
import { ReportAttendanceResult } from '@core/schema/reportAttendance/listReportAttendance/response.schema';

type ReportType = 'queue' | 'analyst' | 'general';
type PeriodType = 'month' | 'week' | 'day' | 'hour';

@injectable()
export class ReportAttendancePdfService {
  async generatePdf(
    t: TFunction<'translation', undefined>,
    data: ReportAttendanceResult[],
    reportType: ReportType,
    periodType: PeriodType,
    startDate: string,
    endDate: string
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const buffers: Buffer[] = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(buffers);
          resolve(pdfBuffer);
        });
        doc.on('error', reject);

        const reportTitle = this.getReportTitle(t, reportType, periodType);
        const dateRange = this.formatDateRange(t, startDate, endDate);

        doc
          .fontSize(18)
          .font('Helvetica-Bold')
          .text(reportTitle, { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(12).font('Helvetica').text(dateRange, { align: 'center' });
        doc.moveDown(1);

        this.drawChart(doc, t, data, reportType, periodType);

        doc
          .fontSize(12)
          .font('Helvetica-Bold')
          .text(t('report_data'), { align: 'left' });
        doc.moveDown(0.8);

        const tableTop = doc.y;
        const tableLeft = 50;
        const columnWidths = this.getColumnWidths(reportType);
        const headers = this.getHeaders(t, reportType);

        const rowHeight = 15;
        let currentY = tableTop;

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
        let total = 0;
        let totalTimeSeconds = 0;
        let totalWaitSeconds = 0;

        for (const item of data) {
          if (currentY > 750) {
            doc.addPage();
            currentY = 50;
            x = tableLeft;
            doc.fontSize(10).font('Helvetica-Bold');
            const headersOnNewPage = this.getHeaders(t, reportType);
            for (let i = 0; i < headersOnNewPage.length; i++) {
              doc.text(headersOnNewPage[i], x, currentY, {
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
          }

          x = tableLeft;
          const rowData = this.getRowData(item, reportType);
          for (let i = 0; i < rowData.length; i++) {
            doc.text(rowData[i], x, currentY, {
              width: columnWidths[i],
              align: 'left',
            });
            x += columnWidths[i];
          }

          total += item.total || 0;
          totalTimeSeconds += this.parseTimeToSeconds(
            item.totalTime || '00:00:00'
          );
          totalWaitSeconds += this.parseTimeToSeconds(
            item.averageWait || '00:00:00'
          );

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
        const totalRow = this.getTotalRow(
          t,
          reportType,
          total,
          totalTimeSeconds,
          totalWaitSeconds
        );
        for (let i = 0; i < totalRow.length; i++) {
          doc.text(totalRow[i], x, currentY, {
            width: columnWidths[i],
            align: 'left',
          });
          x += columnWidths[i];
        }

        currentY += rowHeight + 20;
        const legendY = currentY;
        doc
          .fontSize(9)
          .font('Helvetica-Bold')
          .text(`${t('legend')}:`, 50, legendY, { align: 'left' });
        doc.fontSize(8).font('Helvetica');
        doc.text(
          `• ${t('report_pdf_time_total_abbrev')} = ${t('total_attendance_time')}`,
          50,
          legendY + 12,
          { align: 'left' }
        );
        doc.text(
          `• ${t('report_pdf_avg_wait_abbrev')} = ${t('average_wait_time')}`,
          50,
          legendY + 24,
          { align: 'left' }
        );
        doc.text(
          `• ${t('report_pdf_avg_attendance_abbrev')} = ${t('average_attendance_time')}`,
          50,
          legendY + 36,
          { align: 'left' }
        );

        doc.end();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private getReportTitle(
    t: TFunction<'translation', undefined>,
    reportType: ReportType,
    periodType: PeriodType
  ): string {
    const reportLabels: Record<ReportType, string> = {
      queue: t('attendances_by_queue'),
      analyst: t('attendances_by_analyst'),
      general: t('attendances'),
    };

    const periodLabels: Record<PeriodType, string> = {
      month: t('month'),
      week: t('week'),
      day: t('day'),
      hour: t('hour'),
    };

    return `${reportLabels[reportType]} - ${t('attendances_by')} ${periodLabels[periodType]}`;
  }

  private formatDateRange(
    t: TFunction<'translation', undefined>,
    startDate: string,
    endDate: string
  ): string {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const formatDate = (date: Date): string => {
      const day = String(date.getUTCDate()).padStart(2, '0');
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const year = date.getUTCFullYear();
      return `${day}/${month}/${year}`;
    };
    return `${t('period')}: ${formatDate(start)} ${t('to')} ${formatDate(end)}`;
  }

  private getColumnWidths(reportType: ReportType): number[] {
    if (reportType === 'queue') {
      return [110, 140, 60, 80, 105];
    } else if (reportType === 'analyst') {
      return [110, 140, 60, 80, 105];
    } else {
      return [120, 60, 80, 105, 130];
    }
  }

  private getHeaders(
    t: TFunction<'translation', undefined>,
    reportType: ReportType
  ): string[] {
    if (reportType === 'queue') {
      return [
        t('period'),
        t('queue'),
        t('total'),
        t('report_pdf_time_total_abbrev'),
        t('report_pdf_avg_wait_abbrev'),
      ];
    } else if (reportType === 'analyst') {
      return [
        t('period'),
        t('analyst'),
        t('total'),
        t('report_pdf_time_total_abbrev'),
        t('report_pdf_avg_wait_abbrev'),
      ];
    } else {
      return [
        t('period'),
        t('total'),
        t('report_pdf_time_total_abbrev'),
        t('report_pdf_avg_wait_abbrev'),
        t('report_pdf_avg_attendance_abbrev'),
      ];
    }
  }

  private getRowData(
    item: ReportAttendanceResult,
    reportType: ReportType
  ): string[] {
    if (reportType === 'queue') {
      return [
        item.period || '-',
        item.queue || '-',
        String(item.total || 0),
        item.totalTime || '00:00:00',
        item.averageWait || '00:00:00',
      ];
    } else if (reportType === 'analyst') {
      return [
        item.period || '-',
        item.analyst || '-',
        String(item.total || 0),
        item.totalTime || '00:00:00',
        item.averageWait || '00:00:00',
      ];
    } else {
      return [
        item.period || '-',
        String(item.total || 0),
        item.totalTime || '00:00:00',
        item.averageWait || '00:00:00',
        item.averageTime || '00:00:00',
      ];
    }
  }

  private getTotalRow(
    t: TFunction<'translation', undefined>,
    reportType: ReportType,
    total: number,
    totalTimeSeconds: number,
    totalWaitSeconds: number
  ): string[] {
    const totalTime = this.formatSecondsToTime(totalTimeSeconds);
    const avgWait = this.formatSecondsToTime(
      Math.floor(totalWaitSeconds / (total || 1))
    );
    const avgTime = this.formatSecondsToTime(
      Math.floor(totalTimeSeconds / (total || 1))
    );

    if (reportType === 'queue') {
      return [t('total'), '', String(total), totalTime, avgWait];
    } else if (reportType === 'analyst') {
      return [t('total'), '', String(total), totalTime, avgWait];
    } else {
      return [t('total'), String(total), totalTime, avgWait, avgTime];
    }
  }

  private parseTimeToSeconds(timeStr: string): number {
    const parts = timeStr.split(':');
    if (parts.length === 3) {
      const hours = Number.parseInt(parts[0], 10) || 0;
      const minutes = Number.parseInt(parts[1], 10) || 0;
      const seconds = Number.parseInt(parts[2], 10) || 0;
      return hours * 3600 + minutes * 60 + seconds;
    }
    return 0;
  }

  private formatSecondsToTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  private drawChart(
    doc: PDFKit.PDFDocument,
    t: TFunction<'translation', undefined>,
    data: ReportAttendanceResult[],
    reportType: ReportType,
    periodType: PeriodType
  ): void {
    if (!data || data.length === 0) {
      console.log('[PDF] Sem dados para desenhar gráfico');
      doc.moveDown(0.5);
      return;
    }

    const chartData = this.prepareChartData(t, data, reportType);
    if (
      !chartData.labels.length ||
      !chartData.datasets.length ||
      chartData.datasets.every((dataset) =>
        dataset.data.every((value) => value === 0)
      )
    ) {
      console.log('[PDF] Dados insuficientes para desenhar gráfico');
      doc.moveDown(0.5);
      return;
    }

    const pageWidth = doc.page.width;
    const chartWidth =
      pageWidth - doc.page.margins.left - doc.page.margins.right;
    const chartHeight = 220;
    const chartLeft = doc.page.margins.left;
    const axisColor = '#555555';
    const gridColor = '#DDDDDD';

    const chartTitle = this.getReportTitle(t, reportType, periodType);
    doc.fontSize(12).font('Helvetica-Bold').text(chartTitle, chartLeft, doc.y, {
      width: chartWidth,
      align: 'left',
    });

    doc.moveDown(0.3);
    const drawingTop = doc.y;
    const drawingBottom = drawingTop + chartHeight;

    let maxValue = 0;
    for (const dataset of chartData.datasets) {
      for (const value of dataset.data) {
        if (value > maxValue) {
          maxValue = value;
        }
      }
    }
    if (maxValue === 0) {
      doc.y = drawingBottom + 10;
      return;
    }

    const horizontalLines = 5;
    for (let i = 0; i <= horizontalLines; i++) {
      const value = (maxValue / horizontalLines) * i;
      const percentage = value / maxValue;
      const y = drawingBottom - percentage * chartHeight;

      doc
        .strokeColor(i === 0 ? axisColor : gridColor)
        .lineWidth(i === 0 ? 1.2 : 0.6)
        .moveTo(chartLeft, y)
        .lineTo(chartLeft + chartWidth, y)
        .stroke();

      doc
        .fontSize(8)
        .fillColor('#333333')
        .text(Math.round(value).toString(), chartLeft - 30, y - 5, {
          width: 25,
          align: 'right',
        });
    }

    doc
      .strokeColor(axisColor)
      .lineWidth(1)
      .moveTo(chartLeft, drawingTop)
      .lineTo(chartLeft, drawingBottom)
      .lineTo(chartLeft + chartWidth, drawingBottom)
      .stroke();

    const labels = chartData.labels;
    const datasets = chartData.datasets;
    const datasetCount = datasets.length;
    const groupWidth = chartWidth / labels.length;
    const groupPadding = 12;
    const interBarSpacing = datasetCount > 1 ? 4 : 0;
    const usableWidth =
      groupWidth - groupPadding - (datasetCount - 1) * interBarSpacing;
    const barWidth = Math.max(usableWidth / datasetCount, 4);

    labels.forEach((label, labelIndex) => {
      const baseX = chartLeft + labelIndex * groupWidth + groupPadding / 2;
      datasets.forEach((dataset, datasetIndex) => {
        const value = dataset.data[labelIndex] || 0;
        if (value <= 0) {
          return;
        }
        const height = (value / maxValue) * chartHeight;
        const x = baseX + datasetIndex * (barWidth + interBarSpacing);
        const y = drawingBottom - height;
        doc
          .save()
          .lineWidth(0)
          .fillColor(dataset.backgroundColor || '#4B82F0')
          .rect(x, y, barWidth, Math.max(height, 1))
          .fill()
          .restore();
      });

      doc
        .fontSize(8)
        .fillColor('#333333')
        .text(label, chartLeft + labelIndex * groupWidth, drawingBottom + 4, {
          width: groupWidth,
          align: 'center',
        });
    });

    const legendItemsPerRow = Math.max(Math.floor(chartWidth / 160), 1);
    const legendItemWidth = chartWidth / legendItemsPerRow;
    let legendRows = 0;
    datasets.forEach((dataset, index) => {
      const row = Math.floor(index / legendItemsPerRow);
      const column = index % legendItemsPerRow;
      const legendX = chartLeft + column * legendItemWidth;
      const legendY = drawingBottom + 20 + row * 14;
      doc
        .save()
        .fillColor(dataset.backgroundColor || '#4B82F0')
        .rect(legendX, legendY, 10, 10)
        .fill()
        .restore();
      doc
        .fontSize(9)
        .fillColor('#333333')
        .text(dataset.label, legendX + 14, legendY - 2, {
          width: legendItemWidth - 14,
          align: 'left',
        });
      legendRows = Math.max(legendRows, row + 1);
    });

    doc.y = drawingBottom + 20 + legendRows * 14 + 10;
  }

  private prepareChartData(
    t: TFunction<'translation', undefined>,
    data: ReportAttendanceResult[],
    reportType: ReportType
  ): {
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
      backgroundColor: string;
    }>;
  } {
    if (reportType === 'queue' || reportType === 'analyst') {
      const periodsMap = new Map<string, Map<string, number>>();
      const categoriesSet = new Set<string>();

      for (const item of data) {
        const period = item.period || '';
        const category =
          reportType === 'queue'
            ? item.queue || 'Sem Setor'
            : item.analyst || 'Sem Analista';

        categoriesSet.add(category);

        if (!periodsMap.has(period)) {
          periodsMap.set(period, new Map());
        }

        const periodData = periodsMap.get(period);
        if (periodData) {
          periodData.set(
            category,
            (periodData.get(category) || 0) + (item.total || 0)
          );
        }
      }

      const labels = Array.from(periodsMap.keys()).sort((a, b) =>
        a.localeCompare(b)
      );
      const categories = Array.from(categoriesSet).sort((a, b) =>
        a.localeCompare(b)
      );
      const colors = [
        '#FF6384',
        '#36A2EB',
        '#FFCE56',
        '#4BC0C0',
        '#9966FF',
        '#FF9F40',
      ];

      const datasets = categories.map((category, index) => ({
        label: category,
        data: labels.map(
          (period) => periodsMap.get(period)?.get(category) || 0
        ),
        backgroundColor: colors[index % colors.length],
      }));

      return {
        labels,
        datasets,
      };
    } else {
      const labels = data
        .map((item) => item.period || '')
        .sort((a, b) => a.localeCompare(b));
      const totals = labels.map((period) => {
        const item = data.find((d) => d.period === period);
        return item?.total || 0;
      });

      return {
        labels,
        datasets: [
          {
            label: t('attendances'),
            data: totals,
            backgroundColor: '#36A2EB',
          },
        ],
      };
    }
  }
}
