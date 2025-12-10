import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ListReportAttendanceRequest } from '@core/schema/reportAttendance/listReportAttendance/request.schema';
import { ReportAttendanceListerUseCase } from './ReportAttendanceLister.useCase';
import { ReportAttendancePdfService } from '@core/services/reportAttendancePdf.service';

@injectable()
export class ReportAttendancePdfGeneratorUseCase {
  constructor(
    private readonly reportAttendanceListerUseCase: ReportAttendanceListerUseCase,
    private readonly reportAttendancePdfService: ReportAttendancePdfService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    query: ListReportAttendanceRequest
  ): Promise<Buffer> {
    const response = await this.reportAttendanceListerUseCase.execute(
      accountId,
      query
    );

    const pdfBuffer = await this.reportAttendancePdfService.generatePdf(
      t,
      response.results,
      query.report_type,
      query.period,
      query.start_date,
      query.end_date
    );

    return pdfBuffer;
  }
}
