import { relations } from 'drizzle-orm';
import {
  pgTable,
  smallint,
  timestamp,
  varchar,
  index,
} from 'drizzle-orm/pg-core';
import {
  userAddress,
  zipcode,
  zipcodeCity,
  zipcodeDistrict,
  zipcodeState,
} from '@core/models';

export const country = pgTable(
  'country',
  {
    country_id: smallint()
      .primaryKey()
      .generatedByDefaultAsIdentity()
      .notNull(),
    iso_code: varchar({ length: 3 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [index('country_iso_code_idx').on(table.iso_code)]
);

export const countryRelations = relations(country, ({ many }) => ({
  cua: many(userAddress),
  czc: many(zipcodeCity),
  czd: many(zipcodeDistrict),
  czs: many(zipcodeState),
  czp: many(zipcode),
}));
