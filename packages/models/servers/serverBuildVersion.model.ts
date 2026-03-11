import {
  boolean,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';

export const serverBuildVersion = pgTable(
  'server_build_version',
  {
    server_build_version_id: uuid().primaryKey().notNull(),
    build_type: varchar('build_type', { length: 50 })
      .$type<EServerBuildType>()
      .notNull(),
    version: varchar({ length: 120 }).notNull(),
    harbor_registry: varchar({ length: 255 }).notNull(),
    harbor_repository: varchar({ length: 500 }).notNull(),
    image_reference: varchar({ length: 1000 }).notNull(),
    is_default: boolean().notNull().default(false),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    uniqueIndex('server_build_version_build_type_version_uq').on(
      table.build_type,
      table.version
    ),
    index('server_build_version_build_type_idx').on(table.build_type),
    index('server_build_version_build_type_created_at_idx').on(
      table.build_type,
      table.created_at
    ),
    index('server_build_version_is_default_idx').on(table.is_default),
  ]
);
