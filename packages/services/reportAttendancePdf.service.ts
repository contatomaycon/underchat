import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import PDFDocument from 'pdfkit';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
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
    const chartImage = await this.generateChartImage(
      t,
      data,
      reportType,
      periodType
    );

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

        if (chartImage) {
          const chartWidth = 495;
          const chartHeight = 300;
          doc.image(chartImage, 50, doc.y, {
            width: chartWidth,
            height: chartHeight,
            fit: [chartWidth, chartHeight],
          });
          doc.y += chartHeight + 20;
        }

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

  private async generateChartImage(
    t: TFunction<'translation', undefined>,
    data: ReportAttendanceResult[],
    reportType: ReportType,
    periodType: PeriodType
  ): Promise<Buffer | null> {
    if (!data || data.length === 0) {
      return null;
    }

    try {
      const width = 800;
      const height = 400;
      const chartJSNodeCanvas = new ChartJSNodeCanvas({
        width,
        height,
        backgroundColour: 'white',
      });

      const chartData = this.prepareChartData(t, data, reportType);
      const chartTitle = this.getReportTitle(t, reportType, periodType);

      const configuration = {
        type: 'bar' as const,
        data: chartData,
        options: {
          responsive: false,
          plugins: {
            legend: {
              position: 'bottom' as const,
            },
            title: {
              display: true,
              text: chartTitle,
              font: {
                size: 16,
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
            },
          },
        },
      };

      const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
      return imageBuffer;
    } catch (error) {
      console.error('Erro ao gerar gráfico:', error);
      return null;
    }
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
            ? item.queue || 'Sem Fila'
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
