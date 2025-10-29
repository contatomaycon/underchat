import {
  uuid,
  pgTable,
  timestamp,
  varchar,
  numeric,
  boolean,
  smallint,
} from 'drizzle-orm/pg-core';
import {
  country,
  zipcodeCity,
  zipcodeState,
  zipcodeDistrict,
} from '@core/models';
import { relations } from 'drizzle-orm';

export const zipcode = pgTable('zipcode', {
  id_zipcode: uuid().primaryKey().notNull(),
  id_country: smallint()
    .references(() => country.country_id)
    .notNull(),
  id_zipcode_city: uuid().references(() => zipcodeCity.id_zipcode_city),
  id_zipcode_district: uuid().references(
    () => zipcodeDistrict.id_zipcode_district
  ),
  id_zipcode_state: uuid().references(() => zipcodeState.id_zipcode_state),
  address_1: varchar({ length: 200 }).notNull(),
  address_2: varchar({ length: 200 }),
  enable: boolean().notNull(),
  fiscal_code: varchar({ length: 50 }),
  latitude: numeric<'number'>({ precision: 10, scale: 6 }),
  longitude: numeric<'number'>({ precision: 10, scale: 6 }),
  type: varchar({ length: 50 }),
  zipcode: varchar({ length: 15 }),
  created_at: timestamp('created_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp('updated_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const zipcodeRelations = relations(zipcode, ({ one }) => ({
  zco: one(country, {
    fields: [zipcode.id_country],
    references: [country.country_id],
  }),
  zcz: one(zipcodeCity, {
    fields: [zipcode.id_zipcode_city],
    references: [zipcodeCity.id_zipcode_city],
  }),
  zcd: one(zipcodeDistrict, {
    fields: [zipcode.id_zipcode_district],
    references: [zipcodeDistrict.id_zipcode_district],
  }),
  zcs: one(zipcodeState, {
    fields: [zipcode.id_zipcode_state],
    references: [zipcodeState.id_zipcode_state],
  }),
}));
