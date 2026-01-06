import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EAiAgentPermissions } from '@core/common/enums/EPermissions/aiAgent';

export const aiAgentViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EAiAgentPermissions.ai_agent_group,
  EAiAgentPermissions.ai_agent_view,
];

export const aiAgentCreatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EAiAgentPermissions.ai_agent_group,
  EAiAgentPermissions.ai_agent_create,
];

export const aiAgentUpdatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EAiAgentPermissions.ai_agent_group,
  EAiAgentPermissions.ai_agent_update,
];

export const aiAgentDeletePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EAiAgentPermissions.ai_agent_group,
  EAiAgentPermissions.ai_agent_delete,
];
