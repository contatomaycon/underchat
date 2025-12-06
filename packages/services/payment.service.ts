import { injectable } from 'tsyringe';
import { UserCustomerRepository } from '@core/repositories/payment/UserCustomer.repository';
import { AsaasService } from './asaas';
import { UserService } from './user.service';
import {
  ICreateAsaasCustomerRequest,
  IGetAsaasCustomerResponse,
  ICreateAsaasCustomerResponse,
} from '@core/common/interfaces/IAsaasCustomer';
import { EUserDocumentType } from '@core/common/enums/EUserDocumentType';
import { ViewUserResponse } from '@core/schema/user/viewUser/response.schema';
import {
  ICreateAsaasPaymentRequest,
  ICreateAsaasPaymentResponse,
  IGetAsaasPaymentPixQrCodeResponse,
  IGetAsaasPaymentIdentificationFieldResponse,
  ICreateAsaasCreditCardPaymentRequest,
  ICreateAsaasCreditCardPaymentResponse,
  IAsaasCreditCardHolderInfo,
} from '@core/common/interfaces/IAsaasPayment';
import { ITokenizeAsaasCreditCardRequest } from '@core/common/interfaces/IAsaasCreditCard';
import { UserCardCreatorRepository } from '@core/repositories/plan/UserCardCreator.repository';
import { UserCardsListerRepository } from '@core/repositories/plan/UserCardsLister.repository';
import { UserInfoViewerRepository } from '@core/repositories/plan/UserInfoViewer.repository';
import { ViewUserInfoResponse } from '@core/schema/plan/viewUserInfo/response.schema';
import { parseAddress } from '@core/common/functions/parseAddress';

@injectable()
export class PaymentService {
  constructor(
    private readonly userCustomerRepository: UserCustomerRepository,
    private readonly asaasService: AsaasService,
    private readonly userService: UserService,
    private readonly userCardCreatorRepository: UserCardCreatorRepository,
    private readonly userCardsListerRepository: UserCardsListerRepository,
    private readonly userInfoViewerRepository: UserInfoViewerRepository
  ) {}

  getOrCreateCustomer = async (
    accountId: string
  ): Promise<{ user_customer_id: string; user_customer: string } | null> => {
    const userId = await this.getUserIdByAccountId(accountId);
    if (!userId) {
      return null;
    }

    const existingUserCustomer =
      await this.userCustomerRepository.getUserCustomerByUserId(userId);
    if (existingUserCustomer) {
      return existingUserCustomer;
    }

    const sensitiveData =
      await this.userService.getUserSensitiveDataDecrypted(userId);
    if (!sensitiveData?.document) {
      return null;
    }

    const asaasCustomer = await this.findOrCreateAsaasCustomer(
      userId,
      accountId,
      sensitiveData
    );
    if (!asaasCustomer) {
      return null;
    }

    return this.userCustomerRepository.createUserCustomer(
      userId,
      asaasCustomer.id
    );
  };

  private readonly getUserIdByAccountId = async (
    accountId: string
  ): Promise<string | null> => {
    return this.userCustomerRepository.getFirstUserIdByAccountId(accountId);
  };

  private readonly findOrCreateAsaasCustomer = async (
    userId: string,
    accountId: string,
    sensitiveData: {
      document: string | null;
      email: string | null;
      phone: string | null;
      address1: string | null;
      address2: string | null;
    }
  ): Promise<IGetAsaasCustomerResponse | null> => {
    if (!sensitiveData.document) {
      return null;
    }
    const existingCustomer = await this.findExistingAsaasCustomer(
      sensitiveData.document,
      sensitiveData.email
    );
    if (existingCustomer) {
      return existingCustomer;
    }

    return this.createNewAsaasCustomer(userId, accountId, sensitiveData);
  };

