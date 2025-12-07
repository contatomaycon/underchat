import { injectable } from 'tsyringe';
import { listReportAttendance } from './methods/listReportAttendance';

@injectable()
class ReportAttendanceController {
  public listReportAttendance = listReportAttendance;
}

export default ReportAttendanceController;
