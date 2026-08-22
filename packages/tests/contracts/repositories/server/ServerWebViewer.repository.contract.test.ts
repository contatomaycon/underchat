import 'reflect-metadata';
import { ServerWebViewerRepository } from '@core/repositories/server/ServerWebViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

describe('ServerWebViewerRepository', () => {
  it('returns null when web data is not found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ServerWebViewerRepository(db as never);

    await expect(repository.viewServerWebById('srv-1')).resolves.toBeNull();
  });

  it('returns web data when query has one row', async () => {
    const row = {
      server_id: 'srv-1',
      server_status_id: 'online',
      web_domain: 'example.com',
      web_port: 443,
      web_protocol: 'https',
    };

    const { db } = createSelectDbMock([row]);
    const repository = new ServerWebViewerRepository(db as never);

    await expect(repository.viewServerWebById('srv-1')).resolves.toEqual(row);
  });

  it('only resolves endpoints whose parent server and web row are not soft-deleted', async () => {
    const { db, where, orderBy, limit } = createSelectDbMock([]);
    const repository = new ServerWebViewerRepository(db as never);

    await repository.viewServerWebById('srv-1');

    const condition = where.mock.calls[0]?.[0] as SQL;
    const compiled = new PgDialect().sqlToQuery(condition);

    expect(compiled.sql).toContain('"server_web"."server_id" = $1');
    expect(compiled.sql).toContain('"server"."deleted_at" is null');
    expect(compiled.sql).toContain('"server_web"."deleted_at" is null');
    expect(compiled.params).toEqual(['srv-1']);
    expect(orderBy).toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith(1);
  });
});
