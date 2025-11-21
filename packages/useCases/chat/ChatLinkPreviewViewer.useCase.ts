import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ViewLinkPreviewBody } from '@core/schema/chat/viewLinkPreview/request.schema';
import { ViewLinkPreviewResponse } from '@core/schema/chat/viewLinkPreview/response.schema';
import { extractFirstUrl } from '@core/common/functions/extractFirstUrl';
import { buildLinkPreview } from '@core/common/functions/buildLinkPreview';
import { normalizeLinkPreview } from '@core/common/functions/normalizeLinkPreview';

@injectable()
export class ChatLinkPreviewViewerUseCase {
  constructor() {}

  async execute(
    t: TFunction<'translation', undefined>,
    body: ViewLinkPreviewBody
  ): Promise<ViewLinkPreviewResponse> {
    const firstUrl = extractFirstUrl(body.url);
    const linkPreview = firstUrl ? await buildLinkPreview(firstUrl) : null;

    if (!linkPreview) {
      throw new Error(t('chat_link_preview_not_found'));
    }

    const linkPreviewNormalized = normalizeLinkPreview(linkPreview);

    if (!linkPreviewNormalized) {
      throw new Error(t('chat_link_preview_not_found'));
    }

    return linkPreviewNormalized;
  }
}
