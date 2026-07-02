import { Static, Type } from '@sinclair/typebox';
import { officialTemplateSchema } from '@core/schema/chat/officialOpeningContext/response.schema';

export const officialTemplatesResponseSchema = Type.Array(
  officialTemplateSchema
);

export type OfficialTemplatesResponse = Static<
  typeof officialTemplatesResponseSchema
>;
