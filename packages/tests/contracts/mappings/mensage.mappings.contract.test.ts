import {
  mensageMappings,
  workerCommandMessageMappings,
} from '@core/mappings/mensage.mappings';

describe('mensageMappings official template payload', () => {
  it('keeps the template in _source without dynamically mapping its shape', () => {
    const mapping = mensageMappings() as {
      mappings: {
        properties: {
          content: {
            dynamic: boolean;
            properties: {
              official_template: Record<string, unknown>;
            };
          };
        };
      };
    };

    const content = mapping.mappings.properties.content;

    expect(content.dynamic).toBe(false);
    expect(content.properties.official_template).toEqual({
      type: 'object',
      dynamic: false,
      enabled: false,
    });
  });
});

describe('worker command message mappings', () => {
  it('keeps the additive bootstrap mapping identical to the full message mapping', () => {
    const fullProperties = mensageMappings().mappings.properties;
    const bootstrapProperties =
      workerCommandMessageMappings().mappings.properties;

    expect(bootstrapProperties).toEqual({
      worker_command_transport: { type: 'keyword' },
      worker_command_issued_at: { type: 'date' },
      worker_command_retry_of: { type: 'keyword' },
      worker_command_deadline_at: { type: 'date' },
      worker_command_expiry_reason: { type: 'keyword' },
      broker_command_id: { type: 'keyword' },
      broker_operation_id: { type: 'keyword' },
      broker_stream: { type: 'keyword' },
      broker_stream_sequence: { type: 'long' },
      broker_accepted_at: { type: 'date' },
      broker_expires_at: { type: 'date' },
      broker_duplicate: { type: 'boolean' },
      worker_command_expired_at: { type: 'date' },
      delivery_status: { type: 'keyword' },
      provider_error_code: { type: 'integer' },
      provider_status_at: { type: 'date' },
    });

    for (const [field, mapping] of Object.entries(bootstrapProperties)) {
      expect(fullProperties[field as keyof typeof fullProperties]).toEqual(
        mapping
      );
    }
  });
});
