import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { SaveChatbotFlowRequest } from '@core/schema/chatbot/saveChatbotFlow/request.schema';
import { ChatbotService } from '@core/services/chatbot.service';

@injectable()
export class ChatbotFlowSaverUseCase {
  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly accountService: AccountService
  ) {}

  private normalizeHandleId(handle?: string | null): string | null {
    if (!handle) {
      return null;
    }

    const normalized = handle
      .toString()
      .trim()
      .replace(/^(option-)+/i, '')
      .replace(/-source$/i, '');

    return normalized || null;
  }

  private validateBasicFlowStructure(
    t: TFunction<'translation', undefined>,
    input: SaveChatbotFlowRequest,
    errors: string[]
  ): void {
    if (!input.nodes || input.nodes.length === 0) {
      errors.push(t('chatbot_flow_validation_no_nodes'));
      return;
    }

    const hasStartNode = input.nodes.some((node) => node.type === 'start');
    if (!hasStartNode) {
      errors.push(t('chatbot_flow_validation_no_start_node'));
    }
  }

  private validateNodeConnections(
    t: TFunction<'translation', undefined>,
    node: any,
    input: SaveChatbotFlowRequest,
    errors: string[]
  ): void {
    if (node.type !== 'menu' && node.type !== 'satisfaction') {
      return;
    }

    const nodeData = node.data as any;
    const options = nodeData?.options || [];

    const outgoingEdges = input.edges.filter((edge) => edge.source === node.id);

    const connectedHandles = outgoingEdges
      .map((edge) =>
        this.normalizeHandleId(
          typeof edge.sourceHandle === 'string' ||
            typeof edge.sourceHandle === 'number'
            ? String(edge.sourceHandle)
            : null
        )
      )
      .filter((handle): handle is string => Boolean(handle));

    const handleLessEdges = outgoingEdges.filter(
      (edge) =>
        !edge.sourceHandle ||
        (typeof edge.sourceHandle === 'string' &&
          edge.sourceHandle.trim() === '')
    );

    for (const option of options) {
      if (!option || !option.id) {
        continue;
      }

      const expectedHandleKey =
        this.normalizeHandleId(`option-${option.id}-source`) ||
        this.normalizeHandleId(option.id) ||
        option.id;

      const matchedIndex = connectedHandles.findIndex(
        (handle) => handle === expectedHandleKey
      );

      if (matchedIndex !== -1) {
        connectedHandles.splice(matchedIndex, 1);
        continue;
      }

      if (handleLessEdges.length > 0) {
        handleLessEdges.pop();
        continue;
      }

      errors.push(
        t('chatbot_flow_validation_option_not_connected', {
          nodeLabel: node.label || node.id,
          optionText: option.text || `Opção ${option.id}`,
        })
      );
    }
  }

  private validateMessageNode(
    t: TFunction<'translation', undefined>,
    node: any,
    errors: string[]
  ): void {
    if (node.type !== 'message') {
      return;
    }

    const data = node.data as any;
    if (!data.messageType) {
      errors.push(
        t('chatbot_flow_validation_message_type_required', {
          nodeLabel: node.label || node.id,
        })
      );
      return;
    }

    if (data.messageType === 'text') {
      if (!data.text || data.text.trim().length === 0) {
        errors.push(
          t('chatbot_flow_validation_message_text_required', {
            nodeLabel: node.label || node.id,
          })
        );
      }
      if (data.text && data.text.length > 2000) {
        errors.push(
          t('chatbot_flow_validation_message_text_too_long', {
            nodeLabel: node.label || node.id,
          })
        );
      }
    }

    if (['image', 'audio', 'video'].includes(data.messageType)) {
      if (!data.attachmentFile && !data.text) {
        errors.push(
          t('chatbot_flow_validation_message_attachment_required', {
            nodeLabel: node.label || node.id,
          })
        );
      }
      if (data.text && data.text.length > 500) {
        errors.push(
          t('chatbot_flow_validation_message_caption_too_long', {
            nodeLabel: node.label || node.id,
          })
        );
      }
    }

    if (!data.continueType) {
      errors.push(
        t('chatbot_flow_validation_continue_type_required', {
          nodeLabel: node.label || node.id,
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

    const data = node.data as any;
    if (!data.dataType) {
      errors.push(
        t('chatbot_flow_validation_data_type_required', {
          nodeLabel: node.label || node.id,
        })
      );
      return;
    }

    if (data.dataType === 'name') {
      if (!data.firstName || data.firstName.trim().length === 0) {
        errors.push(
          t('chatbot_flow_validation_first_name_required', {
            nodeLabel: node.label || node.id,
          })
        );
      }
      if (!data.lastName || data.lastName.trim().length === 0) {
        errors.push(
          t('chatbot_flow_validation_last_name_required', {
            nodeLabel: node.label || node.id,
          })
        );
      }
      return;
    }

    if (data.dataType === 'email') {
      if (!data.email || data.email.trim().length === 0) {
        errors.push(
          t('chatbot_flow_validation_email_required', {
            nodeLabel: node.label || node.id,
          })
        );
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email)) {
        errors.push(
          t('chatbot_flow_validation_email_invalid', {
            nodeLabel: node.label || node.id,
          })
        );
      }
      return;
    }

    if (data.dataType === 'cpf') {
      if (!data.cpf || data.cpf.trim().length === 0) {
        errors.push(
          t('chatbot_flow_validation_cpf_required', {
            nodeLabel: node.label || node.id,
          })
        );
      }
      return;
    }

    if (data.dataType === 'cnpj') {
      if (!data.cnpj || data.cnpj.trim().length === 0) {
        errors.push(
          t('chatbot_flow_validation_cnpj_required', {
            nodeLabel: node.label || node.id,
          })
        );
      }
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

    const data = node.data as any;
    if (!data.redirectType) {
      errors.push(
        t('chatbot_flow_validation_redirect_type_required', {
          nodeLabel: node.label || node.id,
        })
      );
      return;
    }

    if (data.redirectType === 'user' && !data.selectedUser) {
      errors.push(
        t('chatbot_flow_validation_redirect_user_required', {
          nodeLabel: node.label || node.id,
        })
      );
    }

    if (data.redirectType === 'sector' && !data.selectedSector) {
      errors.push(
        t('chatbot_flow_validation_redirect_sector_required', {
          nodeLabel: node.label || node.id,
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

    const data = node.data as any;
    if (!data.tagType) {
      errors.push(
        t('chatbot_flow_validation_tag_type_required', {
          nodeLabel: node.label || node.id,
        })
      );
    }

    if (!data.selectedTag) {
      errors.push(
        t('chatbot_flow_validation_tag_required', {
          nodeLabel: node.label || node.id,
        })
      );
    }
  }

  private validateMenuOrSatisfactionNode(
    t: TFunction<'translation', undefined>,
    node: any,
    errors: string[]
  ): void {
    if (node.type !== 'menu' && node.type !== 'satisfaction') {
      return;
    }

    const data = node.data as any;
    if (!data.title || data.title.trim().length === 0) {
      errors.push(
        t('chatbot_flow_validation_title_required', {
          nodeLabel: node.label || node.id,
        })
      );
    }

    if (!data.message || data.message.trim().length === 0) {
      errors.push(
        t('chatbot_flow_validation_message_required', {
          nodeLabel: node.label || node.id,
        })
      );
    }

    if (!data.options || data.options.length === 0) {
      errors.push(
        t('chatbot_flow_validation_options_required', {
          nodeLabel: node.label || node.id,
        })
      );
    }
  }

  private validateFlow(
    t: TFunction<'translation', undefined>,
    input: SaveChatbotFlowRequest
  ): void {
    const errors: string[] = [];

    this.validateBasicFlowStructure(t, input, errors);

    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    for (const node of input.nodes) {
      this.validateNodeConnections(t, node, input, errors);
      this.validateMessageNode(t, node, errors);
      this.validateDataNode(t, node, errors);
      this.validateRedirectNode(t, node, errors);
      this.validateTagNode(t, node, errors);
      this.validateMenuOrSatisfactionNode(t, node, errors);
    }

    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
  }

  async validate(
    t: TFunction<'translation', undefined>,
    input: SaveChatbotFlowRequest,
    accountId: string
  ): Promise<void> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    this.validateFlow(t, input);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: SaveChatbotFlowRequest,
    accountId: string
  ): Promise<string | null> {
    await this.validate(t, input, accountId);

    const chatbotFlowId = await this.chatbotService.saveChatbotFlow(
      input,
      accountId
    );

    if (!chatbotFlowId) {
      throw new Error(t('chatbot_flow_save_error'));
    }

    return chatbotFlowId;
  }
}
