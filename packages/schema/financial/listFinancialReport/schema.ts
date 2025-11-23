import { listFinancialReportRequestSchema } from './request.schema';
import { listFinancialReportResponseSchema } from './response.schema';

export const listFinancialReportSchema = {
  description: 'List financial report',
  tags: ['Financial'],
  security: [{ bearerAuth: [] }],
  headers: {
    type: 'object',
    properties: {
      authorization: { type: 'string' },
    },
    required: ['authorization'],
  },
  querystring: listFinancialReportRequestSchema,
  response: {
    200: {
      type: 'object',
      properties: {
        status: { type: 'boolean' },
        message: { type: 'string' },
        data: listFinancialReportResponseSchema,
      },
    },
  },
};
