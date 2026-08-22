import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { contactChannel, worker } from '@core/models';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260721170000.sql'),
  'utf8'
);

describe('contact channel tenant constraint', () => {
  it('models the channel relation with account ownership in the same key', () => {
    const contactChannelConfig = getTableConfig(contactChannel);
    const workerConfig = getTableConfig(worker);
    const channelForeignKey = contactChannelConfig.foreignKeys.find(
      (foreignKey) =>
        foreignKey.reference().foreignTable === worker &&
        foreignKey.reference().columns.length === 2
    );
    const workerAccountChannelUnique = workerConfig.indexes.find(
      (index) =>
        index.config.unique &&
        index.config.columns
          .map((column) => ('name' in column ? column.name : null))
          .join(',') === 'account_id,worker_id'
    );

    expect(channelForeignKey?.getName()).toBe(
      'contact_channel_account_channel_fkey'
    );
    expect(
      channelForeignKey?.reference().columns.map((column) => column.name)
    ).toEqual(['account_id', 'channel_id']);
    expect(
      channelForeignKey?.reference().foreignColumns.map((column) => column.name)
    ).toEqual(['account_id', 'worker_id']);
    expect(channelForeignKey?.onDelete).toBe('restrict');
    expect(workerAccountChannelUnique).toBeDefined();
  });

  it('replaces the legacy worker-only foreign key in the production migration', () => {
    expect(migration).toMatch(
      /DELETE FROM "contact_channel" AS "cc"[\s\S]+WHERE NOT EXISTS[\s\S]+"w"\."account_id" = "cc"\."account_id"[\s\S]+"w"\."worker_id" = "cc"\."channel_id"[\s\S]+"w"\."deleted_at" IS NULL/
    );
    expect(migration).toContain(
      'DROP CONSTRAINT "contact_channel_channel_id_worker_worker_id_fk"'
    );
    expect(migration).toContain(
      'ADD CONSTRAINT "contact_channel_account_channel_fkey"'
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("account_id", "channel_id"\)\s+REFERENCES "worker" \("account_id", "worker_id"\)/
    );
  });
});
