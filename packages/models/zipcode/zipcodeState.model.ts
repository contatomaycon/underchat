import {
  uuid,
  pgTable,
  timestamp,
  varchar,
  numeric,
  smallint,
  index,
} from 'drizzle-orm/pg-core';
import {
  country,
  userAddress,
  zipcode,
  zipcodeCity,
  zipcodeDistrict,
} from '@core/models';
import { relations } from 'drizzle-orm';

export const zipcodeState = pgTable(
  'zipcode_state',
  {
    id_zipcode_state: uuid().primaryKey().notNull(),
    id_country: smallint()
      .references(() => country.country_id)
      .notNull(),
    abbreviation: varchar({ length: 3 }),
    capital: varchar({ length: 100 }),
    fiscal_code: varchar({ length: 10 }),
    latitude: numeric<'number'>({ precision: 10, scale: 6 }),
    longitude: numeric<'number'>({ precision: 10, scale: 6 }),
    region: varchar({ length: 100 }),
    state: varchar({ length: 100 }).notNull(),
    zipcode_end: varchar({ length: 15 }),
    zipcode_start: varchar({ length: 15 }),
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
    index('zipcode_state_id_country_idx').on(table.id_country),
    index('zipcode_state_fiscal_code_idx').on(table.fiscal_code),
    index('zipcode_state_abbreviation_idx').on(table.abbreviation),
  ]
);

export const zipcodeStateRelations = relations(
  zipcodeState,
  ({ one, many }) => ({
    zco: one(country, {
      fields: [zipcodeState.id_country],
      references: [country.country_id],
    }),
    zcc: many(zipcodeCity),
    zcd: many(zipcodeDistrict),
    zcp: many(zipcode),
    zzs: many(userAddress),
  })
);
