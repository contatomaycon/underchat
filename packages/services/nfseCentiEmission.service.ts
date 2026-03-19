import { inject, injectable } from 'tsyringe';
import axios from 'axios';
import { createHash, createSign } from 'node:crypto';
import {
  ICreateAsaasInvoiceRequest,
  IGetAsaasInvoiceResponse,
} from '@core/common/interfaces/IAsaasInvoice';
import { parseAddress } from '@core/common/functions/parseAddress';
import { NfseCertificateStorageService } from '@core/services/nfseCertificateStorage.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import forge from 'node-forge';

const CENTI_XML_NAMESPACE = 'http://www.centi.com.br/files/nfse.xsd';
const XMLDSIG_NAMESPACE = 'http://www.w3.org/2000/09/xmldsig#';
const XMLDSIG_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const XMLDSIG_ENVELOPED =
  'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const XMLDSIG_RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const XMLDSIG_SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';

type ForgeComparable = {
  compareTo(other: ForgeComparable): number;
};

type ForgeCertificateLike = {
  publicKey?: {
    n?: ForgeComparable;
    e?: ForgeComparable;
  };
};

type ForgePrivateKeyLike = {
  n?: ForgeComparable;
  e?: ForgeComparable;
};

type ForgeCertBagLike = {
  cert?: ForgeCertificateLike;
};

type ForgeKeyBagLike = {
  key?: ForgePrivateKeyLike;
};

interface NfseCentiConfig {
  integration_base_url: string | null;
  integration_uf: string | null;
  integration_tenant: string | null;
  integration_username: string | null;
  integration_password_encrypted: string | null;
  integration_municipality_code: string | null;
  integration_rps_series: string | null;
  integration_prestador_document: string | null;
  integration_prestador_municipal_inscription: string | null;
  certificate_bucket: string | null;
  certificate_key: string | null;
  certificate_password_encrypted: string | null;
}

interface NfseCentiTomadorData {
  name: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  district: string | null;
  zipCode: string | null;
  municipalityCode: string | null;
  stateUf: string | null;
}

export interface NfseCentiEmissionInput {
  accountPaymentId: string;
  paymentAsaasId: string;
  userCustomer: string;
  invoiceRequest: ICreateAsaasInvoiceRequest;
  nfseConfig: NfseCentiConfig;
  tomador: NfseCentiTomadorData;
}

interface NfseCentiHttpResponse {
  status: number;
  body: string;
  contentType: string | null;
}

type NfseCentiParsedResponse =
  | {
      kind: 'success';
      number: string | null;
      validationCode: string | null;
      rpsSerie: string | null;
      rpsNumber: string | null;
      messages: string[];
      rawBody: string;
    }
  | {
      kind: 'explicit_failure';
      reason: string;
      messages: string[];
      rawBody: string;
    }
  | {
      kind: 'ambiguous';
      reason: string;
      messages: string[];
      rawBody: string;
    };

export type NfseCentiEmissionResult =
  | {
      kind: 'success';
      invoice: IGetAsaasInvoiceResponse;
      rawResponse: string;
      statusDescription: string;
    }
  | {
      kind: 'explicit_failure';
      reason: string;
      messages: string[];
      rawResponse: string;
    }
  | {
      kind: 'ambiguous';
      reason: string;
      messages: string[];
      rawResponse: string;
    };

