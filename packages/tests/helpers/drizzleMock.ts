type QueryChain = {
  from: jest.Mock;
  innerJoin: jest.Mock;
  leftJoin: jest.Mock;
  rightJoin: jest.Mock;
  where: jest.Mock;
  orderBy: jest.Mock;
  groupBy: jest.Mock;
  limit: jest.Mock;
  offset: jest.Mock;
  values: jest.Mock;
  set: jest.Mock;
  returning: jest.Mock;
  execute: jest.Mock;
};

function createQueryChain<T>(result: T): QueryChain {
  const chain = {} as QueryChain;

  chain.from = jest.fn(() => chain);
  chain.innerJoin = jest.fn(() => chain);
  chain.leftJoin = jest.fn(() => chain);
  chain.rightJoin = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.orderBy = jest.fn(() => chain);
  chain.groupBy = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.offset = jest.fn(() => chain);
  chain.values = jest.fn(() => chain);
  chain.set = jest.fn(() => chain);
  chain.returning = jest.fn(() => chain);
  chain.execute = jest.fn(async () => result);

  return chain;
}

export function createSelectDbMock<T>(result: T) {
  const chain = createQueryChain(result);
  const db = {
    select: jest.fn(() => chain),
  };

  return { db, ...chain };
}

export function createInsertDbMock<T>(result: T) {
  const chain = createQueryChain(result);
  const db = {
    insert: jest.fn(() => chain),
  };

  return { db, ...chain };
}

export function createUpdateDbMock<T>(result: T) {
  const chain = createQueryChain(result);
  const db = {
    update: jest.fn(() => chain),
  };

  return { db, ...chain };
}

export function createDeleteDbMock<T>(result: T) {
  const chain = createQueryChain(result);
  const db = {
    delete: jest.fn(() => chain),
  };

  return { db, ...chain };
}

export function createQueryRepositoryMock<TFindMany, TFindFirst = unknown>(
  findManyResult: TFindMany,
  findFirstResult?: TFindFirst
) {
  return {
    query: {
      findMany: jest.fn(async () => findManyResult),
      findFirst: jest.fn(async () => findFirstResult),
    },
  };
}
