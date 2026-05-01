import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatLinkPreviewViewerUseCase } from '@core/useCases/chat/ChatLinkPreviewViewer.useCase';
import { ViewInternalChatLinkPreviewBody } from '@core/schema/internalChat/viewLinkPreview/request.schema';

@injectable()
export class InternalChatLinkPreviewViewerUseCase {
  constructor(
    @inject(ChatLinkPreviewViewerUseCase)
    private readonly chatLinkPreviewViewerUseCase: ChatLinkPreviewViewerUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    body: ViewInternalChatLinkPreviewBody
  ) {
    return this.chatLinkPreviewViewerUseCase.execute(t, body);
  }
}
