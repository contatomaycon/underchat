import { RouteNamedMap } from 'vue-router/auto-routes';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EHomePermissions } from '@core/common/enums/EPermissions/home';
import { EServerPermissions } from '@core/common/enums/EPermissions/server';
import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';
import { ERolePermissions } from '@core/common/enums/EPermissions/role';
import { ESectorPermissions } from '@core/common/enums/EPermissions/sector';
import { EExpenditurePermissions } from '@core/common/enums/EPermissions/expenditure';
import { EUserPermissions } from '@core/common/enums/EPermissions/user';
import { EAccountPermissions } from '@core/common/enums/EPermissions/account';
import { EMessageTemplatePermissions } from '@core/common/enums/EPermissions/messageTemplate';
import { ELabelTemplatePermissions } from '@core/common/enums/EPermissions/labelTemplate';
import { EContactPermissions } from '@core/common/enums/EPermissions/contact';
import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { EFinancialPermissions } from '@core/common/enums/EPermissions/financial';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';

export default [
  {
    title: 'home',
    to: { name: 'root' as keyof RouteNamedMap },
    icon: { icon: 'tabler-smart-home' },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EHomePermissions.home_group,
      EHomePermissions.home_view,
    ],
  },
  {
    title: 'chat',
    icon: { icon: 'tabler-message-circle' },
    to: { name: 'chat' as keyof RouteNamedMap },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.chat_access,
    ],
  },
  {
    title: 'channels',
    to: { name: 'channels' as keyof RouteNamedMap },
    icon: { icon: 'tabler-plug' },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EWorkerPermissions.worker_group,
      EWorkerPermissions.create_worker,
      EWorkerPermissions.update_worker,
      EWorkerPermissions.view_worker,
      EWorkerPermissions.delete_worker,
    ],
  },
  {
    title: 'chatbot',
    to: { name: 'chatbot' as keyof RouteNamedMap },
    icon: { icon: 'tabler-robot' },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatbotPermissions.chatbot_group,
      EChatbotPermissions.chatbot_access,
    ],
  },
  {
    title: 'utilities',
    icon: { icon: 'tabler-tool' },
    children: [
      {
        title: 'labels',
        to: { name: 'label' as keyof RouteNamedMap },
        icon: { icon: 'tabler-label' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          ELabelTemplatePermissions.label_template_group,
          ELabelTemplatePermissions.label_view,
          ELabelTemplatePermissions.label_create,
          ELabelTemplatePermissions.label_update,
          ELabelTemplatePermissions.label_delete,
        ],
      },
      {
        title: 'quick_messages',
        to: { name: 'message' as keyof RouteNamedMap },
        icon: { icon: 'tabler-message' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EMessageTemplatePermissions.message_template_group,
          EMessageTemplatePermissions.message_view,
          EMessageTemplatePermissions.message_create,
          EMessageTemplatePermissions.message_update,
          EMessageTemplatePermissions.message_delete,
        ],
      },
    ],
  },
  {
    title: 'contacts',
    to: { name: 'contact-and-groups' as keyof RouteNamedMap },
    icon: { icon: 'tabler-address-book' },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EContactPermissions.contact_group,
      EContactPermissions.contact_view,
      EContactPermissions.contact_create,
      EContactPermissions.contact_update,
      EContactPermissions.contact_delete,
    ],
  },
  {
    title: 'roles',
    to: { name: 'roles' as keyof RouteNamedMap },
    icon: { icon: 'tabler-crosshair' },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      ERolePermissions.role_group,
      ERolePermissions.role_view,
      ERolePermissions.role_create,
      ERolePermissions.role_edit,
      ERolePermissions.role_delete,
    ],
  },
  {
    title: 'sector',
    to: { name: 'sector' as keyof RouteNamedMap },
    icon: { icon: 'tabler-sitemap' },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      ESectorPermissions.sector_group,
      ESectorPermissions.sector_view,
      ESectorPermissions.sector_create,
      ESectorPermissions.sector_edit,
      ESectorPermissions.sector_delete,
    ],
  },
  {
    title: 'users',
    to: { name: 'user' as keyof RouteNamedMap },
    icon: { icon: 'tabler-users' },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EUserPermissions.user_group,
      EUserPermissions.user_view,
      EUserPermissions.user_create,
      EUserPermissions.user_update,
      EUserPermissions.user_delete,
    ],
  },
  {
    title: 'accounts',
    to: { name: 'account' as keyof RouteNamedMap },
    icon: { icon: 'tabler-user' },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EAccountPermissions.account_group,
      EAccountPermissions.account_view,
      EAccountPermissions.account_create,
      EAccountPermissions.account_update,
      EAccountPermissions.account_delete,
    ],
  },
  {
    title: 'plans',
    icon: { icon: 'tabler-package' },
    children: [
      {
        title: 'plans',
        to: { name: 'plan' as keyof RouteNamedMap },
        icon: { icon: 'tabler-package' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EPlanPermissions.plan_group,
          EPlanPermissions.plan_view,
        ],
      },
      {
        title: 'cross_sell',
        to: { name: 'cross-sell' as keyof RouteNamedMap },
        icon: { icon: 'tabler-shopping-cart' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EPlanPermissions.plan_group,
          EPlanPermissions.plan_view,
        ],
      },
    ],
  },
  {
    title: 'expenditure',
    to: { name: 'expenditure' as keyof RouteNamedMap },
    icon: { icon: 'tabler-currency-dollar' },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EExpenditurePermissions.expenditure_group,
      EExpenditurePermissions.expenditure_view,
      EExpenditurePermissions.expenditure_create,
      EExpenditurePermissions.expenditure_update,
      EExpenditurePermissions.expenditure_delete,
    ],
  },
  {
    title: 'reports',
    icon: { icon: 'tabler-chart-bar' },
    children: [
      {
        title: 'sales',
        to: { name: 'reports-sales' as keyof RouteNamedMap },
        icon: { icon: 'tabler-shopping-cart' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EFinancialPermissions.financial_group,
          EFinancialPermissions.financial_view,
        ],
      },
      {
        title: 'clients',
        to: { name: 'reports-clients' as keyof RouteNamedMap },
        icon: { icon: 'tabler-user' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EFinancialPermissions.financial_group,
          EFinancialPermissions.financial_view,
        ],
      },
      {
        title: 'users',
        to: { name: 'reports-users' as keyof RouteNamedMap },
        icon: { icon: 'tabler-users' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EFinancialPermissions.financial_group,
          EFinancialPermissions.financial_view,
        ],
      },
      {
        title: 'financial',
        to: { name: 'reports-financial' as keyof RouteNamedMap },
        icon: { icon: 'tabler-currency-dollar' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EFinancialPermissions.financial_group,
          EFinancialPermissions.financial_view,
        ],
      },
    ],
  },
  {
    title: 'server',
    to: { name: 'server' as keyof RouteNamedMap },
    icon: { icon: 'tabler-server' },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EServerPermissions.server_group,
      EServerPermissions.server_view,
      EServerPermissions.server_edit,
      EServerPermissions.server_create,
      EServerPermissions.server_delete,
    ],
  },
];