  private readonly findExistingAsaasCustomer = async (
    document: string,
    email: string | null
  ): Promise<IGetAsaasCustomerResponse | null> => {
    const customersByDocument = await this.asaasService.listCustomers({
      cpfCnpj: document,
    });

    if (customersByDocument?.data && customersByDocument.data.length > 0) {
      return customersByDocument.data[0];
    }

    if (email) {
      const customersByEmail = await this.asaasService.listCustomers({
        email: email,
      });

      if (customersByEmail?.data && customersByEmail.data.length > 0) {
        return customersByEmail.data[0];
      }
    }

    return null;
  };

  private readonly createNewAsaasCustomer = async (
    userId: string,
    accountId: string,
    sensitiveData: {
      document: string | null;
      email: string | null;
      phone: string | null;
      address1: string | null;
      address2: string | null;
    }
  ): Promise<IGetAsaasCustomerResponse | null> => {
    if (!sensitiveData.document) {
      return null;
    }
    const userView = await this.userService.viewUserById(
      userId,
      accountId,
      false
    );
    if (!userView) {
      return null;
    }

    const createCustomerRequest = this.buildCreateCustomerRequest(
      userId,
      userView,
      sensitiveData
    );

    const createdCustomer = await this.asaasService.createCustomer(
      createCustomerRequest
    );
    if (!createdCustomer) {
      return null;
    }

    return this.mapCreatedCustomerToResponse(createdCustomer);
  };

  private readonly buildCreateCustomerRequest = (
    userId: string,
    userView: ViewUserResponse,
    sensitiveData: {
      document: string | null;
      email: string | null;
      phone: string | null;
      address1: string | null;
      address2: string | null;
    }
  ): ICreateAsaasCustomerRequest => {
    if (!sensitiveData.document) {
      throw new Error('Document is required');
    }
    const fullName = this.getFullName(userView);
    const phoneData = this.getPhoneData(sensitiveData.phone);
    const addressData = this.getAddressData(userView, sensitiveData);
    const fiscalData = this.getFiscalData(userView);
    const isCNPJ = this.isCNPJ(userView);

    if (!sensitiveData.document) {
      throw new Error('Document is required to create Asaas customer');
    }

    return {
      name: fullName,
      cpfCnpj: sensitiveData.document,
      email: sensitiveData.email || undefined,
      phone: phoneData.fullPhone,
      mobilePhone: phoneData.mobilePhone,
      address: addressData.address,
      addressNumber: addressData.addressNumber,
      complement: addressData.complement,
      province: addressData.province,
      postalCode: addressData.postalCode,
      company: isCNPJ ? userView.account?.name : undefined,
      municipalInscription: fiscalData.cityFiscalCode,
      stateInscription: fiscalData.stateFiscalCode,
      externalReference: userId,
    };
  };

  private readonly getFullName = (userView: ViewUserResponse): string => {
    const firstName = userView.user_info?.name || '';
    const lastName = userView.user_info?.last_name || '';
    return `${firstName} ${lastName}`.trim() || 'Cliente';
  };

  private readonly getPhoneData = (
    phone: string | null
  ): { fullPhone: string | undefined; mobilePhone: string | undefined } => {
    if (!phone) {
      return {
        fullPhone: undefined,
        mobilePhone: undefined,
      };
    }

    const cleanedPhone = phone.replaceAll(/\D/g, '');
    const fullPhone = cleanedPhone || undefined;

    return {
      fullPhone,
      mobilePhone: fullPhone,
    };
  };

  private readonly getAddressDataForCreditCard = (
    userInfo: ViewUserInfoResponse,
    sensitiveData: {
      address1: string | null;
      address2: string | null;
    }
  ): {
    addressNumber: string | undefined;
    complement: string | undefined;
    postalCode: string | undefined;
  } => {
    if (sensitiveData.address1) {
      const addressParts = parseAddress(sensitiveData.address1);

      return {
        addressNumber: addressParts.number,
        complement:
          addressParts.complement || sensitiveData.address2 || undefined,
        postalCode: userInfo.user_address?.zip_code || undefined,
      };
    }

    return {
      addressNumber: undefined,
      complement: sensitiveData.address2 || undefined,
      postalCode: userInfo.user_address?.zip_code || undefined,
    };
  };

