import { publicApiSchema } from '@core/common/functions/publicApiSchema';
import { createUserSchema } from '@core/schema/user/createUser';
import { editUserSchema } from '@core/schema/user/editUser';
import { listUserSchema } from '@core/schema/user/listUser';
import fastify from 'fastify';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

type JsonSchema = Record<string, unknown>;

function propertiesOf(schema: unknown): Record<string, unknown> {
  return ((schema as JsonSchema).properties ?? {}) as Record<string, unknown>;
}

describe('publicApiSchema contract', () => {
  it('derives PUBLIC authentication without mutating real Manager schemas', () => {
    const snapshots = [listUserSchema, createUserSchema, editUserSchema].map(
      (schema) => JSON.stringify(schema)
    );

    const publicListSchema = publicApiSchema(listUserSchema);
    const publicCreateSchema = publicApiSchema(createUserSchema);
    const publicEditSchema = publicApiSchema(editUserSchema);

    expect(
      [listUserSchema, createUserSchema, editUserSchema].map((schema) =>
        JSON.stringify(schema)
      )
    ).toEqual(snapshots);

    for (const managerSchema of [
      listUserSchema,
      createUserSchema,
      editUserSchema,
    ]) {
      expect(managerSchema.security).toEqual([{ authenticateJwt: [] }]);
      expect(propertiesOf(managerSchema.headers)).not.toHaveProperty(
        'x-underchat-user-id'
      );
    }

    expect(propertiesOf(listUserSchema.querystring)).toHaveProperty(
      'account_id'
    );
    expect(propertiesOf(createUserSchema.body)).toHaveProperty('account_id');
    expect(propertiesOf(editUserSchema.body)).toHaveProperty('account_id');

    for (const publicSchema of [
      publicListSchema,
      publicCreateSchema,
      publicEditSchema,
    ]) {
      expect(publicSchema.security).toEqual([{ authenticateKeyApi: [] }]);
      expect(propertiesOf(publicSchema.headers)).toHaveProperty(
        'x-underchat-user-id'
      );
      expect(publicSchema.response).toHaveProperty('400');
      const paymentRequired = (
        publicSchema.response as JsonSchema
      )[402] as JsonSchema;
      const entitlementData = propertiesOf(paymentRequired).data as JsonSchema;
      expect(propertiesOf(entitlementData)).toMatchObject({
        reason: expect.objectContaining({
          const: 'integration_plan_required',
        }),
        plan_product_id: expect.objectContaining({
          const: '0eb84ca1-8145-4770-acd4-b6725fe1cf25',
        }),
      });
    }
  });

  it('derives account-token discovery without advertising an executor', () => {
    const discoverySchema = publicApiSchema(listUserSchema, {
      requireExecutor: false,
    });
    const badRequest = (
      discoverySchema.response as JsonSchema
    )[400] as JsonSchema;

    expect(propertiesOf(discoverySchema.headers)).not.toHaveProperty(
      'x-underchat-user-id'
    );
    expect(discoverySchema.security).toEqual([{ authenticateKeyApi: [] }]);
    expect(badRequest.description).not.toContain('x-underchat-user-id');
  });

  it('preserves the structured entitlement reason during Fastify serialization', async () => {
    const app = fastify();
    app.get('/probe', {
      schema: publicApiSchema({ response: {} }),
      handler: async (_request, reply) =>
        reply.code(402).send({
          id: null,
          status: false,
          message: 'integration_not_available',
          data: {
            reason: 'integration_plan_required',
            plan_product_id: EPlanProduct.integration,
          },
        }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: {
        'x-underchat-user-id': '01900000-0000-7000-8000-000000000001',
      },
    });
    await app.close();

    expect(response.statusCode).toBe(402);
    expect(response.json()).toMatchObject({
      data: {
        reason: 'integration_plan_required',
        plan_product_id: EPlanProduct.integration,
      },
    });
  });
});