@injectable()
export class NfseCentiEmissionService {
  constructor(
    @inject(NfseCertificateStorageService)
    private readonly nfseCertificateStorageService: NfseCertificateStorageService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  emitInvoice = async (
    input: NfseCentiEmissionInput
  ): Promise<NfseCentiEmissionResult> => {
    const requiredConfigValidation = this.validateRequiredConfig(
      input.nfseConfig
    );
    if (requiredConfigValidation) {
      return requiredConfigValidation;
    }

    let integrationPassword = '';
    let certificatePassword = '';
    try {
      integrationPassword = this.passwordEncryptorService.decrypt(
        input.nfseConfig.integration_password_encrypted || ''
      );
      certificatePassword = this.passwordEncryptorService.decrypt(
        input.nfseConfig.certificate_password_encrypted || ''
      );
    } catch {
      return {
        kind: 'explicit_failure',
        reason: 'CENTI_CREDENTIAL_DECRYPT_ERROR',
        messages: ['Falha ao descriptografar credenciais de integração NFSe.'],
        rawResponse: '',
      };
    }

    let certificateBuffer: Buffer;
    try {
      certificateBuffer =
        await this.nfseCertificateStorageService.downloadCertificate(
          input.nfseConfig.certificate_bucket || '',
          input.nfseConfig.certificate_key || ''
        );
    } catch {
      return {
        kind: 'explicit_failure',
        reason: 'CENTI_CERTIFICATE_DOWNLOAD_ERROR',
        messages: ['Falha ao baixar certificado digital da NFSe no S3.'],
        rawResponse: '',
      };
    }

    const generatedRpsNumber = this.buildRpsNumber(input.accountPaymentId);

    let signedXml: string;
    try {
      const unsignedXml = this.buildUnsignedXml(input, generatedRpsNumber);
      signedXml = this.signXml(
        unsignedXml,
        certificateBuffer,
        certificatePassword
      );
    } catch (error) {
      return {
        kind: 'explicit_failure',
        reason: 'CENTI_XML_BUILD_OR_SIGN_ERROR',
        messages: [
          error instanceof Error
            ? error.message
            : 'Falha ao gerar/assinar XML da NFSe.',
        ],
        rawResponse: '',
      };
    }

    let response: NfseCentiHttpResponse;
    try {
      response = await this.callCenti({
        baseUrl: input.nfseConfig.integration_base_url || '',
        uf: input.nfseConfig.integration_uf || '',
        tenant: input.nfseConfig.integration_tenant || '',
        usuario: input.nfseConfig.integration_username || '',
        senha: integrationPassword,
        xml: signedXml,
      });
    } catch (error) {
      return {
        kind: 'explicit_failure',
        reason: 'CENTI_HTTP_REQUEST_ERROR',
        messages: [
          error instanceof Error
            ? error.message
            : 'Falha na chamada HTTP para API Centi.',
        ],
        rawResponse: '',
      };
    }

    const parsed = this.parseCentiResponse(response);

    if (parsed.kind !== 'success') {
      return this.mapParsedFailureToEmissionResult(parsed);
    }

    const description =
      parsed.messages.find((message) => message.trim().length > 0) ||
      'NFSe emitida com sucesso via Centi.';

    const invoice = this.buildInvoiceResponse({
      input,
      generatedRpsNumber,
      parsed,
      statusDescription: description,
    });

    return {
      kind: 'success',
      invoice,
      rawResponse: parsed.rawBody,
      statusDescription: description,
    };
  };

  private validateRequiredConfig(
    config: NfseCentiConfig
  ): Extract<NfseCentiEmissionResult, { kind: 'explicit_failure' }> | null {
    const required: Array<[string, string | null]> = [
      ['integration_base_url', config.integration_base_url],
      ['integration_uf', config.integration_uf],
      ['integration_tenant', config.integration_tenant],
      ['integration_username', config.integration_username],
      ['integration_password_encrypted', config.integration_password_encrypted],
      ['integration_municipality_code', config.integration_municipality_code],
      ['integration_rps_series', config.integration_rps_series],
      ['integration_prestador_document', config.integration_prestador_document],
      [
        'integration_prestador_municipal_inscription',
        config.integration_prestador_municipal_inscription,
      ],
      ['certificate_bucket', config.certificate_bucket],
      ['certificate_key', config.certificate_key],
      ['certificate_password_encrypted', config.certificate_password_encrypted],
    ];

    const missing = required
      .filter(([, value]) => !value || value.trim().length === 0)
      .map(([key]) => key);

    if (missing.length === 0) {
      return null;
    }

    return {
      kind: 'explicit_failure',
      reason: 'CENTI_INTEGRATION_CONFIG_MISSING',
      messages: [
        `Campos obrigatórios ausentes para emissão Centi: ${missing.join(', ')}`,
      ],
      rawResponse: '',
    };
  }

  private buildRpsNumber(accountPaymentId: string): string {
    const digits = accountPaymentId.replaceAll(/\D/g, '');
    if (digits.length >= 10) {
      return digits.slice(-10);
    }

    const timestampDigits = Date.now().toString();
    const composed = `${timestampDigits}${digits}`;
    return composed.slice(-10);
  }

  private buildUnsignedXml(
    input: NfseCentiEmissionInput,
    generatedRpsNumber: string
  ): string {
    const invoiceRequest = input.invoiceRequest;
    const nfseConfig = input.nfseConfig;
    const tomador = input.tomador;

    const issueDateTime = this.buildIssueDate(invoiceRequest.effectiveDate);
    const issAliquota = this.formatAliquota(invoiceRequest.taxes?.iss || 0);
    const value = this.formatMoney(invoiceRequest.value);
    const deductions = this.formatMoney(invoiceRequest.deductions || 0);

    const serviceDescription = this.sanitizeText(
      invoiceRequest.serviceDescription,
      2000
    );

    const municipalServiceCode = this.sanitizeText(
      nfseConfig.integration_municipality_code || '',
      7
    );
    const itemListaServico = this.normalizeItemListaServico(
      invoiceRequest.municipalServiceCode || null
    );
    const codigoTributacaoMunicipio = this.sanitizeText(
      invoiceRequest.municipalServiceCode || '',
      20
    );

    const taxes = invoiceRequest.taxes || {
      retainIss: false,
      iss: 0,
      cofins: 0,
      csll: 0,
      inss: 0,
      ir: 0,
      pis: 0,
    };

    const prestadorDocument = this.onlyDigits(
      nfseConfig.integration_prestador_document || ''
    );
    const prestadorMunicipalInscription = this.sanitizeText(
      nfseConfig.integration_prestador_municipal_inscription || '',
      30
    );

    const rpsSerie = this.sanitizeText(
      nfseConfig.integration_rps_series || 'A1',
      5
    );
    const rpsSignatureId = this.buildRpsSignatureId(generatedRpsNumber);

    const tomadorXml = this.buildTomadorXml({
      name: tomador.name,
      document: tomador.document,
      email: tomador.email,
      phone: tomador.phone,
      address1: tomador.address1,
      address2: tomador.address2,
      district: tomador.district,
      zipCode: tomador.zipCode,
      municipalityCode: tomador.municipalityCode || municipalServiceCode,
      stateUf:
        tomador.stateUf || (nfseConfig.integration_uf || '').toUpperCase(),
    });

    const prestadorCpfCnpjTag = this.buildCpfCnpjTag(prestadorDocument);
    if (!prestadorCpfCnpjTag) {
      throw new Error('Documento do prestador inválido para assinatura XML.');
    }

    const optionalValues: string[] = [];
    if (deductions !== '0.00') {
      optionalValues.push(`<ValorDeducoes>${deductions}</ValorDeducoes>`);
    }

    const pisValue = this.formatMoney(taxes.pis || 0);
    if (pisValue !== '0.00') {
      optionalValues.push(`<ValorPis>${pisValue}</ValorPis>`);
    }

    const cofinsValue = this.formatMoney(taxes.cofins || 0);
    if (cofinsValue !== '0.00') {
      optionalValues.push(`<ValorCofins>${cofinsValue}</ValorCofins>`);
    }

    const inssValue = this.formatMoney(taxes.inss || 0);
    if (inssValue !== '0.00') {
      optionalValues.push(`<ValorInss>${inssValue}</ValorInss>`);
    }

    const irValue = this.formatMoney(taxes.ir || 0);
    if (irValue !== '0.00') {
      optionalValues.push(`<ValorIr>${irValue}</ValorIr>`);
    }

    const csllValue = this.formatMoney(taxes.csll || 0);
    if (csllValue !== '0.00') {
      optionalValues.push(`<ValorCsll>${csllValue}</ValorCsll>`);
    }

    const itemListaServicoTag = itemListaServico
      ? `<ItemListaServico>${this.escapeXml(itemListaServico)}</ItemListaServico>`
      : '';

    const codigoTributacaoMunicipioTag = codigoTributacaoMunicipio
      ? `<CodigoTributacaoMunicipio>${this.escapeXml(codigoTributacaoMunicipio)}</CodigoTributacaoMunicipio>`
      : '';

    const xml = [
      `<GerarNfseEnvio xmlns="${CENTI_XML_NAMESPACE}">`,
      '<Rps>',
      `<InfDeclaracaoPrestacaoServico xmlns="${CENTI_XML_NAMESPACE}">`,
      `<Rps Id="${this.escapeXml(rpsSignatureId)}" xmlns="${CENTI_XML_NAMESPACE}">`,
      '<IdentificacaoRps>',
      `<Numero>${generatedRpsNumber}</Numero>`,
      `<Serie>${this.escapeXml(rpsSerie)}</Serie>`,
      '<Tipo>1</Tipo>',
      '</IdentificacaoRps>',
      `<DataEmissao>${issueDateTime}</DataEmissao>`,
      '<Status>1</Status>',
      '</Rps>',
      '<Servico>',
      '<Valores>',
      `<ValorServicos>${value}</ValorServicos>`,
      ...optionalValues,
      `<Aliquota>${issAliquota}</Aliquota>`,
      '</Valores>',
      `<IssRetido>${taxes.retainIss ? '1' : '2'}</IssRetido>`,
      itemListaServicoTag,
      codigoTributacaoMunicipioTag,
      `<Discriminacao>${this.escapeXml(serviceDescription)}</Discriminacao>`,
      `<CodigoMunicipio>${this.escapeXml(municipalServiceCode)}</CodigoMunicipio>`,
      '</Servico>',
      '<Prestador>',
      prestadorCpfCnpjTag,
      `<InscricaoMunicipal>${this.escapeXml(prestadorMunicipalInscription)}</InscricaoMunicipal>`,
      '</Prestador>',
      tomadorXml,
      '</InfDeclaracaoPrestacaoServico>',
      '</Rps>',
      '</GerarNfseEnvio>',
    ]
      .filter(Boolean)
      .join('');

    return xml;
  }

  private buildTomadorXml(input: {
    name: string | null;
    document: string | null;
    email: string | null;
    phone: string | null;
    address1: string | null;
    address2: string | null;
    district: string | null;
    zipCode: string | null;
    municipalityCode: string | null;
    stateUf: string | null;
  }): string {
    const tomadorDocument = this.onlyDigits(input.document || '');
    const cpfCnpjTag = this.buildCpfCnpjTag(tomadorDocument);
    const name = this.sanitizeText(input.name || '', 150);
    const district = this.sanitizeText(input.district || '', 60);
    const zipCode = this.onlyDigits(input.zipCode || '').slice(0, 8);
    const municipalityCode = this.onlyDigits(
      input.municipalityCode || ''
    ).slice(0, 7);
    const stateUf = this.sanitizeText((input.stateUf || '').toUpperCase(), 2);

    const parsedAddress = parseAddress(input.address1 || '');
    const addressStreet = this.sanitizeText(
      parsedAddress.street || input.address1 || '',
      125
    );
    const addressNumber = this.sanitizeText(
      parsedAddress.number || input.address2 || '0',
      10
    );
    const addressComplement = this.sanitizeText(
      parsedAddress.complement || input.address2 || '',
      60
    );

    const phone = this.onlyDigits(input.phone || '').slice(0, 20);
    const email = this.sanitizeText(input.email || '', 80);

    const identification = cpfCnpjTag
      ? `<IdentificacaoTomador>${cpfCnpjTag}</IdentificacaoTomador>`
      : '';

    const addressParts: string[] = [];
    if (addressStreet) {
      addressParts.push(
        `<Endereco>${this.escapeXml(addressStreet)}</Endereco>`
      );
    }
    if (addressNumber) {
      addressParts.push(`<Numero>${this.escapeXml(addressNumber)}</Numero>`);
    }
    if (addressComplement) {
      addressParts.push(
        `<Complemento>${this.escapeXml(addressComplement)}</Complemento>`
      );
    }
    if (district) {
      addressParts.push(`<Bairro>${this.escapeXml(district)}</Bairro>`);
    }
    if (municipalityCode) {
      addressParts.push(
        `<CodigoMunicipio>${this.escapeXml(municipalityCode)}</CodigoMunicipio>`
      );
    }
    if (stateUf) {
      addressParts.push(`<Uf>${this.escapeXml(stateUf)}</Uf>`);
    }
    if (zipCode.length === 8) {
      addressParts.push(`<Cep>${this.escapeXml(zipCode)}</Cep>`);
    }

    const contactParts: string[] = [];
    if (phone) {
      contactParts.push(`<Telefone>${this.escapeXml(phone)}</Telefone>`);
    }
    if (email) {
      contactParts.push(`<Email>${this.escapeXml(email)}</Email>`);
    }

    const addressXml =
      addressParts.length > 0
        ? `<Endereco>${addressParts.join('')}</Endereco>`
        : '';
    const contactXml =
      contactParts.length > 0
        ? `<Contato>${contactParts.join('')}</Contato>`
        : '';

    if (!identification && !name && !addressXml && !contactXml) {
      return '';
    }

    return `<Tomador>${identification}${name ? `<RazaoSocial>${this.escapeXml(name)}</RazaoSocial>` : ''}${addressXml}${contactXml}</Tomador>`;
  }

  private buildCpfCnpjTag(document: string): string {
    if (!document) {
      return '';
    }

    if (document.length === 11) {
      return `<CpfCnpj><Cpf>${this.escapeXml(document)}</Cpf></CpfCnpj>`;
    }

    if (document.length === 14) {
      return `<CpfCnpj><Cnpj>${this.escapeXml(document)}</Cnpj></CpfCnpj>`;
    }

    return '';
  }

  private signXml(
    unsignedXml: string,
    certificateBuffer: Buffer,
    certificatePassword: string
  ): string {
    const credentials = this.extractCertificateCredentials(
      certificateBuffer,
      certificatePassword
    );

    const referenceTarget = this.resolveSignatureReferenceTarget(unsignedXml);
    const digestInput = referenceTarget
      ? referenceTarget.xml
      : this.canonicalizeXml(unsignedXml);
    const digestValue = this.sha1Base64(digestInput);
    const referenceUri = referenceTarget ? `#${referenceTarget.id}` : '';

    const signedInfo = [
      `<SignedInfo xmlns="${XMLDSIG_NAMESPACE}">`,
      `<CanonicalizationMethod Algorithm="${XMLDSIG_C14N}"/>`,
      `<SignatureMethod Algorithm="${XMLDSIG_RSA_SHA1}"/>`,
      `<Reference URI="${this.escapeXml(referenceUri)}">`,
      '<Transforms>',
      `<Transform Algorithm="${XMLDSIG_ENVELOPED}"/>`,
      `<Transform Algorithm="${XMLDSIG_C14N}"/>`,
      '</Transforms>',
      `<DigestMethod Algorithm="${XMLDSIG_SHA1}"/>`,
      `<DigestValue>${digestValue}</DigestValue>`,
      '</Reference>',
      '</SignedInfo>',
    ].join('');

    const signatureValue = this.signWithPrivateKey(
      this.canonicalizeXml(signedInfo),
      credentials.privateKeyPem
    );

    const signatureXml = [
      `<Signature xmlns="${XMLDSIG_NAMESPACE}">`,
      signedInfo,
      `<SignatureValue>${signatureValue}</SignatureValue>`,
      '<KeyInfo>',
      '<X509Data>',
      `<X509Certificate>${credentials.certificateBase64}</X509Certificate>`,
      '</X509Data>',
      '</KeyInfo>',
      '</Signature>',
    ].join('');

    const lastRpsCloseIndex = unsignedXml.lastIndexOf('</Rps>');
    if (lastRpsCloseIndex === -1) {
      throw new Error('Estrutura XML inválida para assinatura.');
    }

    return `${unsignedXml.slice(0, lastRpsCloseIndex)}${signatureXml}${unsignedXml.slice(lastRpsCloseIndex)}`;
  }

  private buildRpsSignatureId(generatedRpsNumber: string): string {
    const digits = this.onlyDigits(generatedRpsNumber).slice(0, 15);
    return `rps${digits || Date.now().toString().slice(-10)}`;
  }

  private resolveSignatureReferenceTarget(unsignedXml: string): {
    id: string;
    xml: string;
  } | null {
    const match = unsignedXml.match(
      /<Rps\b[^>]*\bId="([^"]+)"[^>]*>[\s\S]*?<\/Rps>/i
    );

