import { RouteNamedMap } from 'vue-router/auto-routes';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
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
import { ESchedulePermissions } from '@core/common/enums/EPermissions/schedule';
import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import { EAiAgentPermissions } from '@core/common/enums/EPermissions/aiAgent';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { EFinancialPermissions } from '@core/common/enums/EPermissions/financial';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EInternalChatPermissions } from '@core/common/enums/EPermissions/internalChat';
import { EReportConversationHistoryPermissions } from '@core/common/enums/EPermissions/reportConversationHistory';
import { EReportAttendancePermissions } from '@core/common/enums/EPermissions/reportAttendance';
import { EReleasePermissions } from '@core/common/enums/EPermissions/release';
import { EIntegrationPermissions } from '@core/common/enums/EPermissions/integration';
import { ERandomMessagePermissions } from '@core/common/enums/EPermissions/randomMessage';
import { EHolidayPermissions } from '@core/common/enums/EPermissions/holiday';

export default [
  {
    title: 'home',
    to: { name: 'root' as keyof RouteNamedMap },
    icon: { icon: 'tabler-smart-home' },
    allowedWhenExpired: true,
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
      EChatPermissions.view_chatbot_messages,
      EChatbotPermissions.chatbot_group,
      EChatbotPermissions.chatbot_access,
      EInternalChatPermissions.internal_chat_group,
      EInternalChatPermissions.internal_chat_access,
    ],
  },
  {
    title: 'kanban',
    icon: { icon: 'tabler-layout-kanban' },
    to: { name: 'kanban' as keyof RouteNamedMap },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.chat_kanban,
    ],
  },
  {
    title: 'notifications',
    icon: { icon: 'tabler-bell' },
    to: { name: 'release' as keyof RouteNamedMap },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EReleasePermissions.release_group,
      EReleasePermissions.release_view,
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
      {
        title: 'random_messages',
        to: { name: 'random-message' as keyof RouteNamedMap },
        icon: { icon: 'tabler-messages' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          ERandomMessagePermissions.random_message_group,
          ERandomMessagePermissions.random_message_view,
          ERandomMessagePermissions.random_message_create,
          ERandomMessagePermissions.random_message_update,
          ERandomMessagePermissions.random_message_delete,
        ],
      },
      {
        title: 'schedules',
        to: { name: 'schedule' as keyof RouteNamedMap },
        icon: { icon: 'tabler-calendar-time' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          ESchedulePermissions.schedule_group,
          ESchedulePermissions.schedule_view,
          ESchedulePermissions.schedule_create,
          ESchedulePermissions.schedule_update,
          ESchedulePermissions.schedule_delete,
        ],
      },
      {
        title: 'holidays',
        to: { name: 'holidays' as keyof RouteNamedMap },
        icon: { icon: 'tabler-calendar-star' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EHolidayPermissions.holiday_group,
          EHolidayPermissions.holiday_access,
        ],
      },
      {
        title: 'ai_agent',
        to: { name: 'ai-agent' as keyof RouteNamedMap },
        icon: { icon: 'tabler-brain' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EAiAgentPermissions.ai_agent_group,
          EAiAgentPermissions.ai_agent_view,
          EAiAgentPermissions.ai_agent_create,
          EAiAgentPermissions.ai_agent_update,
          EAiAgentPermissions.ai_agent_delete,
        ],
      },
      {
        title: 'voice_ia',
        to: { name: 'voice-ia' as keyof RouteNamedMap },
        icon: { icon: 'tabler-microphone' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EAiAgentPermissions.ai_agent_group,
          EAiAgentPermissions.ai_agent_view,
          EAiAgentPermissions.ai_agent_create,
          EAiAgentPermissions.ai_agent_update,
          EAiAgentPermissions.ai_agent_delete,
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
    to: { name: 'role' as keyof RouteNamedMap },
    icon: { icon: 'tabler-shield' },
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
      ESectorPermissions.sector_update,
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
    to: { name: 'account-all' as keyof RouteNamedMap },
    icon: { icon: 'tabler-building' },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EAccountPermissions.account_group,
    ],
  },
  {
    title: 'plans',
    icon: { icon: 'tabler-package' },
    children: [
      {
        title: 'manage',
        to: {
          name: 'account-settings' as keyof RouteNamedMap,
          query: { tab: 'plans' },
        },
        icon: { icon: 'tabler-settings' },
        allowedWhenExpired: true,
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EPlanPermissions.plan_group,
          EPlanPermissions.plan_invoice,
        ],
      },
      {
        title: 'plans_pricing',
        to: { name: 'plans' as keyof RouteNamedMap },
        icon: { icon: 'tabler-package' },
        allowedWhenExpired: true,
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EPlanPermissions.plan_group,
          EPlanPermissions.plan_invoice,
        ],
      },
      {
        title: 'buy_additional',
        to: { name: 'plan-buy-additional' as keyof RouteNamedMap },
        icon: { icon: 'tabler-shopping-cart-plus' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EPlanPermissions.plan_group,
          EPlanPermissions.plan_invoice,
        ],
      },
      {
        title: 'listar',
        to: { name: 'plan' as keyof RouteNamedMap },
        icon: { icon: 'tabler-list' },
        exactActive: true,
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
      {
        title: 'conversation_history',
        to: { name: 'reports-conversation-history' as keyof RouteNamedMap },
        icon: { icon: 'tabler-message' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EReportConversationHistoryPermissions.report_conversation_history_group,
          EReportConversationHistoryPermissions.report_conversation_history_view,
        ],
      },
      {
        title: 'attendances',
        to: { name: 'reports-attendances' as keyof RouteNamedMap },
        icon: { icon: 'tabler-users-group' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EReportConversationHistoryPermissions.report_conversation_history_group,
          EReportAttendancePermissions.report_attendance_view,
        ],
      },
      {
        title: 'satisfaction',
        to: { name: 'reports-satisfaction' as keyof RouteNamedMap },
        icon: { icon: 'tabler-mood-smile' },
        permissions: [
          EGeneralPermissions.full_access,
          EGeneralPermissions.full_access_group,
          EReportConversationHistoryPermissions.report_conversation_history_group,
          EReportAttendancePermissions.report_satisfaction_view,
        ],
      },
    ],
  },
  {
    title: 'customize',
    to: {
      name: 'account-settings' as keyof RouteNamedMap,
      query: { tab: 'customize' },
    },
    icon: { icon: 'tabler-palette' },
    allowedWhenExpired: true,
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EAccountPermissions.account_group,
      EAccountPermissions.account_customize,
    ],
  },
  {
    title: 'integration',
    to: { name: 'integration' as keyof RouteNamedMap },
    icon: { icon: 'tabler-api' },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EIntegrationPermissions.integration_group,
    ],
  },
  {
    title: 'config',
    to: { name: 'config' as keyof RouteNamedMap },
    icon: { icon: 'tabler-settings' },
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
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
