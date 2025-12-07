import { Type } from '@sinclair/typebox';

export const checkTestPlanAlreadyUsedResponseSchema = Type.Object({
  already_used: Type.Boolean({
    description: 'Indica se o plano de teste já foi utilizado',
  }),
});

export type CheckTestPlanAlreadyUsedResponse = {
  already_used: boolean;
};