    if (!match) {
      return null;
    }

    const id = match[1]?.trim();
    const xml = match[0];

    if (!id || !xml) {
      return null;
    }

    return {
      id,
      xml: this.canonicalizeXml(xml),
    };
  }

  private extractCertificateCredentials(
    certificateBuffer: Buffer,
    password: string
  ): {
    privateKeyPem: string;
    certificateBase64: string;
  } {
    const p12Asn1 = forge.asn1.fromDer(certificateBuffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

    const privateKeyBagType = forge.pki.oids.pkcs8ShroudedKeyBag;
    const keyBagType = forge.pki.oids.keyBag;
    const certBagType = forge.pki.oids.certBag;

    const privateKeyBags = (p12.getBags({ bagType: privateKeyBagType })[
      privateKeyBagType
    ] || []) as ForgeKeyBagLike[];
    const keyBags = (p12.getBags({ bagType: keyBagType })[keyBagType] ||
      []) as ForgeKeyBagLike[];
    const certBags = (p12.getBags({ bagType: certBagType })[certBagType] ||
      []) as ForgeCertBagLike[];

    const privateKey = privateKeyBags[0]?.key || keyBags[0]?.key;
    const certificateCandidates = certBags
      .map((bag: ForgeCertBagLike) => bag.cert)
      .filter((cert): cert is ForgeCertificateLike => !!cert);

    const cert =
      certificateCandidates.find((candidate: ForgeCertificateLike) =>
        this.certificateMatchesPrivateKey(candidate, privateKey)
      ) || certificateCandidates[0];

    if (!privateKey || !cert) {
      throw new Error(
        'Não foi possível extrair chave privada e certificado do arquivo PFX/P12.'
      );
    }

    const privateKeyPem = forge.pki.privateKeyToPem(privateKey as any);
    const certAsn1 = forge.pki.certificateToAsn1(cert as any);
    const certDer = forge.asn1.toDer(certAsn1).getBytes();
    const certificateBase64 = forge.util.encode64(certDer);

    return {
      privateKeyPem,
      certificateBase64,
    };
  }

  private certificateMatchesPrivateKey(
    cert: ForgeCertificateLike | undefined,
    privateKey: ForgePrivateKeyLike | undefined
  ): boolean {
    if (!cert || !privateKey) {
      return false;
    }

    const certPublicKey = cert.publicKey;
    if (
      !certPublicKey?.n ||
      !certPublicKey?.e ||
      !privateKey?.n ||
      !privateKey?.e
    ) {
      return false;
    }

    try {
      return (
        certPublicKey.n.compareTo(privateKey.n) === 0 &&
        certPublicKey.e.compareTo(privateKey.e) === 0
      );
    } catch {
      return false;
    }
  }

  private signWithPrivateKey(data: string, privateKeyPem: string): string {
    const signer = createSign('RSA-SHA1');
    signer.update(data, 'utf8');
    signer.end();
    return signer.sign(privateKeyPem, 'base64');
  }

  private async callCenti(input: {
    baseUrl: string;
    uf: string;
    tenant: string;
    usuario: string;
    senha: string;
    xml: string;
  }): Promise<NfseCentiHttpResponse> {
    const base = input.baseUrl.replace(/\/+$/, '');
    const url = `${base}/nfe/gerar/${encodeURIComponent(input.uf.toLowerCase())}/${encodeURIComponent(input.tenant)}`;

    const response = await axios.post(
      url,
      {
        xml: input.xml,
        usuario: input.usuario,
        senha: input.senha,
      },
      {
        timeout: 30000,
        responseType: 'text',
        transformResponse: [(value) => value as string],
        validateStatus: () => true,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, application/xml, text/xml',
        },
      }
    );

    const contentTypeHeader = response.headers['content-type'];
    const contentType = Array.isArray(contentTypeHeader)
      ? contentTypeHeader[0]
      : contentTypeHeader || null;

    const body =
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data || {});

    return {
      status: response.status,
      body,
      contentType,
    };
  }

  private parseCentiResponse(
    response: NfseCentiHttpResponse
  ): NfseCentiParsedResponse {
    const body = (response.body || '').trim();

    if (response.status >= 400) {
      const messages = this.extractErrorMessages(body);
      return {
        kind: 'explicit_failure',
        reason: `CENTI_HTTP_${response.status}`,
        messages:
          messages.length > 0
            ? messages
            : [`Erro HTTP ${response.status} ao emitir NFSe via Centi.`],
        rawBody: body,
      };
    }

    if (!body) {
      return {
        kind: 'ambiguous',
        reason: 'CENTI_EMPTY_RESPONSE',
        messages: ['Resposta vazia da Centi.'],
        rawBody: body,
      };
    }

    if (this.isJsonContent(response.contentType, body)) {
      const messages = this.extractErrorMessages(body);
      if (messages.length > 0) {
        return {
          kind: 'explicit_failure',
          reason: 'CENTI_JSON_ERROR',
          messages,
          rawBody: body,
        };
      }

      return {
        kind: 'ambiguous',
        reason: 'CENTI_JSON_AMBIGUOUS_RESPONSE',
        messages: ['Resposta JSON inesperada da Centi.'],
        rawBody: body,
      };
    }

    if (this.isXmlContent(response.contentType, body)) {
      const hasCompNfse = /<(?:\w+:)?CompNfse\b/i.test(body);
      const messages = this.extractXmlMessages(body);

      if (hasCompNfse) {
        const infNfse = this.extractFirstTagBlock(body, 'InfNfse');
        const identificacaoRps = this.extractFirstTagBlock(
          body,
          'IdentificacaoRps'
        );

        return {
          kind: 'success',
          number: this.extractFirstTagValue(infNfse || body, 'Numero'),
          validationCode: this.extractFirstTagValue(
            infNfse || body,
            'CodigoVerificacao'
          ),
          rpsSerie: this.extractFirstTagValue(
            identificacaoRps || body,
            'Serie'
          ),
          rpsNumber: this.extractFirstTagValue(
            identificacaoRps || body,
            'Numero'
          ),
          messages,
          rawBody: body,
        };
      }

      if (messages.length > 0) {
        return {
          kind: 'explicit_failure',
          reason: 'CENTI_XML_ERROR',
          messages,
          rawBody: body,
        };
      }

      return {
        kind: 'ambiguous',
        reason: 'CENTI_XML_AMBIGUOUS_RESPONSE',
        messages: ['Resposta XML ambígua da Centi.'],
        rawBody: body,
      };
    }

    if (this.looksLikeErrorText(body)) {
      return {
        kind: 'explicit_failure',
        reason: 'CENTI_PLAIN_TEXT_ERROR',
        messages: [body],
        rawBody: body,
      };
    }

    return {
      kind: 'ambiguous',
      reason: 'CENTI_UNKNOWN_RESPONSE_FORMAT',
      messages: ['Formato de resposta desconhecido da Centi.'],
      rawBody: body,
    };
  }

  private mapParsedFailureToEmissionResult(
    parsed: Exclude<NfseCentiParsedResponse, { kind: 'success' }>
  ): Exclude<NfseCentiEmissionResult, { kind: 'success' }> {
    return {
      kind: parsed.kind,
      reason: parsed.reason,
      messages: parsed.messages,
      rawResponse: parsed.rawBody,
    };
  }

  private buildInvoiceResponse(input: {
    input: NfseCentiEmissionInput;
    generatedRpsNumber: string;
    parsed: Extract<NfseCentiParsedResponse, { kind: 'success' }>;
    statusDescription: string;
  }): IGetAsaasInvoiceResponse {
    const reference = this.buildReferenceId(
      input.input.accountPaymentId,
      input.parsed.number,
      input.generatedRpsNumber
    );

    const request = input.input.invoiceRequest;

    return {
      object: 'invoice',
      id: reference,
      status: 'AUTHORIZED',
      customer: input.input.userCustomer,
      payment: input.input.paymentAsaasId,
      type: 'NFS-e',
      statusDescription: input.statusDescription,
      serviceDescription: request.serviceDescription,
      pdfUrl: null,
      xmlUrl: null,
      rpsSerie:
        input.parsed.rpsSerie || input.input.nfseConfig.integration_rps_series,
      rpsNumber: input.parsed.rpsNumber || input.generatedRpsNumber,
      number: input.parsed.number,
      validationCode: input.parsed.validationCode,
      value: request.value,
      deductions: request.deductions,
      effectiveDate: request.effectiveDate,
      observations: request.observations,
      taxes: request.taxes,
      municipalServiceId: request.municipalServiceId,
      municipalServiceCode: request.municipalServiceCode,
      municipalServiceName: request.municipalServiceName,
      externalReference: null,
      installment: null,
      estimatedTaxesDescription: null,
    };
  }

  private buildReferenceId(
    accountPaymentId: string,
    nfseNumber: string | null,
    generatedRpsNumber: string
  ): string {
    const cleanedPaymentId = accountPaymentId.replaceAll('-', '').slice(0, 20);
    const cleanedNfse = this.onlyDigits(nfseNumber || '').slice(0, 12);
    const cleanedRps = this.onlyDigits(generatedRpsNumber).slice(0, 12);
    return `centi-${cleanedPaymentId}-${cleanedNfse || cleanedRps}`;
  }

  private formatMoney(value: number): string {
    if (!Number.isFinite(value)) {
      return '0.00';
    }
    return Number(value).toFixed(2);
  }

  private formatAliquota(value: number): string {
    if (!Number.isFinite(value)) {
      return '0.0000';
    }
    return Number(value).toFixed(4);
  }

  private buildIssueDate(effectiveDate: string): string {
    if (/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      return `${effectiveDate}T12:00:00-03:00`;
    }

    return new Date().toISOString();
  }

  private normalizeItemListaServico(
    municipalServiceCode: string | null
  ): string | null {
    if (!municipalServiceCode) {
      return null;
    }

    const sanitized = municipalServiceCode.trim();
    if (!sanitized) {
      return null;
    }

    return sanitized.slice(0, 5);
  }

  private sanitizeText(value: string, maxLength: number): string {
    return value
      .replaceAll(/\s+/g, ' ')
      .replaceAll(/[\u0000-\u001F\u007F]/g, '')
      .trim()
      .slice(0, maxLength);
  }

  private escapeXml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  }

  private onlyDigits(value: string): string {
    return value.replaceAll(/\D/g, '');
  }

  private canonicalizeXml(xml: string): string {
    return xml.replaceAll(/>\s+</g, '><').trim();
  }

  private sha1Base64(value: string): string {
    return createHash('sha1').update(value, 'utf8').digest('base64');
  }

  private extractErrorMessages(body: string): string[] {
    if (!body) {
      return [];
    }

    const parsedJson = this.tryParseJson(body);
    if (parsedJson !== null) {
      return this.extractMessagesFromUnknown(parsedJson);
    }

    return this.extractMessagesFromString(body);
  }

  private tryParseJson(value: string): unknown | null {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  private extractMessagesFromUnknown(payload: unknown): string[] {
    if (typeof payload === 'string') {
      return this.extractMessagesFromString(payload);
    }

    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const messages = this.extractMessagesFromJson(
        payload as Record<string, unknown>
      );
      if (messages.length > 0) {
        return messages;
      }
    }

    if (Array.isArray(payload)) {
      const nestedMessages = payload.flatMap((value) =>
        this.extractMessagesFromUnknown(value)
      );
      return Array.from(new Set(nestedMessages));
    }

    return [];
  }

  private extractMessagesFromString(rawValue: string): string[] {
    const value = rawValue.trim();
    if (!value) {
      return [];
    }

    const nestedJson = this.tryParseJson(value);
    if (nestedJson !== null) {
      const nestedMessages = this.extractMessagesFromUnknown(nestedJson);
      if (nestedMessages.length > 0) {
        return nestedMessages;
      }
    }

    if (this.isXmlContent(null, value)) {
      const messages = this.extractXmlMessages(value);
      if (messages.length > 0) {
        return messages;
      }
    }

    if (this.looksLikeErrorText(value)) {
      return [value];
    }

    return [];
  }

  private extractMessagesFromJson(payload: Record<string, unknown>): string[] {
    const messages: string[] = [];

    const message = payload.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      const normalizedMessage = message.trim();
      const parsedMessages = this.extractMessagesFromString(normalizedMessage);
      if (parsedMessages.length > 0) {
        messages.push(...parsedMessages);
      } else {
        messages.push(normalizedMessage);
      }
    }

    const mensagem = payload.mensagem;
    if (typeof mensagem === 'string' && mensagem.trim().length > 0) {
      const normalizedMessage = mensagem.trim();
      const parsedMessages = this.extractMessagesFromString(normalizedMessage);
      if (parsedMessages.length > 0) {
        messages.push(...parsedMessages);
      } else {
        messages.push(normalizedMessage);
      }
    }

    const errors = payload.errors;
    if (errors && typeof errors === 'object') {
      const errorMessages = Object.values(errors)
        .flatMap((value) => (Array.isArray(value) ? value : []))
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.trim().length > 0
        )
        .flatMap((value) => {
          const normalizedMessage = value.trim();
          const parsedMessages =
            this.extractMessagesFromString(normalizedMessage);
          if (parsedMessages.length > 0) {
            return parsedMessages;
          }
          return [normalizedMessage];
        });

      messages.push(...errorMessages);
    }

    return Array.from(new Set(messages));
  }

  private extractXmlMessages(xml: string): string[] {
    const blocks = this.extractTagBlocks(xml, 'MensagemRetorno');
    if (blocks.length === 0) {
      return [];
    }

    const messages = blocks
      .map((block) => {
        const code = this.extractFirstTagValue(block, 'Codigo');
        const message = this.extractFirstTagValue(block, 'Mensagem');
        const correction = this.extractFirstTagValue(block, 'Correcao');

        const parts = [code, message, correction].filter(
          (value): value is string => !!value && value.trim().length > 0
        );

        return parts.join(' - ').trim();
      })
      .filter((value) => value.length > 0);

    return Array.from(new Set(messages));
  }

  private extractFirstTagBlock(xml: string, tagName: string): string | null {
    const regex = new RegExp(
      `<(?:\\w+:)?${tagName}\\b[^>]*>[\\s\\S]*?<\\/(?:\\w+:)?${tagName}>`,
      'i'
    );

    return xml.match(regex)?.[0] || null;
  }

  private extractTagBlocks(xml: string, tagName: string): string[] {
    const regex = new RegExp(
      `<(?:\\w+:)?${tagName}\\b[^>]*>[\\s\\S]*?<\\/(?:\\w+:)?${tagName}>`,
      'gi'
    );

    return Array.from(xml.matchAll(regex)).map((match) => match[0]);
  }

  private extractFirstTagValue(xml: string, tagName: string): string | null {
    const regex = new RegExp(
      `<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`,
      'i'
    );

    const value = xml.match(regex)?.[1];
    if (!value) {
      return null;
    }

    return this.decodeXmlEntities(value.trim());
  }

  private decodeXmlEntities(value: string): string {
    return value
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&amp;', '&');
  }

  private isJsonContent(contentType: string | null, body: string): boolean {
    if (contentType?.includes('application/json')) {
      return true;
    }

    if (body.startsWith('{') || body.startsWith('[') || body.startsWith('"')) {
      return true;
    }

    return this.tryParseJson(body) !== null;
  }

  private isXmlContent(contentType: string | null, body: string): boolean {
    if (contentType?.includes('xml')) {
      return true;
    }

    return body.startsWith('<');
  }

  private looksLikeErrorText(value: string): boolean {
    return /(erro|error|falha|inv[áa]lid|invalid|unauthoriz|n[ãa]o autorizado)/i.test(
      value
    );
  }
}
