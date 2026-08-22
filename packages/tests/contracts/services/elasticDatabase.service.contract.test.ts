import 'reflect-metadata';

import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import { chatbotFlowMappings } from '@core/mappings/chatbotFlow.mappings';
import { mensageMappings } from '@core/mappings/mensage.mappings';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';

describe('ElasticDatabaseService', () => {
  it('detects Elasticsearch read-only allow-delete cluster block errors', () => {
    const service = new ElasticDatabaseService({} as never);

    expect(
      service.isReadOnlyAllowDeleteBlockError(
        new Error('cluster_block_exception index read-only-allow-delete')
      )
    ).toBe(true);
    expect(
      service.isReadOnlyAllowDeleteBlockError(new Error('connection refused'))
    ).toBe(false);
  });

  it('uses sequence-number OCC without an upsert fallback for an existing document', async () => {
    const client = {
      get: jest.fn(async () => ({ _seq_no: 7, _primary_term: 3 })),
      update: jest.fn(async () => ({ result: 'updated' })),
    };
    const service = new ElasticDatabaseService(client as never);

    await expect(
      service.updateWithScriptOCC(
        'chat',
        'chat-1',
        {
          source: 'ctx._source.status = params.status',
          params: { status: 'queue' },
          upsert: { chat_id: 'chat-1', status: 'queue' },
          scriptedUpsert: false,
        },
        { upsert: true }
      )
    ).resolves.toBe('updated');

    expect(client.update).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'chat',
        id: 'chat-1',
        if_seq_no: 7,
        if_primary_term: 3,
      })
    );
    expect(client.update).toHaveBeenCalledWith(
      expect.not.objectContaining({
        upsert: expect.anything(),
        scripted_upsert: expect.anything(),
      })
    );
  });

  it('uses an upsert fallback without sequence-number OCC for a missing document', async () => {
    const client = {
      get: jest.fn(async () => {
        throw { statusCode: 404 };
      }),
      update: jest.fn(async () => ({ result: 'created' })),
    };
    const service = new ElasticDatabaseService(client as never);

    await expect(
      service.updateWithScriptOCC(
        'chat',
        'chat-1',
        {
          source: 'ctx._source.status = params.status',
          params: { status: 'queue' },
          upsert: { chat_id: 'chat-1', status: 'queue' },
          scriptedUpsert: false,
        },
        { upsert: true }
      )
    ).resolves.toBe('created');

    expect(client.update).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'chat',
        id: 'chat-1',
        upsert: { chat_id: 'chat-1', status: 'queue' },
        scripted_upsert: false,
      })
    );
    expect(client.update).toHaveBeenCalledWith(
      expect.not.objectContaining({
        if_seq_no: expect.anything(),
        if_primary_term: expect.anything(),
      })
    );
  });

  it('switches from an upsert create race to an OCC update without combining both modes', async () => {
    const client = {
      get: jest
        .fn()
        .mockRejectedValueOnce({ statusCode: 404 })
        .mockResolvedValueOnce({ _seq_no: 9, _primary_term: 4 }),
      update: jest
        .fn()
        .mockRejectedValueOnce({ statusCode: 409 })
        .mockResolvedValueOnce({ result: 'updated' }),
    };
    const service = new ElasticDatabaseService(client as never);

    await expect(
      service.updateWithScriptOCC(
        'chat',
        'chat-1',
        {
          source: 'ctx._source.status = params.status',
          params: { status: 'queue' },
          upsert: { chat_id: 'chat-1', status: 'queue' },
          scriptedUpsert: false,
        },
        { upsert: true, maxRetries: 2 }
      )
    ).resolves.toBe('updated');

    expect(client.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        upsert: { chat_id: 'chat-1', status: 'queue' },
        scripted_upsert: false,
      })
    );
    expect(client.update).toHaveBeenNthCalledWith(
      1,
      expect.not.objectContaining({
        if_seq_no: expect.anything(),
        if_primary_term: expect.anything(),
      })
    );
    expect(client.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        if_seq_no: 9,
        if_primary_term: 4,
      })
    );
    expect(client.update).toHaveBeenNthCalledWith(
      2,
      expect.not.objectContaining({
        upsert: expect.anything(),
        scripted_upsert: expect.anything(),
      })
    );
  });

  it('refreshes OCC metadata after a competing existing-document update', async () => {
    const update = jest.fn(async (_input: unknown) => ({ result: 'updated' }));
    update.mockRejectedValueOnce({ statusCode: 409 });
    const client = {
      get: jest
        .fn()
        .mockResolvedValueOnce({ _seq_no: 20, _primary_term: 7 })
        .mockResolvedValueOnce({ _seq_no: 21, _primary_term: 7 }),
      update,
    };
    const service = new ElasticDatabaseService(client as never);

    await expect(
      service.updateWithScriptOCC(
        'chat',
        'chat-1',
        {
          source: 'ctx._source.status = params.status',
          params: { status: 'in_chat' },
          upsert: { chat_id: 'chat-1', status: 'in_chat' },
          scriptedUpsert: false,
        },
        { upsert: true, maxRetries: 2 }
      )
    ).resolves.toBe('updated');

    expect(client.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        if_seq_no: 20,
        if_primary_term: 7,
      })
    );
    expect(client.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        if_seq_no: 21,
        if_primary_term: 7,
      })
    );
    for (const [request] of client.update.mock.calls) {
      expect(request).toEqual(
        expect.not.objectContaining({
          upsert: expect.anything(),
          scripted_upsert: expect.anything(),
        })
      );
    }
  });

  it('does not combine a document upsert with OCC metadata in the generic update path', async () => {
    const client = {
      get: jest.fn(async () => ({ _seq_no: 11, _primary_term: 5 })),
      update: jest.fn(async () => ({ result: 'updated' })),
    };
    const service = new ElasticDatabaseService(client as never);

    await expect(
      service.update('chat', { status: 'in_chat' }, 'chat-1')
    ).resolves.toBe(true);

    expect(client.update).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'chat',
        id: 'chat-1',
        doc: { status: 'in_chat' },
        if_seq_no: 11,
        if_primary_term: 5,
      })
    );
    expect(client.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ upsert: expect.anything() })
    );
  });

  it('keeps bulk script updates mutually exclusive between OCC and upsert', async () => {
    const client = {
      mget: jest.fn(async () => ({
        docs: [
          {
            _id: 'existing',
            found: true,
            _seq_no: 13,
            _primary_term: 6,
          },
          { _id: 'missing', found: false },
        ],
      })),
      bulk: jest.fn(async (_input: unknown) => ({
        errors: false,
        items: [
          { update: { result: 'updated', status: 200 } },
          { update: { result: 'created', status: 201 } },
        ],
      })),
    };
    const service = new ElasticDatabaseService(client as never);

    await expect(
      service.bulkUpdateWithScript('message', [
        {
          id: 'existing',
          script: {
            source: 'ctx._source.value = params.value',
            params: { value: 1 },
          },
          upsert: { value: 1 },
        },
        {
          id: 'missing',
          script: {
            source: 'ctx._source.value = params.value',
            params: { value: 2 },
          },
          upsert: { value: 2 },
        },
      ])
    ).resolves.toEqual({ updated: 2, noop: 0, failed: 0 });

    const body = (
      client.bulk.mock.calls[0]?.[0] as {
        body: Array<Record<string, unknown>>;
      }
    ).body;
    expect(body[0]).toEqual({
      update: {
        _index: 'message',
        _id: 'existing',
        if_seq_no: 13,
        if_primary_term: 6,
      },
    });
    expect(body[1]).toEqual({
      script: {
        source: 'ctx._source.value = params.value',
        params: { value: 1 },
      },
    });
    expect(body[2]).toEqual({
      update: { _index: 'message', _id: 'missing' },
    });
    expect(body[3]).toEqual({
      script: {
        source: 'ctx._source.value = params.value',
        params: { value: 2 },
      },
      scripted_upsert: true,
      upsert: { value: 2 },
    });
  });

  it('uses sequence-number OCC metadata when there is no upsert fallback', async () => {
    const client = {
      get: jest.fn(async () => ({ _seq_no: 7, _primary_term: 3 })),
      update: jest.fn(async () => ({ result: 'updated' })),
    };
    const service = new ElasticDatabaseService(client as never);

    await expect(
      service.updateWithScriptOCC('chat', 'chat-1', {
        source: 'ctx._source.status = params.status',
        params: { status: 'queue' },
      })
    ).resolves.toBe('updated');

    expect(client.update).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'chat',
        id: 'chat-1',
        if_seq_no: 7,
        if_primary_term: 3,
      })
    );
  });

  it('rechecks assignment immediately before the OCC mutation', async () => {
    let active = true;
    const client = {
      get: jest.fn(async () => {
        active = false;
        return { _seq_no: 7, _primary_term: 3 };
      }),
      update: jest.fn(async () => ({ result: 'updated' })),
    };
    const service = new ElasticDatabaseService(client as never);
    const assertActive = jest.fn(() => {
      if (!active) {
        throw new KafkaConsumerDispatchRevokedError();
      }
    });

    await expect(
      service.updateWithScriptOCC(
        'message',
        'message-1',
        {
          source: 'ctx._source.summary.is_sent = true',
          params: {},
        },
        { assertActive }
      )
    ).rejects.toBeInstanceOf(KafkaConsumerDispatchRevokedError);

    expect(client.update).not.toHaveBeenCalled();
  });

  it('does not continue OCC retries after the assignment is revoked', async () => {
    let active = true;
    const client = {
      get: jest.fn(async () => ({ _seq_no: 7, _primary_term: 3 })),
      update: jest.fn(async () => {
        active = false;
        throw { statusCode: 409 };
      }),
    };
    const service = new ElasticDatabaseService(client as never);
    const assertActive = jest.fn(() => {
      if (!active) {
        throw new KafkaConsumerDispatchRevokedError();
      }
    });

    await expect(
      service.updateWithScriptOCC(
        'message',
        'message-1',
        {
          source: 'ctx._source.summary.is_sent = true',
          params: {},
        },
        { maxRetries: 5, assertActive }
      )
    ).rejects.toBeInstanceOf(KafkaConsumerDispatchRevokedError);

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.update).toHaveBeenCalledTimes(1);
  });

  it.each([429, 502, 503, 504])(
    'retries transient Elasticsearch status %i with backoff before re-reading OCC metadata',
    async (statusCode) => {
      const client = {
        get: jest
          .fn()
          .mockResolvedValueOnce({ _seq_no: 7, _primary_term: 3 })
          .mockResolvedValueOnce({ _seq_no: 8, _primary_term: 3 }),
        update: jest
          .fn()
          .mockRejectedValueOnce({ statusCode })
          .mockResolvedValueOnce({ result: 'updated' }),
      };
      const service = new ElasticDatabaseService(client as never);
      const waitForOccRetry = jest.fn(async () => undefined);
      (service as any).waitForOccRetry = waitForOccRetry;

      await expect(
        service.updateWithScriptOCC(
          'message',
          'message-1',
          {
            source: 'ctx._source.summary.is_sent = params.is_sent',
            params: { is_sent: true },
          },
          { maxRetries: 2 }
        )
      ).resolves.toBe('updated');

      expect(client.get).toHaveBeenCalledTimes(2);
      expect(client.update).toHaveBeenCalledTimes(2);
      expect(waitForOccRetry).toHaveBeenCalledWith(0);
    }
  );

  it.each([
    Object.assign(new Error('request timed out'), { name: 'TimeoutError' }),
    Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
  ])(
    'retries timeout and connection failures with backoff',
    async (transientError) => {
      const client = {
        get: jest
          .fn()
          .mockResolvedValueOnce({ _seq_no: 7, _primary_term: 3 })
          .mockResolvedValueOnce({ _seq_no: 8, _primary_term: 3 }),
        update: jest
          .fn()
          .mockRejectedValueOnce(transientError)
          .mockResolvedValueOnce({ result: 'updated' }),
      };
      const service = new ElasticDatabaseService(client as never);
      const waitForOccRetry = jest.fn(async () => undefined);
      (service as any).waitForOccRetry = waitForOccRetry;

      await expect(
        service.updateWithScriptOCC(
          'message',
          'message-1',
          {
            source: 'ctx._source.summary.is_sent = params.is_sent',
            params: { is_sent: true },
          },
          { maxRetries: 2 }
        )
      ).resolves.toBe('updated');

      expect(client.get).toHaveBeenCalledTimes(2);
      expect(client.update).toHaveBeenCalledTimes(2);
      expect(waitForOccRetry).toHaveBeenCalledWith(0);
    }
  );

  it('fails mapper parsing errors on the first attempt without exposing document values', async () => {
    const client = {
      get: jest.fn(async () => ({ _seq_no: 7, _primary_term: 3 })),
      update: jest.fn(async () => {
        throw {
          statusCode: 400,
          meta: {
            body: {
              error: {
                type: 'mapper_parsing_exception',
                reason: 'failed to parse SECRET_TEMPLATE_VALUE',
              },
            },
          },
        };
      }),
    };
    const service = new ElasticDatabaseService(client as never);
    const waitForOccRetry = jest.fn(async () => undefined);
    (service as any).waitForOccRetry = waitForOccRetry;

    const operation = service.updateWithScriptOCC(
      'message',
      'message-1',
      {
        source: 'ctx._source.content = params.content',
        params: { content: 'SECRET_TEMPLATE_VALUE' },
      },
      { maxRetries: 5 }
    );

    await expect(operation).rejects.toThrow(
      'Elasticsearch operation failed [operation=update_with_script_occ index=message document_id=message-1 attempts=1 status=400 type=mapper_parsing_exception]'
    );
    await operation.catch((error: Error) => {
      expect(error.message).not.toContain('SECRET_TEMPLATE_VALUE');
    });
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.update).toHaveBeenCalledTimes(1);
    expect(waitForOccRetry).not.toHaveBeenCalled();
  });

  it('applies mutable dynamic containment before additive legacy mappings and ignores immutable enabled changes', async () => {
    const putMapping = jest.fn(async () => ({ acknowledged: true }));
    const putSettings = jest.fn(async () => ({ acknowledged: true }));
    const client = {
      indices: {
        exists: jest.fn(async () => true),
        getMapping: jest.fn(async () => ({
          message: {
            mappings: {
              properties: {
                content: {
                  type: 'nested',
                  dynamic: true,
                  properties: {
                    official_template: {
                      type: 'object',
                      properties: {
                        components: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        })),
        putMapping,
        putSettings,
      },
    };
    const service = new ElasticDatabaseService(client as never);

    await expect(
      service.indices('message', {
        mappings: {
          properties: {
            content: {
              type: 'nested',
              dynamic: false,
              properties: {
                official_template: {
                  type: 'object',
                  dynamic: false,
                  enabled: false,
                },
                stable_field: { type: 'keyword' },
              },
            },
          },
        },
      })
    ).resolves.toBe(true);

    expect(putMapping).toHaveBeenNthCalledWith(1, {
      index: 'message',
      properties: {
        content: {
          type: 'nested',
          dynamic: false,
          properties: {
            official_template: {
              type: 'object',
              dynamic: false,
            },
          },
        },
      },
    });
    expect(putMapping).toHaveBeenNthCalledWith(2, {
      index: 'message',
      properties: {
        content: {
          properties: {
            stable_field: { type: 'keyword' },
          },
        },
      },
    });
    expect(JSON.stringify(putMapping.mock.calls)).not.toContain('enabled');
    expect(putSettings).not.toHaveBeenCalled();
  });

  it('recognizes an implicit Elasticsearch object before updating its dynamic setting', async () => {
    const putMapping = jest.fn(async (input: unknown) => {
      const request = input as {
        properties?: {
          content?: {
            properties?: {
              official_template?: Record<string, unknown>;
            };
          };
        };
      };
      const officialTemplate =
        request.properties?.content?.properties?.official_template;

      if (
        officialTemplate?.dynamic === false &&
        officialTemplate.type !== 'object'
      ) {
        throw {
          statusCode: 400,
          meta: {
            body: {
              error: {
                type: 'mapper_parsing_exception',
                reason: 'No type specified for field [official_template]',
              },
            },
          },
        };
      }

      return { acknowledged: true };
    });
    const client = {
      indices: {
        exists: jest.fn(async () => true),
        getMapping: jest.fn(async () => ({
          message: {
            mappings: {
              properties: {
                content: {
                  type: 'nested',
                  properties: {
                    official_template: {
                      properties: {
                        components: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        })),
        putMapping,
      },
    };
    const service = new ElasticDatabaseService(client as never);

    await expect(
      service.indices('message', {
        mappings: {
          properties: {
            content: {
              type: 'nested',
              dynamic: false,
              properties: {
                official_template: {
                  type: 'object',
                  dynamic: false,
                  enabled: false,
                },
              },
            },
          },
        },
      })
    ).resolves.toBe(true);

    expect(putMapping).toHaveBeenCalledTimes(1);
    expect(putMapping).toHaveBeenCalledWith({
      index: 'message',
      properties: {
        content: {
          type: 'nested',
          dynamic: false,
          properties: {
            official_template: {
              type: 'object',
              dynamic: false,
            },
          },
        },
      },
    });
  });

  it('does not apply mutable object parameters to an incompatible existing field type', async () => {
    const putMapping = jest.fn(async () => ({ acknowledged: true }));
    const client = {
      indices: {
        exists: jest.fn(async () => true),
        getMapping: jest.fn(async () => ({
          message: {
            mappings: {
              properties: {
                content: {
                  type: 'keyword',
                },
              },
            },
          },
        })),
        putMapping,
      },
    };
    const service = new ElasticDatabaseService(client as never);

    await expect(
      service.indices('message', {
        mappings: {
          properties: {
            content: {
              type: 'nested',
              dynamic: false,
            },
          },
        },
      })
    ).resolves.toBe(true);

    expect(putMapping).not.toHaveBeenCalled();
  });

  it('boots safely at total_fields.limit when official_template is absent from a legacy mapping', async () => {
    type TestFieldMapping = {
      [key: string]: unknown;
      dynamic?: boolean;
      properties?: Record<string, TestFieldMapping>;
    };
    const desiredMapping = mensageMappings() as {
      mappings: {
        properties: Record<string, TestFieldMapping>;
      };
    };
    const legacyMapping = JSON.parse(
      JSON.stringify(desiredMapping.mappings)
    ) as typeof desiredMapping.mappings;
    const legacyContent = legacyMapping.properties.content;
    if (!legacyContent?.properties) {
      throw new Error('message content mapping is required by this contract');
    }
    legacyContent.dynamic = true;
    delete legacyContent.properties.official_template;

    const totalFieldsLimitError = {
      statusCode: 400,
      meta: {
        body: {
          error: {
            type: 'illegal_argument_exception',
            reason:
              'Limit of total fields [1000] has been exceeded while adding new fields [1]',
          },
        },
      },
    };
    const putMapping = jest.fn(async (input: unknown) => {
      if (JSON.stringify(input).includes('official_template')) {
        throw totalFieldsLimitError;
      }

      return { acknowledged: true };
    });
    const putSettings = jest.fn(async () => ({ acknowledged: true }));
    const client = {
      indices: {
        exists: jest.fn(async () => true),
        getMapping: jest.fn(async () => ({
          message: { mappings: legacyMapping },
        })),
        putMapping,
        putSettings,
      },
    };
    const service = new ElasticDatabaseService(client as never);

    await expect(service.indices('message', desiredMapping)).resolves.toBe(
      true
    );

    expect(putMapping).toHaveBeenCalledTimes(1);
    expect(putMapping).toHaveBeenCalledWith({
      index: 'message',
      properties: {
        content: {
          type: 'nested',
          dynamic: false,
        },
      },
    });
    expect(JSON.stringify(putMapping.mock.calls)).not.toContain(
      'official_template'
    );
    expect(putSettings).not.toHaveBeenCalled();
  });

  it('contains legacy chatbot node data at total_fields.limit before official CTA fields are stored', async () => {
    type TestFieldMapping = {
      [key: string]: unknown;
      dynamic?: boolean;
      properties?: Record<string, TestFieldMapping>;
    };
    const desiredMapping = chatbotFlowMappings() as {
      mappings: {
        properties: Record<string, TestFieldMapping>;
      };
    };
    const legacyMapping = JSON.parse(
      JSON.stringify(desiredMapping.mappings)
    ) as typeof desiredMapping.mappings;
    const legacyNodeData = legacyMapping.properties.nodes?.properties?.data;
    if (!legacyNodeData) {
      throw new Error('chatbot node data mapping is required by this contract');
    }
    legacyNodeData.dynamic = true;

    const totalFieldsLimitError = {
      statusCode: 400,
      meta: {
        body: {
          error: {
            type: 'illegal_argument_exception',
            reason:
              'Limit of total fields [1000] has been exceeded while adding new fields [1]',
          },
        },
      },
    };
    const putMapping = jest.fn(async (input: unknown) => {
      const request = input as {
        properties?: {
          nodes?: {
            properties?: {
              data?: Record<string, unknown>;
            };
          };
        };
      };
      const dataPatch = request.properties?.nodes?.properties?.data;
      const isContainmentOnly =
        dataPatch?.type === 'nested' &&
        dataPatch.dynamic === false &&
        Object.keys(dataPatch).every((key) =>
          ['type', 'dynamic'].includes(key)
        );
      if (!isContainmentOnly) {
        throw totalFieldsLimitError;
      }

      return { acknowledged: true };
    });
    const putSettings = jest.fn(async () => ({ acknowledged: true }));
    const client = {
      indices: {
        exists: jest.fn(async () => true),
        getMapping: jest.fn(async () => ({
          chatbot_flow: { mappings: legacyMapping },
        })),
        putMapping,
        putSettings,
      },
    };
    const service = new ElasticDatabaseService(client as never);

    await expect(service.indices('chatbot_flow', desiredMapping)).resolves.toBe(
      true
    );

    expect(putMapping).toHaveBeenCalledTimes(1);
    expect(putMapping).toHaveBeenCalledWith({
      index: 'chatbot_flow',
      properties: {
        nodes: {
          type: 'nested',
          properties: {
            data: {
              type: 'nested',
              dynamic: false,
            },
          },
        },
      },
    });
    expect(putSettings).not.toHaveBeenCalled();
  });

  it('contains a legacy dynamic mapping before surfacing a low total-fields limit and never raises the limit', async () => {
    const putMapping = jest
      .fn()
      .mockResolvedValueOnce({ acknowledged: true })
      .mockRejectedValueOnce({
        statusCode: 400,
        meta: {
          body: {
            error: {
              type: 'illegal_argument_exception',
              reason:
                'Limit of total fields [2] has been exceeded while adding new fields [1]',
            },
          },
        },
      });
    const putSettings = jest.fn(async () => ({ acknowledged: true }));
    const client = {
      indices: {
        exists: jest.fn(async () => true),
        getMapping: jest.fn(async () => ({
          message: {
            mappings: {
              properties: {
                content: {
                  type: 'nested',
                  dynamic: true,
                  properties: {
                    existing: { type: 'keyword' },
                  },
                },
              },
            },
          },
        })),
        putMapping,
        putSettings,
      },
    };
    const service = new ElasticDatabaseService(client as never);

    await expect(
      service.indices('message', {
        mappings: {
          properties: {
            content: {
              type: 'nested',
              dynamic: false,
              properties: {
                existing: { type: 'keyword' },
                required_field: { type: 'keyword' },
              },
            },
          },
        },
      })
    ).rejects.toThrow(
      'Elasticsearch operation failed [operation=add_index_mapping_fields index=message status=400 type=illegal_argument_exception]'
    );

    expect(putMapping).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        properties: {
          content: {
            type: 'nested',
            dynamic: false,
          },
        },
      })
    );
    expect(putSettings).not.toHaveBeenCalled();
  });

  it('is idempotent when mutable and additive mappings already match', async () => {
    const putMapping = jest.fn(async () => ({ acknowledged: true }));
    const client = {
      indices: {
        exists: jest.fn(async () => true),
        getMapping: jest.fn(async () => ({
          message: {
            mappings: {
              properties: {
                content: {
                  type: 'nested',
                  dynamic: false,
                  properties: {
                    official_template: {
                      type: 'object',
                      dynamic: false,
                      properties: {
                        legacy_field: { type: 'keyword' },
                      },
                    },
                    stable_field: { type: 'keyword' },
                  },
                },
              },
            },
          },
        })),
        putMapping,
      },
    };
    const service = new ElasticDatabaseService(client as never);

    await expect(
      service.indices('message', {
        mappings: {
          properties: {
            content: {
              type: 'nested',
              dynamic: false,
              properties: {
                official_template: {
                  type: 'object',
                  dynamic: false,
                  enabled: false,
                },
                stable_field: { type: 'keyword' },
              },
            },
          },
        },
      })
    ).resolves.toBe(true);

    expect(putMapping).not.toHaveBeenCalled();
  });
});
