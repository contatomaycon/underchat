import { publicApiSchema } from '@core/common/functions/publicApiSchema';

type SchemaDefinition = Record<string, unknown>;

interface PublicUserSchemaOptions {
  omitAccountIdFrom?: 'body' | 'querystring';
  requireExecutor?: boolean;
}

function isSchemaDefinition(value: unknown): value is SchemaDefinition {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function closeObjectSchemas(
  value: unknown,
  includeMultipartFieldMetadata = false
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      closeObjectSchemas(item, includeMultipartFieldMetadata)
    );
  }

  if (!isSchemaDefinition(value)) {
    return value;
  }

  const closedSchema = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      closeObjectSchemas(child, includeMultipartFieldMetadata),
    ])
  );

  const properties = isSchemaDefinition(closedSchema.properties)
    ? closedSchema.properties
    : null;
  const isMultipartFile =
    properties !== null &&
    'filename' in properties &&
    'encoding' in properties &&
    'file' in properties &&
    'toBuffer' in properties;
  const isMultipartField =
    includeMultipartFieldMetadata &&
    properties !== null &&
    'value' in properties;

  if (isMultipartField && properties !== null) {
    closedSchema.properties = {
      ...properties,
      type: { type: 'string', const: 'field' },
      fieldname: { type: 'string' },
      mimetype: { type: 'string' },
      encoding: { type: 'string' },
      fieldnameTruncated: { type: 'boolean' },
      valueTruncated: { type: 'boolean' },
      fields: {},
    };
  }

  // @fastify/multipart adds internal fields to file parts. The enclosing
  // request remains strict, while this transport object stays extensible.
  if (
    !isMultipartFile &&
    (closedSchema.type === 'object' || properties !== null)
  ) {
    closedSchema.additionalProperties = false;
  }

  return closedSchema;
}

function closeMultipartBody(schema: unknown): unknown {
  if (!isSchemaDefinition(schema) || !isSchemaDefinition(schema.properties)) {
    return schema;
  }

  const indexedUuidField = closeObjectSchemas(
    {
      anyOf: [
        {
          type: 'object',
          properties: {
            value: { type: 'string', format: 'uuid' },
          },
          required: ['value'],
        },
        { type: 'string', format: 'uuid' },
      ],
    },
    true
  );
  const patternProperties: Record<string, unknown> = {};

  if ('sector_ids' in schema.properties) {
    patternProperties['^sector_ids\\[(?:0|[1-9]\\d{0,2})\\]$'] =
      indexedUuidField;
  }
  if ('channel_ids' in schema.properties) {
    patternProperties['^channel_ids\\[(?:0|[1-9]\\d{0,2})\\]$'] =
      indexedUuidField;
  }

  return {
    ...(closeObjectSchemas(schema, true) as SchemaDefinition),
    additionalProperties: false,
    ...(Object.keys(patternProperties).length > 0 ? { patternProperties } : {}),
  };
}

function omitAccountId(schema: unknown): unknown {
  if (!isSchemaDefinition(schema) || !isSchemaDefinition(schema.properties)) {
    return schema;
  }

  const properties = { ...schema.properties };
  delete properties.account_id;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((property) => property !== 'account_id')
    : schema.required;

  return {
    ...schema,
    properties,
    ...(required ? { required } : {}),
  };
}

function enforceUserIdUuid(schema: unknown): unknown {
  if (!isSchemaDefinition(schema) || !isSchemaDefinition(schema.properties)) {
    return schema;
  }

  if (!isSchemaDefinition(schema.properties.user_id)) {
    return schema;
  }

  return {
    ...schema,
    properties: {
      ...schema.properties,
      user_id: {
        ...schema.properties.user_id,
        type: 'string',
        format: 'uuid',
      },
    },
  };
}

/**
 * Derives a strict PUBLIC-only user contract without mutating the Manager
 * schema. Account selection is removed because keyapi fixes the account.
 */
export function publicUserSchema<T extends SchemaDefinition>(
  sourceSchema: T,
  options: PublicUserSchemaOptions = {}
): T {
  const derivedSchema: SchemaDefinition = {
    ...sourceSchema,
  };

  if (sourceSchema.params) {
    derivedSchema.params = closeObjectSchemas(
      enforceUserIdUuid(sourceSchema.params)
    );
  }

  if (sourceSchema.body) {
    const body =
      options.omitAccountIdFrom === 'body'
        ? omitAccountId(sourceSchema.body)
        : sourceSchema.body;
    const consumes = Array.isArray(sourceSchema.consumes)
      ? sourceSchema.consumes
      : [];
    derivedSchema.body = consumes.includes('multipart/form-data')
      ? closeMultipartBody(body)
      : closeObjectSchemas(body);
  }

  if (sourceSchema.querystring) {
    derivedSchema.querystring = closeObjectSchemas(
      options.omitAccountIdFrom === 'querystring'
        ? omitAccountId(sourceSchema.querystring)
        : sourceSchema.querystring
    );
  }

  return publicApiSchema(derivedSchema as T, {
    requireExecutor: options.requireExecutor,
  });
}
