export function createElasticDatabaseServiceMock(selectResult: unknown = null) {
  return {
    select: jest.fn(async () => selectResult),
    create: jest.fn(async () => undefined),
    update: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
  };
}

export function createKafkaServiceMock() {
  return {
    produce: jest.fn(async () => undefined),
    ensure: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
  };
}

export function createGrpcServiceMock() {
  return {
    requestConnection: jest.fn(async () => undefined),
    notifyWorkerStatus: jest.fn(async () => undefined),
  };
}
