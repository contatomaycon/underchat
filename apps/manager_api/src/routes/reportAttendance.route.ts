import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { reportAttendanceViewPermissions } from '@/permissions/reportAttendance.permissions';
import ReportAttendanceController from '@/controllers/reportAttendance';
import { listReportAttendanceSchema } from '@core/schema/reportAttendance/listReportAttendance';

export default function reportAttendanceRoutes(server: FastifyInstance) {
  const reportAttendanceController = container.resolve(
    ReportAttendanceController
  );

  server.get('/report-attendance', {
    schema: listReportAttendanceSchema,
    handler: reportAttendanceController.listReportAttendance,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, reportAttendanceViewPermissions),
    ],
  });
}
