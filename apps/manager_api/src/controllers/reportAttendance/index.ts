import { injectable } from 'tsyringe';
import { listReportAttendance } from './methods/listReportAttendance';
import { downloadReportAttendancePdf } from './methods/downloadReportAttendancePdf';

@injectable()
class ReportAttendanceController {
  public listReportAttendance = listReportAttendance;
  public downloadReportAttendancePdf = downloadReportAttendancePdf;
}

export default ReportAttendanceController;
