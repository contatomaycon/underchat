import 'reflect-metadata';
import { ChatContactDocumentViewerUseCase } from '@core/useCases/chat/ChatContactDocumentViewer.useCase';
import { ChatContactEmailViewerUseCase } from '@core/useCases/chat/ChatContactEmailViewer.useCase';
import { ChatContactPhoneViewerUseCase } from '@core/useCases/chat/ChatContactPhoneViewer.useCase';

const translate = ((key: string) => key) as never;
const accountId = 'account-1';
const contactId = 'contact-1';
const allowedChannelIds = ['channel-1', 'channel-2'];

describe('chat contact sensitive data viewer account isolation', () => {
  it('checks account and channel scope before decrypting email', async () => {
    const service = {
      viewChatContactById: jest.fn(async () => null),
      getChatContactEmailDecrypted: jest.fn(async () => 'hidden@example.com'),
    };
    const useCase = new ChatContactEmailViewerUseCase(service as never);

    await expect(
      useCase.execute(translate, contactId, accountId, allowedChannelIds)
    ).rejects.toThrow('contact_not_found');
    expect(service.viewChatContactById).toHaveBeenCalledWith(
      contactId,
      accountId,
      allowedChannelIds
    );
    expect(service.getChatContactEmailDecrypted).not.toHaveBeenCalled();
  });

  it('checks account and channel scope before decrypting phone', async () => {
    const service = {
      viewChatContactById: jest.fn(async () => null),
      getChatContactPhoneDecrypted: jest.fn(async () => '5511999999999'),
    };
    const useCase = new ChatContactPhoneViewerUseCase(service as never);

    await expect(
      useCase.execute(translate, contactId, accountId, allowedChannelIds)
    ).rejects.toThrow('contact_not_found');
    expect(service.viewChatContactById).toHaveBeenCalledWith(
      contactId,
      accountId,
      allowedChannelIds
    );
    expect(service.getChatContactPhoneDecrypted).not.toHaveBeenCalled();
  });

  it('checks account and channel scope before decrypting document', async () => {
    const service = {
      viewChatContactById: jest.fn(async () => null),
      getChatContactDocumentDecrypted: jest.fn(async () => '12345678900'),
    };
    const useCase = new ChatContactDocumentViewerUseCase(service as never);

    await expect(
      useCase.execute(translate, contactId, accountId, allowedChannelIds)
    ).rejects.toThrow('contact_not_found');
    expect(service.viewChatContactById).toHaveBeenCalledWith(
      contactId,
      accountId,
      allowedChannelIds
    );
    expect(service.getChatContactDocumentDecrypted).not.toHaveBeenCalled();
  });
});
