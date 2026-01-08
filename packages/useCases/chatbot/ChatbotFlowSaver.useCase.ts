import { injectable } from 'tsyringe';
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

type MediaType = 'image' | 'video' | 'audio';

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

  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly accountService: AccountService,
    private readonly storageService: StorageService,
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
      node.type !== 'aiAgent'
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

      if (handleLessEdges.length > 0) {
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

    if (node.type === 'aiAgent' && nodeData?.actionAfterInteractions === true) {
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
        const nodeLabel =
          node.data?.title || node.label || node.id || 'aiAgent';
        errors.push(
          t('chatbot_flow_validation_interactions_handle_required', {
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

    if (['image', 'audio', 'video'].includes(data.messageType)) {
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

    if (!data.selectedTag) {
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
      errors.push(
        t('chatbot_flow_validation_annotation_required', {
          nodeLabel: node.data?.title || node.label || node.id,
        })
      );
    }
  }

  private normalizeAiAgentNode(
    t: TFunction<'translation', undefined>,
    node: any
  ): void {
    if (node.type !== 'aiAgent') {
      return;
    }

    const data = node.data;
    if (!data) {
      return;
    }

    if (
      !data.defaultQuestion ||
      (typeof data.defaultQuestion === 'string' &&
        data.defaultQuestion.trim().length === 0)
    ) {
      data.defaultQuestion = t('ai_agent_default_question');
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
      !data.defaultQuestion ||
      (typeof data.defaultQuestion === 'string' &&
        data.defaultQuestion.trim().length === 0)
    ) {
      const nodeLabel = node.data?.title || node.label || node.id || 'aiAgent';
      errors.push(
        t('chatbot_flow_validation_ai_agent_default_question_required', {
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

    return false;
  }

  private validateFlow(
    t: TFunction<'translation', undefined>,
    requestData: SaveChatbotFlowRequestData,
    input: SaveChatbotFlowRequest & Record<string, unknown>
  ): void {
    const errors: string[] = [];

    this.validateBasicFlowStructure(t, requestData, errors);

    if (errors.length > 0) {
      const errorMessage =
        errors.filter(Boolean).join('; ') || 'Validation failed';
      throw new Error(errorMessage);
    }

    for (const node of requestData.nodes) {
      if (node.type === 'aiAgent') {
        this.normalizeAiAgentNode(t, node);
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
      this.validateMenuOrSatisfactionNode(t, node, errors);
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
