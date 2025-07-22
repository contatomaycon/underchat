import {
  pgTable,
  timestamp,
  smallint,
  varchar,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account } from '@core/models';
import { EContentWidth } from '@core/common/enums/EContentWidth';
import { EContentLayoutNav } from '@core/common/enums/EContentLayoutNav';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ESkin } from '@core/common/enums/ESkin';
import { ENavbar } from '@core/common/enums/ENavbar';
import { EFooter } from '@core/common/enums/EFooter';

export const accountInfo = pgTable('account_info', {
  account_info_id: smallint()
    .primaryKey()
    .generatedByDefaultAsIdentity()
    .notNull(),
  account_id: smallint()
    .references(() => account.account_id)
    .notNull(),
  logo: varchar({ length: 500 }),
  content_width: varchar({ length: 10 }).default(EContentWidth.fluid),
  content_layout_nav: varchar({ length: 15 }).default(
    EContentLayoutNav.vertical
  ),
  default_locale: varchar({ length: 5 }).default(ELanguage.pt),
  skin: varchar({ length: 20 }).default(ESkin.default),
  navbar: varchar({ length: 20 }).default(ENavbar.sticky),
  footer: varchar({ length: 20 }).default(EFooter.sticky),
  is_vertical_nav_collapsed: boolean().default(false),
  is_vertical_nav_semi_dark: boolean().default(true),
  light_primary_color: varchar({ length: 20 }).default('#2865B7'),
  light_secondary_color: varchar({ length: 20 }).default('#5098E5'),
  dark_primary_color: varchar({ length: 20 }).default('#152642'),
  dark_secondary_color: varchar({ length: 20 }).default('#2865B7'),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  deleted_at: timestamp({ mode: 'string', withTimezone: true }),
});

export const accountInfoRelations = relations(accountInfo, ({ one }) => ({
  aac: one(account, {
    fields: [accountInfo.account_id],
    references: [account.account_id],
  }),
}));
