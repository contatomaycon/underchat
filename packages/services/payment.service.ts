import { inject, injectable } from 'tsyringe';
import { UserCustomerRepository } from '@core/repositories/payment/UserCustomer.repository';
import { AsaasService } from './asaas';
import { UserService } from './user.service';
import { ICreateAsaasCustomerRequest } from '@core/common/interfaces/IAsaasCustomer';
import {
  IGetAsaasCustomerResponse,
  ICreateAsaasCustomerResponse,
} from '@core/common/interfaces/IAsaasCustomer';
import { EUserDocumentType } from '@core/common/enums/EUserDocumentType';
import { ViewUserResponse } from '@core/schema/user/viewUser/response.schema';
import {
  ICreateAsaasPaymentRequest,
  ICreateAsaasPaymentResponse,
  IGetAsaasPaymentPixQrCodeResponse,
} from '@core/common/interfaces/IAsaasPayment';

@injectable()
export class PaymentService {
  constructor(
    private readonly userCustomerRepository: UserCustomerRepository,
    private readonly asaasService: AsaasService,
    private readonly userService: UserService
  ) {}

  private parseAddress = (
    address: string
  ): {
    street: string;
    number?: string;
    complement?: string;
  } => {
    const trimmedAddress = address.trim();

    const numberMatch = trimmedAddress.match(
      /\s+(\d+)(?:\s*[-/]?\s*(\d+))?(\s+.*)?$/
    );
    if (numberMatch) {
      const street = trimmedAddress.substring(0, numberMatch.index).trim();
      const number = numberMatch[1];
      const complement = numberMatch[3]?.trim() || undefined;

      return {
        street: street || trimmedAddress,
        number: number,
        complement: complement,
      };
    }

    return {
      street: trimmedAddress,
    };
  };

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

    return await this.userCustomerRepository.createUserCustomer(
      userId,
      asaasCustomer.id
    );
  };

  private getUserIdByAccountId = async (
    accountId: string
  ): Promise<string | null> => {
    return await this.userCustomerRepository.getFirstUserIdByAccountId(
      accountId
    );
  };

  private findOrCreateAsaasCustomer = async (
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

    return await this.createNewAsaasCustomer(userId, accountId, sensitiveData);
  };

  private findExistingAsaasCustomer = async (
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

  private createNewAsaasCustomer = async (
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

  private buildCreateCustomerRequest = (
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

    return {
      name: fullName,
      cpfCnpj: sensitiveData.document!,
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

  private getFullName = (userView: ViewUserResponse): string => {
    const firstName = userView.user_info?.name || '';
    const lastName = userView.user_info?.last_name || '';
    return `${firstName} ${lastName}`.trim() || 'Cliente';
  };

  private getPhoneData = (
    phone: string | null
  ): { fullPhone: string | undefined; mobilePhone: string | undefined } => {
    if (!phone) {
      return {
        fullPhone: undefined,
        mobilePhone: undefined,
      };
    }

    const cleanedPhone = phone.replace(/\D/g, '');
    const fullPhone = cleanedPhone || undefined;

    return {
      fullPhone,
      mobilePhone: fullPhone,
    };
  };

  private getAddressData = (
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
      const addressParts = this.parseAddress(sensitiveData.address1);
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

  private getFiscalData = (
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

  private isCNPJ = (userView: ViewUserResponse): boolean => {
    const documentTypeId =
      userView.user_document?.user_document_type?.user_document_type_id;
    return documentTypeId === EUserDocumentType.CNPJ;
  };

  private mapCreatedCustomerToResponse = (
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

    if (!payment || !payment.id) {
      return { payment: null, qrCode: null };
    }

    const qrCode = await this.asaasService.getPaymentPixQrCode(payment.id);

    return { payment, qrCode };
  };
}
