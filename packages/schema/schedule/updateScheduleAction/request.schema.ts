import { EScheduleAction } from '@core/common/enums/EScheduleAction';
import { Static, Type } from '@sinclair/typebox';

export const updateScheduleActionParamsRequestSchema = Type.Object({
  schedule_id: Type.String({ format: 'uuid' }),
  action: Type.Union([
    Type.Literal(EScheduleAction.start),
    Type.Literal(EScheduleAction.pause),
    Type.Literal(EScheduleAction.cancel),
  ]),
});

export type UpdateScheduleActionParamsRequest = Static<
  typeof updateScheduleActionParamsRequestSchema
>;