  private readonly getAddressData = (
    userView: ViewUserResponse,
    sensitiveData: {
      address1: string | null;
      address2: string | null;
    }
  ): {
    address: string | undefined;
    addressNumber: string | undefined;
    complement: string | undefined;
    province: string | undefined;
    postalCode: string | undefined;
  } => {
    if (sensitiveData.address1) {
      const addressParts = parseAddress(sensitiveData.address1);

      return {
        address: addressParts.street,
        addressNumber: addressParts.number,
        complement:
          addressParts.complement || sensitiveData.address2 || undefined,
        province: userView.user_address?.district || undefined,
        postalCode: userView.user_address?.zip_code || undefined,
      };
    }

    if (userView.user_address?.address1_partial) {
      return {
        address: userView.user_address.address1_partial,
        addressNumber: undefined,
        complement:
          sensitiveData.address2 ||
          userView.user_address.address2_partial ||
          undefined,
        province: userView.user_address.district || undefined,
        postalCode: userView.user_address.zip_code || undefined,
      };
    }

    return {
      address: undefined,
      addressNumber: undefined,
      complement: sensitiveData.address2 || undefined,
      province: userView.user_address?.district || undefined,
      postalCode: userView.user_address?.zip_code || undefined,
    };
  };

  private readonly getFiscalData = (
    userView: ViewUserResponse
  ): {
    cityFiscalCode: string | undefined;
    stateFiscalCode: string | undefined;
  } => {
    return {
      cityFiscalCode: userView.user_address?.city_fiscal_code || undefined,
      stateFiscalCode: userView.user_address?.state_fiscal_code || undefined,
    };
  };

  private readonly isCNPJ = (userView: ViewUserResponse): boolean => {
    const documentTypeId =
      userView.user_document?.user_document_type?.user_document_type_id;
    return documentTypeId === EUserDocumentType.CNPJ;
  };

  private readonly mapCreatedCustomerToResponse = (
    createdCustomer: ICreateAsaasCustomerResponse
  ): IGetAsaasCustomerResponse => {
    return {
      object: createdCustomer.object,
      id: createdCustomer.id,
      dateCreated: createdCustomer.dateCreated,
      name: createdCustomer.name,
      email: createdCustomer.email || undefined,
      phone: createdCustomer.phone || undefined,
      mobilePhone: createdCustomer.mobilePhone || undefined,
      address: createdCustomer.address || undefined,
      addressNumber: createdCustomer.addressNumber || undefined,
      complement: createdCustomer.complement || undefined,
      province: createdCustomer.province || undefined,
      city: createdCustomer.city || undefined,
      cityName: createdCustomer.cityName || undefined,
      state: createdCustomer.state || undefined,
      country: createdCustomer.country || undefined,
      postalCode: createdCustomer.postalCode || undefined,
      cpfCnpj: createdCustomer.cpfCnpj,
      personType: createdCustomer.personType || undefined,
      deleted: createdCustomer.deleted || undefined,
      additionalEmails: createdCustomer.additionalEmails || undefined,
      externalReference: createdCustomer.externalReference || undefined,
      notificationDisabled: createdCustomer.notificationDisabled || undefined,
      observations: createdCustomer.observations || undefined,
      foreignCustomer: createdCustomer.foreignCustomer || undefined,
    };
  };

