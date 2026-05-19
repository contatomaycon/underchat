import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import {
  SaveChatbotFlowRequest,
  SaveChatbotFlowRequestData,
} from '@core/schema/chatbot/saveChatbotFlow/request.schema';
import { ChatbotService } from '@core/services/chatbot.service';
import { StorageService } from '@core/services/storage.service';
import { ConverterService } from '@core/services/converter';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { UploadFileResponse } from '@core/schema/upload/response.schema';
import { EMessageType } from '@core/common/enums/EMessageType';
import {
  CHATBOT_WORKING_HOURS_DEFAULT_TIMEZONE,
  normalizeChatbotWorkingHoursTimezone,
  toChatbotWorkingHoursMinutes,
} from '@core/common/functions/chatbotWorkingHours';

type MediaType = 'image' | 'video' | 'audio' | 'document';
type WeekdayOptionId =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

@injectable()
export class ChatbotFlowSaverUseCase {
  private readonly MAX_FILE_SIZE = 16 * 1024 * 1024;
  private readonly ALLOWED_IMAGE_EXTENSIONS = [
    'jpg',
    'jpeg',
    'png',
    'gif',
    'webp',
  ];
  private readonly ALLOWED_VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg'];
  private readonly ALLOWED_AUDIO_EXTENSIONS = [
    'mp3',
    'wav',
    'm4a',
    'aac',
    'flac',
    'opus',
  ];
  private readonly ALLOWED_IMAGE_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
  ];
  private readonly ALLOWED_VIDEO_MIME_TYPES = [
    'video/mp4',
    'video/webm',
    'video/ogg',
  ];
  private readonly ALLOWED_AUDIO_MIME_TYPES = [
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/m4a',
    'audio/x-m4a',
    'audio/aac',
    'audio/flac',
    'audio/opus',
  ];
  private readonly WEEKDAY_OPTION_IDS: WeekdayOptionId[] = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  private readonly HOURS_OUTSIDE_OPTION_ID = 'outside-hours';
  private readonly HOLIDAY_IS_OPTION_ID = 'is-holiday';
  private readonly HOLIDAY_NOT_OPTION_ID = 'not-holiday';

  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(ConverterService)
    private readonly converterService: ConverterService
  ) {}

  private normalizeHandleId(handle?: string | null): string | null {
    if (!handle) {
      return null;
    }

    const normalized = handle
      .toString()
      .trim()
      .replace(/^option-/i, '')
      .replace(/-source$/i, '');

    return normalized || null;
  }

  private buildDailyRanges(
    startMinutes: number,
    endMinutes: number
  ): Array<{ start: number; end: number }> {
    if (startMinutes < endMinutes) {
      return [
        {
          start: startMinutes,
          end: endMinutes,
        },
      ];
    }

    return [
      {
        start: startMinutes,
        end: 1439,
      },
      {
        start: 0,
        end: endMinutes,
      },
    ];
  }

  private hasRangeConflict(
    first: { start: number; end: number },
    second: { start: number; end: number }
  ): boolean {
    return first.start <= second.end && second.start <= first.end;
  }

  private validateBasicFlowStructure(
    t: TFunction<'translation', undefined>,
    requestData: SaveChatbotFlowRequestData,
    errors: string[]
  ): void {
    if (!requestData.nodes || requestData.nodes.length === 0) {
      errors.push(t('chatbot_flow_validation_no_nodes'));
      return;
    }

    const hasStartNode = requestData.nodes.some(
      (node) => node.type === 'start'
    );
    if (!hasStartNode) {
      errors.push(t('chatbot_flow_validation_no_start_node'));
    }

    const nodesWithoutOutput: any[] = [];

    for (const node of requestData.nodes) {
      if (
        node.type === 'finish' ||
        node.type === 'annotation' ||
        node.type === 'redirect' ||
        node.type === 'distribution'
      ) {
        continue;
      }

      const hasOutput = requestData.edges.some(
        (edge) => edge.source === node.id
      );

      if (!hasOutput) {
        nodesWithoutOutput.push(node);
      }
    }

    if (nodesWithoutOutput.length > 0) {
      const nodeLabels: string[] = [];
      for (const node of nodesWithoutOutput) {
        nodeLabels.push(this.getNodeLabel(t, node));
      }
      errors.push(
        t('chatbot_flow_validation_node_not_connected', {
          nodeLabel: nodeLabels.join(', '),
        })
      );
    }
  }

  private getNodeLabel(
    t: TFunction<'translation', undefined>,
    node: any
  ): string {
    if (node.data?.title) {
      return node.data.title;
    }

    if (node.label) {
      return node.label;
    }

    if (node.type === 'aiAgent') {
      return t('chatbot_ai_agent');
    }

    if (node.type === 'menu') {
      return t('chatbot_menu');
    }

    if (node.type === 'satisfaction') {
      return t('chatbot_satisfaction');
    }

    if (node.type === 'message') {
      return t('chatbot_message');
    }

    if (node.type === 'redirect') {
      return t('chatbot_redirect');
    }

    if (node.type === 'tag') {
      return t('chatbot_tag');
    }

    if (node.type === 'data') {
      return t('chatbot_data');
    }

    if (node.type === 'contact') {
      return t('chatbot_contact');
    }

    if (node.type === 'weekday') {
      return t('chatbot_weekday');
    }

    if (node.type === 'hours') {
      return t('chatbot_hours');
    }

    if (node.type === 'holiday') {
      return t('chatbot_holidays');
    }

    if (node.type === 'annotation') {
      return t('chatbot_annotation_node_title');
    }

    if (node.type === 'distribution') {
      return t('chatbot_distribution');
    }

    if (node.type === 'randomMessage') {
      return t('chatbot_random_message');
    }

    if (node.type === 'finish') {
      return t('chatbot_finish');
    }

    if (node.type === 'start') {
      return t('chatbot_start');
    }

    return node.id || 'Nó';
  }

  private validateNodeConnections(
    t: TFunction<'translation', undefined>,
    node: any,
    requestData: SaveChatbotFlowRequestData,
    errors: string[]
  ): void {
    if (
      node.type !== 'menu' &&
      node.type !== 'satisfaction' &&
      node.type !== 'weekday' &&
      node.type !== 'hours' &&
      node.type !== 'holiday' &&
      node.type !== 'aiAgent' &&
      node.type !== 'conditional'
    ) {
      return;
    }

    const nodeData = node.data;
    const options = nodeData?.options || [];

    const outgoingEdges = requestData.edges.filter(
      (edge) => edge.source === node.id
    );

    const connectedHandles = outgoingEdges
      .map((edge) =>
        this.normalizeHandleId(
          typeof edge.sourceHandle === 'string' ||
            typeof edge.sourceHandle === 'number'
            ? String(edge.sourceHandle)
            : null
        )
      )
      .filter(Boolean) as string[];

    const handleLessEdges = outgoingEdges.filter(
      (edge) =>
        !edge.sourceHandle ||
        (typeof edge.sourceHandle === 'string' &&
          edge.sourceHandle.trim() === '')
    );

    for (const option of options) {
      if (!option?.id) {
        continue;
      }

      const expectedHandleKey = option.id;

      const matchedIndex = connectedHandles.indexOf(expectedHandleKey);

      if (matchedIndex !== -1) {
        connectedHandles.splice(matchedIndex, 1);
        continue;
      }

      if (
        node.type !== 'weekday' &&
        node.type !== 'hours' &&
        node.type !== 'holiday' &&
        handleLessEdges.length > 0
      ) {
        handleLessEdges.pop();
        continue;
      }

      errors.push(
        t('chatbot_flow_validation_option_not_connected', {
          nodeLabel: node.data?.title || node.label || node.id,
          optionText: option.text || `Opção ${option.id}`,
        })
      );
    }

    if (node.type === 'aiAgent') {
      if (nodeData?.actionAfterInteractions === true) {
        const interactionsHandleId = 'interactions-quantity-source';
        const normalizedInteractionsHandle = 'interactions-quantity';

        const hasInteractionsConnection = outgoingEdges.some((edge) => {
          const edgeHandleId = this.normalizeHandleId(
            typeof edge.sourceHandle === 'string' ||
              typeof edge.sourceHandle === 'number'
              ? String(edge.sourceHandle)
              : null
          );
          const rawHandleId =
            typeof edge.sourceHandle === 'string'
              ? edge.sourceHandle
              : typeof edge.sourceHandle === 'number'
                ? String(edge.sourceHandle)
                : null;

          return (
            edgeHandleId === normalizedInteractionsHandle ||
            rawHandleId === interactionsHandleId ||
            rawHandleId === 'interactions-quantity'
          );
        });

        if (!hasInteractionsConnection) {
          const nodeLabel = this.getNodeLabel(t, node);
          errors.push(
            t('chatbot_flow_validation_interactions_handle_required', {
              nodeLabel,
            })
          );
        }
      }

      const fallbackHandleId = 'fallback-source';
      const normalizedFallbackHandle = 'fallback';

      const hasFallbackConnection = outgoingEdges.some((edge) => {
        const edgeHandleId = this.normalizeHandleId(
          typeof edge.sourceHandle === 'string' ||
            typeof edge.sourceHandle === 'number'
            ? String(edge.sourceHandle)
            : null
        );
        const rawHandleId =
          typeof edge.sourceHandle === 'string'
            ? edge.sourceHandle
            : typeof edge.sourceHandle === 'number'
              ? String(edge.sourceHandle)
              : null;

        return (
          edgeHandleId === normalizedFallbackHandle ||
          rawHandleId === fallbackHandleId ||
          rawHandleId === 'fallback'
        );
      });

      if (!hasFallbackConnection) {
        const nodeLabel = this.getNodeLabel(t, node);
        errors.push(
          t('chatbot_flow_validation_fallback_handle_required', {
            nodeLabel,
          })
        );
      }
    }

    if (node.type === 'conditional') {
      const defaultHandleId = 'default-source';
      const normalizedDefaultHandle = 'default';

      const outgoingEdges = requestData.edges.filter(
        (edge) => edge.source === node.id
      );

      const hasDefaultConnection = outgoingEdges.some((edge) => {
        const edgeHandleId = this.normalizeHandleId(
          typeof edge.sourceHandle === 'string' ||
            typeof edge.sourceHandle === 'number'
            ? String(edge.sourceHandle)
            : null
        );
        const rawHandleId =
          typeof edge.sourceHandle === 'string'
            ? edge.sourceHandle
            : typeof edge.sourceHandle === 'number'
              ? String(edge.sourceHandle)
              : null;

        return (
          edgeHandleId === normalizedDefaultHandle ||
          rawHandleId === defaultHandleId ||
          rawHandleId === 'default'
        );
      });

      if (!hasDefaultConnection) {
        const nodeLabel = this.getNodeLabel(t, node);
        errors.push(
          t('chatbot_flow_validation_conditional_default_handle_required', {
            nodeLabel,
          })
        );
      }
    }
  }

  private validateTextMessage(
    t: TFunction<'translation', undefined>,
    node: any,
    data: any,
    errors: string[]
  ): void {
    if (!data.text || data.text.trim().length === 0) {
      errors.push(
        t('chatbot_flow_validation_message_text_required', {
          nodeLabel: node.data?.title || node.label || node.id,
        })
      );
    }
    if (data.text && data.text.length > 2000) {
      errors.push(
        t('chatbot_flow_validation_message_text_too_long', {
          nodeLabel: node.data?.title || node.label || node.id,
        })
      );
    }
  }

  private validateMediaMessage(
    t: TFunction<'translation', undefined>,
    node: any,
    data: any,
    hasAttachmentFile: boolean | undefined,
    errors: string[]
  ): void {
    if (!data.attachmentUrl && !hasAttachmentFile && !data.text) {
      errors.push(
        t('chatbot_flow_validation_message_attachment_required', {
          nodeLabel: node.data?.title || node.label || node.id,
        })
      );
    }
    if (data.text && data.text.length > 500) {
      errors.push(
        t('chatbot_flow_validation_message_caption_too_long', {
          nodeLabel: node.data?.title || node.label || node.id,
        })
      );
    }
  }

  private validateMessageNode(
    t: TFunction<'translation', undefined>,
    node: any,
    errors: string[],
    hasAttachmentFile?: boolean
  ): void {
    if (node.type !== 'message') {
      return;
    }

    const data = node.data;
    if (!data.messageType) {
      errors.push(
        t('chatbot_flow_validation_message_type_required', {
          nodeLabel: node.data?.title || node.label || node.id,
        })
      );
      return;
    }

    if (data.messageType === 'text') {
      this.validateTextMessage(t, node, data, errors);
    }

    if (['image', 'audio', 'video', 'document'].includes(data.messageType)) {
      this.validateMediaMessage(t, node, data, hasAttachmentFile, errors);
    }

    if (!data.continueType) {
      errors.push(
        t('chatbot_flow_validation_continue_type_required', {
          nodeLabel: node.data?.title || node.label || node.id,
        })
      );
    }
  }

  private validateDataNode(
    t: TFunction<'translation', undefined>,
    node: any,
    errors: string[]
  ): void {
    if (node.type !== 'data') {
      return;
    }

    const data = node.data;

    if (!data) {
      errors.push(
        t('chatbot_flow_validation_data_type_required', {
          nodeLabel: node.label || node.id,
        })
      );
      return;
    }

    const dataType = data.dataType;
    if (
      dataType === null ||
      dataType === undefined ||
      (typeof dataType === 'string' && dataType.trim() === '')
    ) {
      errors.push(
        t('chatbot_flow_validation_data_type_required', {
          nodeLabel: data.title || node.label || node.id,
        })
      );
    }
  }

  private validateRandomMessageNode(
    t: TFunction<'translation', undefined>,
    node: any,
    errors: string[]
  ): void {
    if (node.type !== 'randomMessage') {
      return;
    }

    const data = node.data;
    const nodeLabel = this.getNodeLabel(t, node);

    if (
      !data?.selectedRandomMessage ||
      (typeof data.selectedRandomMessage === 'string' &&
        data.selectedRandomMessage.trim().length === 0)
    ) {
      errors.push(
        t('chatbot_flow_validation_random_message_required', {
          nodeLabel,
        })
      );
    }

    if (!data?.continueType) {
      errors.push(
        t('chatbot_flow_validation_continue_type_required', {
          nodeLabel,
        })
      );
    }
  }

  private validateRedirectNode(
    t: TFunction<'translation', undefined>,
    node: any,
    errors: string[]
  ): void {
    if (node.type !== 'redirect') {
      return;
    }

    const data = node.data;
    if (!data.redirectType) {
      errors.push(
        t('chatbot_flow_validation_redirect_type_required', {
          nodeLabel: node.data?.title || node.label || node.id,
        })
      );
      return;
    }

    if (data.redirectType === 'user' && !data.selectedUser) {
      errors.push(
        t('chatbot_flow_validation_redirect_user_required', {
          nodeLabel: node.data?.title || node.label || node.id,
        })
      );
    }

    if (data.redirectType === 'sector' && !data.selectedSector) {
      errors.push(
        t('chatbot_flow_validation_redirect_sector_required', {
          nodeLabel: node.data?.title || node.label || node.id,
        })
      );
    }
  }

  private validateTagNode(
    t: TFunction<'translation', undefined>,
    node: any,
    errors: string[]
  ): void {
    if (node.type !== 'tag') {
      return;
    }

    const data = node.data;
    if (!data.tagType) {
      errors.push(
        t('chatbot_flow_validation_tag_type_required', {
          nodeLabel: node.data?.title || node.label || node.id,
        })
      );
    }

    const hasSelectedTag =
      Array.isArray(data.selectedTag) && data.selectedTag.length > 0;

    if (!hasSelectedTag) {
      errors.push(
        t('chatbot_flow_validation_tag_required', {
          nodeLabel: node.data?.title || node.label || node.id,
        })
      );
    }
  }

  private validateAnnotationNode(
    t: TFunction<'translation', undefined>,
    node: any,
    errors: string[]
  ): void {
    if (node.type !== 'annotation') {
      return;
    }

    const data = node.data;
    if (
      !data.annotation ||
      (typeof data.annotation === 'string' &&
        data.annotation.trim().length === 0)
    ) {
      const nodeLabel = this.getNodeLabel(t, node);
      errors.push(
        t('chatbot_flow_validation_annotation_required', {
          nodeLabel,
        })
      );
    }
  }

  private validateDistributionNode(
    t: TFunction<'translation', undefined>,
    node: any,
    errors: string[]
  ): void {
    if (node.type !== 'distribution') {
      return;
    }

    const data = node.data;
    const distributionHasSector = data.distributionHasSector;

    if (
      distributionHasSector === true &&
      (!data.distributionSelectedSector ||
        (typeof data.distributionSelectedSector === 'string' &&
          data.distributionSelectedSector.trim().length === 0))
    ) {
      const nodeLabel = this.getNodeLabel(t, node);
      errors.push(
        t('chatbot_flow_validation_distribution_sector_required', {
          nodeLabel,
        })
      );
    }
  }

  private validateConditionalNode(
    t: TFunction<'translation', undefined>,
    node: any,
    errors: string[]
  ): void {
    if (node.type !== 'conditional') {
      return;
    }

    const data = node.data;
    const conditions = data.conditions;

    if (!Array.isArray(conditions) || conditions.length === 0) {
      const nodeLabel = this.getNodeLabel(t, node);
      errors.push(
        t('chatbot_flow_validation_conditional_required', {
          nodeLabel,
        })
      );
      return;
    }

    const nodeLabel = this.getNodeLabel(t, node);

    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];

      if (!condition.conditionType) {
        errors.push(
          t('chatbot_flow_validation_conditional_type_required', {
            nodeLabel,
          })
        );
      }

      if (
        !condition.conditionTerm ||
        (typeof condition.conditionTerm === 'string' &&
          condition.conditionTerm.trim().length === 0)
      ) {
        errors.push(
          t('chatbot_flow_validation_conditional_term_required', {
            nodeLabel,
          })
        );
      }
    }
  }

  private normalizeAiAgentNode(node: any): void {
    if (node.type !== 'aiAgent') {
      return;
    }

    const data = node.data;
    if (!data) {
      return;
    }
  }

  private validateAiAgentNode(
    t: TFunction<'translation', undefined>,
    node: any,
    errors: string[]
  ): void {
    if (node.type !== 'aiAgent') {
      return;
    }

    const data = node.data;
    if (
      !data ||
      !data.selectedAiAgent ||
      (typeof data.selectedAiAgent === 'string' &&
        data.selectedAiAgent.trim().length === 0)
    ) {
      const nodeLabel = node.data?.title || node.label || node.id || 'aiAgent';
      errors.push(
        t('chatbot_flow_validation_ai_agent_required', {
          nodeLabel,
        })
      );
    }

    if (
      !data.options ||
      !Array.isArray(data.options) ||
      data.options.length === 0
    ) {
      const nodeLabel = node.data?.title || node.label || node.id || 'aiAgent';
      errors.push(
        t('chatbot_flow_validation_options_required', {
          nodeLabel,
        })
      );
    }

    if (data.actionAfterInteractions === true) {
      if (
        data.interactionsQuantity === null ||
        data.interactionsQuantity === undefined ||
        (typeof data.interactionsQuantity === 'number' &&
          data.interactionsQuantity <= 0)
      ) {
        const nodeLabel =
          node.data?.title || node.label || node.id || 'aiAgent';
        errors.push(
          t('chatbot_flow_validation_interactions_quantity_required', {
            nodeLabel,
          })
        );
      }
    }
  }

  private validateMenuOrSatisfactionNode(
    t: TFunction<'translation', undefined>,
    node: any,
    errors: string[]
  ): void {
    if (
      node.type !== 'menu' &&
      node.type !== 'satisfaction' &&
      node.type !== 'contact'
    ) {
      return;
    }

    const data = node.data;
    if (node.type !== 'contact') {
      if (!data.title || data.title.trim().length === 0) {
        errors.push(
          t('chatbot_flow_validation_title_required', {
            nodeLabel: node.data?.title || node.label || node.id,
          })
        );
      }
    }

    if (node.type !== 'contact') {
      if (!data.message || data.message.trim().length === 0) {
        errors.push(
          t('chatbot_flow_validation_message_required', {
            nodeLabel: node.data?.title || node.label || node.id,
          })
        );
      }
    }

    if (!data.options || data.options.length === 0) {
      errors.push(
        t('chatbot_flow_validation_options_required', {
          nodeLabel: node.data?.title || node.label || node.id,
        })
      );
    }
  }

  private validateWeekdayNode(
    t: TFunction<'translation', undefined>,
    node: any,
    errors: string[]
  ): void {
    if (node.type !== 'weekday') {
      return;
    }

    const data = node.data;
    const nodeLabel = this.getNodeLabel(t, node);

    if (!data) {
      errors.push(
        t('chatbot_flow_validation_options_required', {
          nodeLabel,
        })
      );
      return;
    }

    if (!data.timezone || String(data.timezone).trim().length === 0) {
      data.timezone = 'America/Sao_Paulo';
    }

    if (!Array.isArray(data.options) || data.options.length !== 7) {
      errors.push(
        t('chatbot_flow_validation_options_required', {
          nodeLabel,
        })
      );
      return;
    }

    const optionIds = new Set<string>(
      data.options
        .filter(
          (option: { id?: unknown }) =>
            option?.id !== null && option?.id !== undefined
        )
        .map((option: { id: unknown }) =>
          String(option.id).trim().toLowerCase()
        )
    );

    for (const weekdayId of this.WEEKDAY_OPTION_IDS) {
      if (!optionIds.has(weekdayId)) {
        errors.push(
          t('chatbot_flow_validation_options_required', {
            nodeLabel,
          })
        );
        return;
      }
    }
  }

  private validateHoursNode(
    t: TFunction<'translation', undefined>,
    node: any,
    errors: string[]
  ): void {
    if (node.type !== 'hours') {
      return;
    }

    const data = node.data;
    const nodeLabel = this.getNodeLabel(t, node);

    if (!data) {
      errors.push(
        t('chatbot_flow_validation_options_required', {
          nodeLabel,
        })
      );
      return;
    }

    data.timezone = normalizeChatbotWorkingHoursTimezone(
      typeof data.timezone === 'string' && data.timezone.trim().length > 0
        ? data.timezone
        : CHATBOT_WORKING_HOURS_DEFAULT_TIMEZONE
    );

    if (!Array.isArray(data.options) || data.options.length === 0) {
      errors.push(
        t('chatbot_flow_validation_options_required', {
          nodeLabel,
        })
      );
      return;
    }

    const options = data.options as Array<{
      id?: unknown;
      text?: unknown;
      start_time?: unknown;
      end_time?: unknown;
    }>;

    const outsideHoursOption = options.find((option) => {
      const optionId =
        option?.id !== null && option?.id !== undefined
          ? String(option.id).trim().toLowerCase()
          : '';

      return optionId === this.HOURS_OUTSIDE_OPTION_ID;
    });

    if (!outsideHoursOption) {
      errors.push(
        t('chatbot_flow_validation_hours_outside_option_required', {
          nodeLabel,
        })
      );
      return;
    }

    const intervalOptions = options.filter((option) => {
      const optionId =
        option?.id !== null && option?.id !== undefined
          ? String(option.id).trim().toLowerCase()
          : '';
      return optionId !== this.HOURS_OUTSIDE_OPTION_ID;
    });

    if (intervalOptions.length === 0) {
      errors.push(
        t('chatbot_flow_validation_hours_interval_required', {
          nodeLabel,
        })
      );
      return;
    }

    const normalizedIntervals: Array<{
      ranges: Array<{ start: number; end: number }>;
      intervalText: string;
    }> = [];

    for (const option of intervalOptions) {
      const startTime =
        option.start_time !== null && option.start_time !== undefined
          ? String(option.start_time).trim()
          : '';
      const endTime =
        option.end_time !== null && option.end_time !== undefined
          ? String(option.end_time).trim()
          : '';
      const intervalText =
        option.text !== null && option.text !== undefined
          ? String(option.text)
          : `${startTime || '--:--'} -> ${endTime || '--:--'}`;

      const startMinutes = toChatbotWorkingHoursMinutes(startTime);
      const endMinutes = toChatbotWorkingHoursMinutes(endTime);

      if (
        startMinutes === null ||
        endMinutes === null ||
        startMinutes === endMinutes
      ) {
        errors.push(
          t('chatbot_flow_validation_hours_invalid_time_range', {
            nodeLabel,
            interval: intervalText,
          })
        );
        return;
      }

      normalizedIntervals.push({
        intervalText,
        ranges: this.buildDailyRanges(startMinutes, endMinutes),
      });
    }

    for (let i = 0; i < normalizedIntervals.length; i++) {
      const current = normalizedIntervals[i];
      for (let j = i + 1; j < normalizedIntervals.length; j++) {
        const next = normalizedIntervals[j];
        const hasConflict = current.ranges.some((currentRange) => {
          return next.ranges.some((nextRange) =>
            this.hasRangeConflict(currentRange, nextRange)
          );
        });

        if (hasConflict) {
          errors.push(
            t('chatbot_flow_validation_hours_conflict', {
              nodeLabel,
            })
          );
          return;
        }
      }
    }
  }

  private validateHolidayNode(
    t: TFunction<'translation', undefined>,
    node: any,
    errors: string[]
  ): void {
    if (node.type !== 'holiday') {
      return;
    }

    const data = node.data;
    const nodeLabel = this.getNodeLabel(t, node);

    if (!data || !Array.isArray(data.options) || data.options.length !== 2) {
      errors.push(
        t('chatbot_flow_validation_options_required', {
          nodeLabel,
        })
      );
      return;
    }

    const optionIds = new Set<string>(
      data.options
        .filter(
          (option: { id?: unknown }) =>
            option?.id !== null && option?.id !== undefined
        )
        .map((option: { id: unknown }) =>
          String(option.id).trim().toLowerCase()
        )
    );

    if (
      !optionIds.has(this.HOLIDAY_IS_OPTION_ID) ||
      !optionIds.has(this.HOLIDAY_NOT_OPTION_ID)
    ) {
      errors.push(
        t('chatbot_flow_validation_holiday_options_required', {
          nodeLabel,
        })
      );
    }
  }

  private hasMediaFileForNode(
    input: SaveChatbotFlowRequest & Record<string, unknown>,
    nodeId: string,
    messageType: string
  ): boolean {
    if (messageType === EMessageType.image) {
      return !!input[`image_${nodeId}`];
    }

    if (messageType === EMessageType.video) {
      return !!input[`video_${nodeId}`];
    }

    if (messageType === EMessageType.audio) {
      return !!input[`audio_${nodeId}`];
    }

    if (messageType === EMessageType.document) {
      return !!input[`document_${nodeId}`];
    }

    return false;
  }

  private isSourceHandle(handleId: string | null | undefined): boolean {
    if (!handleId) {
      return false;
    }

    const lowerId = handleId.toLowerCase();
    return (
      lowerId.includes('-source') ||
      lowerId.endsWith('source') ||
      lowerId === 'interactions-quantity' ||
      lowerId === 'fallback' ||
      lowerId === 'default'
    );
  }

  private isTargetHandle(handleId: string | null | undefined): boolean {
    if (!handleId) {
      return false;
    }

    const lowerId = handleId.toLowerCase();
    return lowerId.includes('-target') || lowerId.endsWith('target');
  }

  private validateEdges(
    t: TFunction<'translation', undefined>,
    requestData: SaveChatbotFlowRequestData,
    errors: string[]
  ): void {
    for (const edge of requestData.edges) {
      const sourceHandleId = edge.sourceHandle
        ? String(edge.sourceHandle)
        : null;
      const targetHandleId = edge.targetHandle
        ? String(edge.targetHandle)
        : null;

      if (!sourceHandleId && !targetHandleId) {
        continue;
      }

      const sourceIsSource = this.isSourceHandle(sourceHandleId);
      const targetIsTarget = this.isTargetHandle(targetHandleId);
      const sourceIsTarget = this.isTargetHandle(sourceHandleId);
      const targetIsSource = this.isSourceHandle(targetHandleId);

      if (sourceHandleId && targetHandleId) {
        if (sourceIsSource && targetIsSource) {
          errors.push(t('chatbot_flow_validation_same_handle_type'));
          continue;
        }

        if (sourceIsTarget && targetIsTarget) {
          errors.push(t('chatbot_flow_validation_same_handle_type'));
          continue;
        }

        if (sourceIsTarget && !targetIsTarget && !targetIsSource) {
          errors.push(t('chatbot_flow_validation_invalid_source_handle'));
          continue;
        }

        if (targetIsSource && !sourceIsSource && !sourceIsTarget) {
          errors.push(t('chatbot_flow_validation_invalid_target_handle'));
          continue;
        }
      }

      if (sourceHandleId && sourceIsTarget && !sourceIsSource) {
        errors.push(t('chatbot_flow_validation_invalid_source_handle'));
        continue;
      }

      if (targetHandleId && targetIsSource && !targetIsTarget) {
        errors.push(t('chatbot_flow_validation_invalid_target_handle'));
        continue;
      }
    }
  }

  private validateFlow(
    t: TFunction<'translation', undefined>,
    requestData: SaveChatbotFlowRequestData,
    input: SaveChatbotFlowRequest & Record<string, unknown>
  ): void {
    const errors: string[] = [];

    this.validateBasicFlowStructure(t, requestData, errors);
    this.validateEdges(t, requestData, errors);

    if (errors.length > 0) {
      const errorMessage =
        errors.filter(Boolean).join('; ') || 'Validation failed';
      throw new Error(errorMessage);
    }

    for (const node of requestData.nodes) {
      if (node.type === 'aiAgent') {
        this.normalizeAiAgentNode(node);
      }

      this.validateNodeConnections(t, node, requestData, errors);

      if (node.type === 'message') {
        const data = node.data;
        const messageType = data.messageType;
        const hasAttachmentFile =
          node.id && messageType
            ? this.hasMediaFileForNode(input, node.id, messageType)
            : false;

        this.validateMessageNode(t, node, errors, hasAttachmentFile);
      } else {
        this.validateMessageNode(t, node, errors);
      }

      this.validateDataNode(t, node, errors);
      this.validateRedirectNode(t, node, errors);
      this.validateTagNode(t, node, errors);
      this.validateAnnotationNode(t, node, errors);
      this.validateAiAgentNode(t, node, errors);
      this.validateRandomMessageNode(t, node, errors);
      this.validateMenuOrSatisfactionNode(t, node, errors);
      this.validateWeekdayNode(t, node, errors);
      this.validateHoursNode(t, node, errors);
      this.validateHolidayNode(t, node, errors);
      this.validateDistributionNode(t, node, errors);
      this.validateConditionalNode(t, node, errors);
    }

    if (errors.length > 0) {
      const errorMessage =
        errors.filter(Boolean).join('; ') || 'Validation failed';
      throw new Error(errorMessage);
    }
  }

  private getFileExtension(filename: string): string {
    const match = /\.([^./\\]+)$/.exec(filename);
    return match?.[1]?.toLowerCase() ?? '';
  }

  private validateFileFormat(
    file: UploadFileRequest,
    messageType: string,
    t: TFunction<'translation', undefined>
  ): void {
    const ext = this.getFileExtension(file.filename);
    const mimetype = file.mimetype?.toLowerCase() || '';

    if (messageType === EMessageType.image) {
      const isValidExt = this.ALLOWED_IMAGE_EXTENSIONS.includes(ext);
      const isValidMime = this.ALLOWED_IMAGE_MIME_TYPES.includes(mimetype);
      if (!isValidExt && !isValidMime) {
        throw new Error(t('chatbot_flow_validation_invalid_image_format'));
      }
    }

    if (messageType === EMessageType.video) {
      const isValidExt = this.ALLOWED_VIDEO_EXTENSIONS.includes(ext);
      const isValidMime = this.ALLOWED_VIDEO_MIME_TYPES.includes(mimetype);
      if (!isValidExt && !isValidMime) {
        throw new Error(t('chatbot_flow_validation_invalid_video_format'));
      }
    }

    if (messageType === EMessageType.audio) {
      const isValidExt = this.ALLOWED_AUDIO_EXTENSIONS.includes(ext);
      const isValidMime = this.ALLOWED_AUDIO_MIME_TYPES.includes(mimetype);
      if (!isValidExt && !isValidMime) {
        throw new Error(t('chatbot_flow_validation_invalid_audio_format'));
      }
    }
  }

  private async processImage(
    image: UploadFileRequest,
    accountId: string
  ): Promise<UploadFileResponse> {
    const uploadResult = await this.storageService.uploadImage(
      image,
      accountId
    );
    if (!uploadResult) {
      throw new Error('Failed to upload image');
    }
    return uploadResult;
  }

  private async processVideo(
    video: UploadFileRequest,
    accountId: string
  ): Promise<
    UploadFileResponse & { duration?: number; width?: number; height?: number }
  > {
    const originalBuffer = await video.toBuffer();
    const originalMimetype = video.mimetype || null;

    const converted = await this.converterService.convertVideo(
      originalBuffer,
      originalMimetype
    );

    const filename = video.filename.replace(/\.[^.]+$/, '') || 'video';
    const newFilename = `${filename}.${converted.extension}`;

    const uploadResult = await this.storageService.uploadVideoFromBuffer(
      converted.buffer,
      newFilename,
      converted.mimetype,
      accountId,
      converted.width,
      converted.height
    );

    if (!uploadResult) {
      throw new Error('Failed to upload video');
    }

    return {
      ...uploadResult,
      mimetype: converted.mimetype,
      duration: converted.duration,
      width: converted.width ?? undefined,
      height: converted.height ?? undefined,
    };
  }

  private async processAudio(
    audio: UploadFileRequest,
    accountId: string
  ): Promise<UploadFileResponse & { duration?: number }> {
    const originalBuffer = await audio.toBuffer();
    const originalMimetype = audio.mimetype || null;

    const converted = await this.converterService.convertAudio(
      originalBuffer,
      originalMimetype,
      false
    );

    const filename = audio.filename.replace(/\.[^.]+$/, '') || 'audio';
    const newFilename = `${filename}.${converted.extension}`;

    const uploadResult = await this.storageService.uploadAudioFromBuffer(
      converted.buffer,
      newFilename,
      converted.mimetype,
      accountId
    );

    if (!uploadResult) {
      throw new Error('Failed to upload audio');
    }

    return {
      ...uploadResult,
      mimetype: converted.mimetype,
      duration: converted.duration,
    };
  }

  private extractNodeIdFromFieldName(fieldName: string): string | null {
    const imageRegex = /^image_(.+)$/;
    const imageMatch = imageRegex.exec(fieldName);
    if (imageMatch) {
      return imageMatch[1];
    }

    const videoRegex = /^video_(.+)$/;
    const videoMatch = videoRegex.exec(fieldName);
    if (videoMatch) {
      return videoMatch[1];
    }

    const audioRegex = /^audio_(.+)$/;
    const audioMatch = audioRegex.exec(fieldName);
    if (audioMatch) {
      return audioMatch[1];
    }

    const documentRegex = /^document_(.+)$/;
    const documentMatch = documentRegex.exec(fieldName);
    if (documentMatch) {
      return documentMatch[1];
    }

    return null;
  }

  private isValidUploadFileRequest(value: unknown): value is UploadFileRequest {
    return value !== null && typeof value === 'object' && 'toBuffer' in value;
  }

  private processMediaFile(
    fieldName: string,
    value: unknown,
    nodeId: string,
    mediaType: MediaType,
    mediaFiles: Map<string, { type: MediaType; file: UploadFileRequest }>
  ): void {
    if (!fieldName.startsWith(`${mediaType}_`)) {
      return;
    }

    const file = value as UploadFileRequest;
    if (this.isValidUploadFileRequest(file)) {
      mediaFiles.set(nodeId, { type: mediaType, file });
    }
  }

  private getMediaFilesByNodeId(
    input: SaveChatbotFlowRequest & Record<string, unknown>
  ): Map<string, { type: MediaType; file: UploadFileRequest }> {
    const mediaFiles = new Map<
      string,
      { type: MediaType; file: UploadFileRequest }
    >();

    for (const [fieldName, value] of Object.entries(input)) {
      if (fieldName === 'request') {
        continue;
      }

      const nodeId = this.extractNodeIdFromFieldName(fieldName);
      if (!nodeId) {
        continue;
      }

      this.processMediaFile(fieldName, value, nodeId, 'image', mediaFiles);
      this.processMediaFile(fieldName, value, nodeId, 'video', mediaFiles);
      this.processMediaFile(fieldName, value, nodeId, 'audio', mediaFiles);
      this.processMediaFile(fieldName, value, nodeId, 'document', mediaFiles);
    }

    return mediaFiles;
  }

  private shouldSkipProcessing(data: any): boolean {
    return (
      !data.messageType || (data.attachmentUrl && data.attachmentUrl !== null)
    );
  }

  private async validateFileSize(
    file: UploadFileRequest,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    const buffer = await file.toBuffer();
    if (buffer.byteLength > this.MAX_FILE_SIZE) {
      throw new Error(t('chatbot_flow_validation_file_too_large'));
    }
  }

  private async processImageNode(
    node: any,
    data: any,
    image: UploadFileRequest,
    messageType: string,
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<any> {
    await this.validateFileSize(image, t);
    this.validateFileFormat(image, messageType, t);
    const uploadResult = await this.processImage(image, accountId);

    return {
      ...node,
      data: {
        ...data,
        attachmentUrl: uploadResult.url,
        attachmentMimetype: uploadResult.mimetype,
      },
    };
  }

  private async processVideoNode(
    node: any,
    data: any,
    video: UploadFileRequest,
    messageType: string,
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<any> {
    await this.validateFileSize(video, t);
    this.validateFileFormat(video, messageType, t);
    const uploadResult = await this.processVideo(video, accountId);

    return {
      ...node,
      data: {
        ...data,
        attachmentUrl: uploadResult.url,
        attachmentMimetype: uploadResult.mimetype,
        attachmentDuration: uploadResult.duration,
        attachmentWidth: uploadResult.width,
        attachmentHeight: uploadResult.height,
      },
    };
  }

  private async processAudioNode(
    node: any,
    data: any,
    audio: UploadFileRequest,
    messageType: string,
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<any> {
    await this.validateFileSize(audio, t);
    this.validateFileFormat(audio, messageType, t);
    const uploadResult = await this.processAudio(audio, accountId);

    return {
      ...node,
      data: {
        ...data,
        attachmentUrl: uploadResult.url,
        attachmentMimetype: uploadResult.mimetype,
        attachmentDuration: uploadResult.duration,
      },
    };
  }

  private async processDocumentNode(
    node: any,
    data: any,
    document: UploadFileRequest,
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<any> {
    await this.validateFileSize(document, t);
    const uploadResult = await this.storageService.uploadDocument(
      document,
      accountId
    );

    if (!uploadResult) {
      throw new Error('Failed to upload document');
    }

    return {
      ...node,
      data: {
        ...data,
        attachmentUrl: uploadResult.url,
        attachmentMimetype: uploadResult.mimetype,
      },
    };
  }

  private async processMediaFiles(
    t: TFunction<'translation', undefined>,
    requestData: SaveChatbotFlowRequestData,
    input: SaveChatbotFlowRequest & Record<string, unknown>,
    accountId: string
  ): Promise<SaveChatbotFlowRequestData> {
    const messageNodes = requestData.nodes.filter(
      (node) => node.type === 'message'
    );

    const mediaFilesByNodeId = this.getMediaFilesByNodeId(input);

    const processedNodes: typeof messageNodes = [];

    for (const node of messageNodes) {
      const data = node.data;
      const messageType = data.messageType;

      if (this.shouldSkipProcessing(data)) {
        processedNodes.push(node);
        continue;
      }

      const mediaFile = mediaFilesByNodeId.get(node.id);
      if (!mediaFile) {
        processedNodes.push(node);
        continue;
      }

      if (messageType === EMessageType.image && mediaFile.type === 'image') {
        const processedNode = await this.processImageNode(
          node,
          data,
          mediaFile.file,
          messageType,
          t,
          accountId
        );
        processedNodes.push(processedNode);
        continue;
      }

      if (messageType === EMessageType.video && mediaFile.type === 'video') {
        const processedNode = await this.processVideoNode(
          node,
          data,
          mediaFile.file,
          messageType,
          t,
          accountId
        );
        processedNodes.push(processedNode);
        continue;
      }

      if (messageType === EMessageType.audio && mediaFile.type === 'audio') {
        const processedNode = await this.processAudioNode(
          node,
          data,
          mediaFile.file,
          messageType,
          t,
          accountId
        );
        processedNodes.push(processedNode);
        continue;
      }

      if (
        messageType === EMessageType.document &&
        mediaFile.type === 'document'
      ) {
        const processedNode = await this.processDocumentNode(
          node,
          data,
          mediaFile.file,
          t,
          accountId
        );
        processedNodes.push(processedNode);
        continue;
      }

      processedNodes.push(node);
    }

    const otherNodes = requestData.nodes.filter(
      (node) => node.type !== 'message'
    );

    return {
      ...requestData,
      nodes: [...otherNodes, ...processedNodes],
    };
  }

  private extractFieldValue(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (Array.isArray(value)) {
      return this.extractFieldValue(value[0]);
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if ('value' in record) {
        return this.extractFieldValue(record.value);
      }
      return null;
    }

    if (typeof value === 'string') {
      return value;
    }

    return null;
  }

  private normalizeRequestData(
    requestField: SaveChatbotFlowRequest['request'],
    t: TFunction<'translation', undefined>
  ): SaveChatbotFlowRequestData {
    const rawValue = this.extractFieldValue(requestField);
    if (!rawValue) {
      throw new Error(t('chatbot_flow_validation_request_data_required'));
    }

    try {
      return JSON.parse(rawValue) as SaveChatbotFlowRequestData;
    } catch {
      throw new Error(t('chatbot_flow_validation_invalid_request_data_format'));
    }
  }

  async validate(
    t: TFunction<'translation', undefined>,
    requestData: SaveChatbotFlowRequestData,
    input: SaveChatbotFlowRequest & Record<string, unknown>,
    accountId: string
  ): Promise<void> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    this.validateFlow(t, requestData, input);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: SaveChatbotFlowRequest & Record<string, unknown>,
    accountId: string
  ): Promise<string | null> {
    const requestData = this.normalizeRequestData(input.request, t);

    await this.validate(t, requestData, input, accountId);

    const processedRequestData = await this.processMediaFiles(
      t,
      requestData,
      input,
      accountId
    );

    const chatbotFlowId = await this.chatbotService.saveChatbotFlow(
      processedRequestData,
      accountId
    );

    if (!chatbotFlowId) {
      throw new Error(t('chatbot_flow_save_error'));
    }

    return chatbotFlowId;
  }
}
