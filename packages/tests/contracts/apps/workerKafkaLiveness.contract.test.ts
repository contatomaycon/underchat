export {};

const hasKafkaConsumerRequiringProcessReplacement = jest.fn();

jest.mock(
  '@/consumer/registry',
  () => ({
    hasKafkaConsumerRequiringProcessReplacement,
  }),
  { virtual: true }
);

interface WorkerHealthHandlerModule {
  viewHealth: (request: unknown, reply: unknown) => Promise<void>;
}

function buildReply() {
  const reply = {
    request: { id: 'request-1' },
    code: jest.fn(),
    send: jest.fn(),
  };
  reply.code.mockReturnValue(reply);
  return reply;
}

const healthModules = [
  '../../../../apps/worker_baileys/src/controllers/health/methods/viewHealth',
  '../../../../apps/worker_wwebjs/src/controllers/health/methods/viewHealth',
];

describe.each(healthModules)('worker Kafka liveness %s', (modulePath) => {
  beforeEach(() => {
    hasKafkaConsumerRequiringProcessReplacement.mockReset();
  });

  it('keeps ordinary dependency failures out of liveness', async () => {
    hasKafkaConsumerRequiringProcessReplacement.mockReturnValue(false);
    const handler = require(modulePath) as WorkerHealthHandlerModule;
    const reply = buildReply();

    await handler.viewHealth({}, reply);

    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          alive: true,
          kafka_process_replacement_required: false,
        }),
      })
    );
  });

  it('fails liveness only for an unreusable native Kafka member', async () => {
    hasKafkaConsumerRequiringProcessReplacement.mockReturnValue(true);
    const handler = require(modulePath) as WorkerHealthHandlerModule;
    const reply = buildReply();

    await handler.viewHealth({}, reply);

    expect(reply.code).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          alive: false,
          kafka_process_replacement_required: true,
        }),
      })
    );
  });
});

it('fails WWebJS Docker liveness after a provider initialization timeout requires process replacement', async () => {
  hasKafkaConsumerRequiringProcessReplacement.mockReturnValue(false);
  const { markWwebjsProviderProcessReplacementRequired } =
    require('@core/common/functions/wwebjsProcessReplacement') as {
      markWwebjsProviderProcessReplacementRequired: () => void;
    };
  const handler = require(healthModules[1]) as WorkerHealthHandlerModule;
  const reply = buildReply();

  markWwebjsProviderProcessReplacementRequired();
  await handler.viewHealth({}, reply);

  expect(reply.code).toHaveBeenCalledWith(503);
  expect(reply.send).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        alive: false,
        kafka_process_replacement_required: false,
        provider_process_replacement_required: true,
      }),
    })
  );
});