  createPixPayment = async (
    customerId: string,
    value: number,
    description?: string,
    externalReference?: string
  ): Promise<{
    payment: ICreateAsaasPaymentResponse | null;
    qrCode: IGetAsaasPaymentPixQrCodeResponse | null;
  }> => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1);

    const paymentRequest: ICreateAsaasPaymentRequest = {
      customer: customerId,
      billingType: 'PIX',
      value: value,
      dueDate: dueDate.toISOString().split('T')[0],
      description: description,
      externalReference: externalReference,
    };

    const payment = await this.asaasService.createPayment(paymentRequest);

    if (!payment?.id) {
      return { payment: null, qrCode: null };
    }

    const qrCode = await this.asaasService.getPaymentPixQrCode(payment.id);

    return { payment, qrCode };
  };

  createBoletoPayment = async (
    customerId: string,
    value: number,
    description?: string,
    externalReference?: string
  ): Promise<{
    payment: ICreateAsaasPaymentResponse | null;
    identificationField: IGetAsaasPaymentIdentificationFieldResponse | null;
    pixQrCode: IGetAsaasPaymentPixQrCodeResponse | null;
  }> => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3);

    const paymentRequest: ICreateAsaasPaymentRequest = {
      customer: customerId,
      billingType: 'BOLETO',
      value: value,
      dueDate: dueDate.toISOString().split('T')[0],
      description: description,
      externalReference: externalReference,
    };

    const payment = await this.asaasService.createPayment(paymentRequest);

    if (!payment?.id) {
      return { payment: null, identificationField: null, pixQrCode: null };
    }

    const identificationField =
      await this.asaasService.getPaymentIdentificationField(payment.id);

    const pixQrCode = await this.asaasService.getPaymentPixQrCode(payment.id);

    return { payment, identificationField, pixQrCode };
  };

  createCreditCardPayment = async (
    accountId: string,
    customerId: string,
    value: number,
    description: string | undefined,
    externalReference: string | undefined,
    remoteIp: string,
    data: {
      creditCardId?: string;
      newCard?: {
        number: string;
        holder_name: string;
        expiry_month: string;
        expiry_year: string;
        cvv: string;
      };
      installments?: number;
      recurringPayment: boolean;
    }
  ): Promise<{
    payment: ICreateAsaasCreditCardPaymentResponse | null;
    userCardId?: string;
    paymentId?: string;
  }> => {
    const userId = await this.getUserIdByAccountId(accountId);
    if (!userId) {
      return { payment: null };
    }

    const { creditCardToken, userCardId } = await this.getCreditCardToken(
      userId,
      customerId,
      remoteIp,
      data
    );

    if (!creditCardToken) {
      throw new Error('Token do cartão não encontrado');
    }

    const paymentRequest = this.buildCreditCardPaymentRequest(
      customerId,
      value,
      description,
      externalReference,
      remoteIp,
      creditCardToken,
      data.installments
    );

    const payment =
      await this.asaasService.createCreditCardPayment(paymentRequest);

    return {
      payment,
      userCardId,
      paymentId: payment?.id,
    };
  };

  private readonly getCreditCardToken = async (
    userId: string,
    customerId: string,
    remoteIp: string,
    data: {
      creditCardId?: string;
      newCard?: {
        number: string;
        holder_name: string;
        expiry_month: string;
        expiry_year: string;
        cvv: string;
      };
    }
  ): Promise<{
    creditCardToken: string | undefined;
    userCardId?: string;
  }> => {
    if (data.creditCardId) {
      return this.getCreditCardTokenFromExistingCard(userId, data.creditCardId);
    }

    if (data.newCard) {
      return this.tokenizeAndSaveNewCard(
        userId,
        customerId,
        remoteIp,
        data.newCard
      );
    }

    return { creditCardToken: undefined };
  };

  private readonly getCreditCardTokenFromExistingCard = async (
    userId: string,
    creditCardId: string
  ): Promise<{
    creditCardToken: string;
    userCardId?: string;
  }> => {
    const userCard = await this.userCardsListerRepository.getUserCardById(
      creditCardId,
      userId
    );

    if (!userCard) {
      throw new Error('Cartão não encontrado ou não pertence ao usuário');
    }

    return { creditCardToken: userCard.token };
  };

  public readonly tokenizeAndSaveNewCard = async (
    userId: string,
    customerId: string,
    remoteIp: string,
    newCard: {
      number: string;
      holder_name: string;
      expiry_month: string;
      expiry_year: string;
      cvv: string;
    }
  ): Promise<{
    creditCardToken: string;
    userCardId: string;
  }> => {
    const sensitiveData =
      await this.userService.getUserSensitiveDataDecrypted(userId);
    if (!sensitiveData) {
      throw new Error('Dados do usuário não encontrados');
    }

    const userInfo = await this.userInfoViewerRepository.viewUserInfo(userId);
    if (!userInfo?.user_info) {
      throw new Error('Informações do usuário não encontradas');
    }

    const creditCardHolderInfo = this.buildCreditCardHolderInfo(
      userInfo,
      sensitiveData
    );

    const tokenizeRequest: ITokenizeAsaasCreditCardRequest = {
      customer: customerId,
      creditCard: {
        holderName: newCard.holder_name,
        number: newCard.number.replaceAll(/\s/g, ''),
        expiryMonth: newCard.expiry_month,
        expiryYear: newCard.expiry_year,
        ccv: newCard.cvv,
      },
      creditCardHolderInfo,
      remoteIp,
    };

    const tokenizeResult =
      await this.asaasService.tokenizeCreditCard(tokenizeRequest);

    if (!tokenizeResult?.creditCardToken) {
      throw new Error('Falha ao tokenizar cartão de crédito');
    }

    const existingCard =
      await this.userCardsListerRepository.getUserCardByToken(
        userId,
        tokenizeResult.creditCardToken
      );

    if (existingCard) {
      return {
        creditCardToken: existingCard.token,
        userCardId: existingCard.user_card_id,
      };
    }

    const userCardsCount =
      await this.userCardsListerRepository.getUserCardsCount(userId);
    const isFirstCard = userCardsCount === 0;

    const lastNumber = newCard.number.replaceAll(/\s/g, '').slice(-4);
    const userCardId = await this.userCardCreatorRepository.createUserCard({
      userId,
      token: tokenizeResult.creditCardToken,
      holderName: newCard.holder_name,
      lastNumber,
      brand: tokenizeResult.creditCardBrand,
      isDefault: isFirstCard,
    });

    return {
      creditCardToken: tokenizeResult.creditCardToken,
      userCardId,
    };
  };

  private readonly buildCreditCardHolderInfo = (
    userInfo: ViewUserInfoResponse,
    sensitiveData: {
      email: string | null;
      document: string | null;
      phone: string | null;
      address1: string | null;
      address2: string | null;
    }
  ): IAsaasCreditCardHolderInfo => {
    const addressData = this.getAddressDataForCreditCard(
      userInfo,
      sensitiveData
    );

    return {
      name: `${userInfo.user_info?.name || ''} ${userInfo.user_info?.last_name || ''}`.trim(),
      email: sensitiveData.email || '',
      cpfCnpj: sensitiveData.document || '',
      postalCode: addressData.postalCode || '',
      addressNumber: addressData.addressNumber || '',
      addressComplement: addressData.complement || undefined,
      phone: sensitiveData.phone || '',
      mobilePhone: sensitiveData.phone || undefined,
    };
  };

  private readonly calculateInstallmentValue = (
    value: number,
    installments?: number
  ): number | undefined => {
    if (!installments || installments <= 1) {
      return undefined;
    }

    return Number((value / installments).toFixed(2));
  };

  private readonly buildCreditCardPaymentRequest = (
    customerId: string,
    value: number,
    description: string | undefined,
    externalReference: string | undefined,
    remoteIp: string,
    creditCardToken: string,
    installments?: number
  ): ICreateAsaasCreditCardPaymentRequest => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1);

    const hasInstallments = installments && installments > 1;
    const installmentValue = this.calculateInstallmentValue(
      value,
      installments
    );

    return {
      customer: customerId,
      billingType: 'CREDIT_CARD',
      value: value,
      dueDate: dueDate.toISOString().split('T')[0],
      description: description,
      externalReference: externalReference,
      creditCardToken: creditCardToken,
      remoteIp: remoteIp,
      installmentCount: hasInstallments ? installments : undefined,
      installmentValue: installmentValue,
    };
  };
}
