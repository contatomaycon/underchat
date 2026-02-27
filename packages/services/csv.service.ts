import { ICreateContact } from '@core/common/interfaces/ICreateContact';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { injectable, inject } from 'tsyringe';
import { PasswordEncryptorService } from './passwordEncryptor.service';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import { validateCpf } from '@core/common/functions/validateCpf';
import { validateCnpj } from '@core/common/functions/validateCnpj';
import { EContactDocumentType } from '@core/common/enums/EContactDocumentType';
import { repairMojibakeIfSafe } from '@core/common/functions/repairMojibake';
import { TextDecoder } from 'node:util';

@injectable()
export class CsvFileReaderService {
  private readonly replacementCharacter = '\uFFFD';

  constructor(
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  private isEncrypted(value: string | null | undefined): boolean {
    if (!value || typeof value !== 'string') return false;
    const parts = value.split(':');
    return parts.length === 3;
  }

  private tryDecrypt(value: string): string | null {
    try {
      return this.passwordEncryptorService.decrypt(value);
    } catch {
      return null;
    }
  }

  private processEmail(email: string | null | undefined): string | null {
    if (!email) return null;
    const trimmed = email.trim();
    if (!trimmed) return null;

    if (this.isEncrypted(trimmed)) {
      const decrypted = this.tryDecrypt(trimmed);
      if (decrypted) {
        return decrypted;
      }
    }

    return trimmed;
  }

  private processPhone(phone: string | null | undefined): string | null {
    if (!phone) return null;
    const trimmed = phone.trim();
    if (!trimmed) return null;

    if (this.isEncrypted(trimmed)) {
      const decrypted = this.tryDecrypt(trimmed);
      if (decrypted) {
        return decrypted;
      }
    }

    return trimmed;
  }

  private decodeAsWindows1252(buffer: Buffer): string | null {
    try {
      const decoder = new TextDecoder('windows-1252');
      return decoder.decode(buffer);
    } catch {
      return null;
    }
  }

  private decodeBufferToText(buffer: Buffer): string {
    const utf8Decoded = buffer.toString('utf8');

    if (!utf8Decoded.includes(this.replacementCharacter)) {
      return utf8Decoded;
    }

    const windows1252Decoded = this.decodeAsWindows1252(buffer);

    if (
      windows1252Decoded &&
      !windows1252Decoded.includes(this.replacementCharacter)
    ) {
      return windows1252Decoded;
    }

    return buffer.toString('latin1');
  }

  private sanitizeImportedText(value: string): string {
    const repaired = repairMojibakeIfSafe(value);

    if (typeof repaired !== 'string') {
      return value;
    }

    return repaired;
  }

  async read(file: UploadFileRequest): Promise<ICreateContact[]> {
    const buf = await file.toBuffer();
    const text = this.decodeBufferToText(buf).trim();

    const isVcard =
      /^BEGIN:VCARD/i.test(text) ||
      ['vcf', 'vcard'].includes(this._ext(file.filename));

    if (isVcard) return this._parseVcard(text);
    return this._parseCsv(text);
  }

  private _detectSeparator(firstLine: string): ',' | ';' {
    const semicolonCount = firstLine.match(/;/g)?.length || 0;
    const commaCount = firstLine.match(/,/g)?.length || 0;
    return semicolonCount > commaCount ? ';' : ',';
  }

  private _findColumnIndices(
    header: string[],
    namesInOrder: string[]
  ): number[] {
    const indices: number[] = [];
    const seen = new Set<number>();
    for (const name of namesInOrder) {
      const i = header.indexOf(name);
      if (i >= 0 && !seen.has(i)) {
        indices.push(i);
        seen.add(i);
      }
    }
    return indices;
  }

  private _firstNonEmpty(cols: string[], indices: number[]): string {
    for (const i of indices) {
      const v = (cols[i] ?? '').trim();
      if (v) return v;
    }
    return '';
  }

  private _splitFullName(full: string): { first: string; last: string } {
    const s = full.trim();
    if (!s) return { first: '', last: '' };
    const space = s.indexOf(' ');
    if (space <= 0) return { first: s, last: '' };
    return {
      first: s.slice(0, space).trim(),
      last: s.slice(space).trim(),
    };
  }

  private _buildColumnIndexes(header: string[]) {
    const nomeNames = ['given name', 'first name', 'nome', 'first name (yomi)'];
    const sobrenomeNames = [
      'family name',
      'last name',
      'sobrenome',
      'family name (yomi)',
    ];
    const nameFullNames = ['name'];
    const emailNames = [
      'e-mail 1 - value',
      'e-mail 2 - value',
      'e-mail 3 - value',
      'email address',
      'e-mail',
      'email',
    ];
    const telefoneNames = [
      'phone 1 - value',
      'phone 2 - value',
      'phone 3 - value',
      'mobile phone',
      'business phone',
      'home phone',
      'home phone 2',
      'primary phone',
      'telefone',
      'phone',
    ];
    const ddiNames = [
      'ddi',
      'phone_ddi',
      'phone ddi',
      'código país',
      'codigo pais',
      'country code',
    ];
    const apelidoNames = ['nickname', 'apelido', 'short name'];
    const documentoNames = ['documento', 'document'];
    const aniversarioNames = ['birthday', 'aniversário', 'aniversario'];
    const notasNames = ['notes', 'notas'];
    const labelNames = [
      'label',
      'etiqueta',
      'labels',
      'etiquetas',
      'tag',
      'tags',
    ];

    const nome =
      this._findColumnIndices(header, nomeNames)[0] ??
      header.findIndex((h) => nomeNames.includes(h));
    const sobrenome =
      this._findColumnIndices(header, sobrenomeNames)[0] ??
      header.findIndex((h) => sobrenomeNames.includes(h));
    const nameFull =
      this._findColumnIndices(header, nameFullNames)[0] ??
      header.findIndex((h) => nameFullNames.includes(h));
    const emailIndices = this._findColumnIndices(header, emailNames);
    if (emailIndices.length === 0) {
      emailIndices.push(
        header.findIndex((h) => ['e-mail', 'email'].includes(h))
      );
    }
    const telefoneIndices = this._findColumnIndices(header, telefoneNames);
    if (telefoneIndices.length === 0) {
      telefoneIndices.push(
        header.findIndex((h) => ['telefone', 'phone'].includes(h))
      );
    }
    const ddi = header.findIndex((h) => ddiNames.includes(h));
    const apelido = header.findIndex((h) => apelidoNames.includes(h));
    const documento = header.findIndex((h) => documentoNames.includes(h));
    const aniversario = header.findIndex((h) => aniversarioNames.includes(h));
    const notas = header.findIndex((h) => notasNames.includes(h));
    const label = header.findIndex((h) => labelNames.includes(h));

    return {
      nome: nome >= 0 ? nome : -1,
      sobrenome: sobrenome >= 0 ? sobrenome : -1,
      nameFull: nameFull >= 0 ? nameFull : -1,
      emailIndices: emailIndices.filter((i) => i >= 0),
      telefoneIndices: telefoneIndices.filter((i) => i >= 0),
      ddi,
      apelido,
      documento,
      aniversario,
      notas,
      label: label >= 0 ? label : -1,
    };
  }

  private _shouldSkipRow(
    cols: string[],
    idx: ReturnType<typeof this._buildColumnIndexes>
  ): boolean {
    const first =
      this._val(cols, idx.nome) ||
      (idx.nameFull >= 0
        ? this._splitFullName(cols[idx.nameFull] ?? '').first
        : '');
    const last =
      this._val(cols, idx.sobrenome) ||
      (idx.nameFull >= 0
        ? this._splitFullName(cols[idx.nameFull] ?? '').last
        : '');
    const email = this._firstNonEmpty(cols, idx.emailIndices);
    const phone = this._firstNonEmpty(cols, idx.telefoneIndices);

    return !first && !last && !email && !phone;
  }

  private _determinePhoneDdi(
    ddiRaw: string,
    normalizedPhone: ReturnType<typeof extractPhoneAndDdi> | null
  ): string {
    const trimmedDdi = ddiRaw?.trim();
    if (trimmedDdi) {
      return trimmedDdi;
    }
    if (normalizedPhone) {
      return normalizedPhone.phone_ddi;
    }
    return '55';
  }

  private _validateAndGetDocumentType(document: string | null | undefined): {
    document: string | null;
    contact_document_type_id: string | null;
  } {
    if (!document) {
      return { document: null, contact_document_type_id: null };
    }

    const trimmed = document.trim();
    if (!trimmed) {
      return { document: null, contact_document_type_id: null };
    }

    const digitsOnly = trimmed.replaceAll(/\D/g, '');

    if (!digitsOnly) {
      return { document: null, contact_document_type_id: null };
    }

    if (validateCpf(trimmed)) {
      return {
        document: digitsOnly,
        contact_document_type_id: EContactDocumentType.cpf,
      };
    }

    if (validateCnpj(trimmed)) {
      return {
        document: digitsOnly,
        contact_document_type_id: EContactDocumentType.cnpj,
      };
    }

    if (digitsOnly.length >= 12 && digitsOnly.length < 14) {
      const padded = digitsOnly.padStart(14, '0');
      if (validateCnpj(padded)) {
        return {
          document: padded,
          contact_document_type_id: EContactDocumentType.cnpj,
        };
      }
    }

    return { document: digitsOnly, contact_document_type_id: null };
  }

  private _parseCsv(content: string): ICreateContact[] {
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (!lines.length) return [];

    const sep = this._detectSeparator(lines[0]);
    const header = this._splitCsvLine(lines[0], sep).map((h) =>
      h.trim().toLowerCase()
    );
    const idx = this._buildColumnIndexes(header);

    const out: ICreateContact[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = this._splitCsvLine(lines[i], sep);

      if (this._shouldSkipRow(cols, idx)) continue;

      const emailRaw = this._firstNonEmpty(cols, idx.emailIndices);
      const ddiRaw = this._val(cols, idx.ddi);
      const phoneRaw = this._firstNonEmpty(cols, idx.telefoneIndices);

      const processedEmail = this.processEmail(emailRaw);
      const processedPhone = this.processPhone(phoneRaw);

      const fullPhone = `${ddiRaw ?? '55'}${processedPhone}`;
      const normalizedPhone = fullPhone ? extractPhoneAndDdi(fullPhone) : null;

      const phoneDdi = this._determinePhoneDdi(ddiRaw, normalizedPhone);

      const documentRaw = this._val(cols, idx.documento);
      const { document, contact_document_type_id } =
        this._validateAndGetDocumentType(documentRaw);

      const nameFromCols = this._val(cols, idx.nome);
      const lastFromCols = this._val(cols, idx.sobrenome);
      const fullName =
        idx.nameFull >= 0 ? (cols[idx.nameFull] ?? '').trim() : '';
      const { first: nameFromFull, last: lastFromFull } =
        this._splitFullName(fullName);
      const name = nameFromCols || nameFromFull;
      const last_name = lastFromCols || lastFromFull;

      const labelValue = idx.label >= 0 ? this._val(cols, idx.label) : null;
      const label = labelValue ? labelValue.trim() : null;

      out.push({
        name,
        last_name,
        email: processedEmail,
        phone: normalizedPhone ? normalizedPhone.phone : processedPhone,
        phone_ddi: phoneDdi,
        nickname: this._toNull(this._val(cols, idx.apelido)),
        document: document ?? null,
        contact_document_type_id,
        birthday: this._normDate(this._val(cols, idx.aniversario)),
        notes: this._toNull(this._val(cols, idx.notas)),
        label: label || null,
      });
    }
    return out;
  }

  private _splitCsvLine(line: string, sep: ',' | ';'): string[] {
    const res: string[] = [];
    let cur = '';
    let inQ = false;
    let skipNext = false;

    for (let i = 0; i < line.length; i++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }

      const ch = line[i];

      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          skipNext = true;
          continue;
        }
        inQ = !inQ;
        continue;
      }

      if (!inQ && ch === sep) {
        res.push(cur);
        cur = '';
        continue;
      }

      cur += ch;
    }

    res.push(cur);
    return res.map((s) => this.sanitizeImportedText(s?.trim() ?? ''));
  }

  private _parseVcardCards(lines: string[]): string[][] {
    const cards: string[][] = [];
    let cur: string[] = [];

    for (const l of lines) {
      if (/^BEGIN:VCARD/i.test(l)) {
        cur = [];
        continue;
      }

      if (/^END:VCARD/i.test(l)) {
        cards.push(cur);
        cur = [];
        continue;
      }

      if (cur) {
        cur.push(l);
      }
    }

    return cards;
  }

  private _extractNamesFromVcard(map: Map<string, string[]>): {
    first: string;
    last: string;
  } {
    const n = map.get('N')?.[0] ?? '';
    const parts = n.split(';');
    const last = (parts[0] ?? '').trim();
    const first = (parts[1] ?? '').trim();

    return { first, last };
  }

  private _buildNameFallbacks(
    first: string,
    last: string,
    fn: string | undefined
  ): { firstFallback: string; lastFallback: string } {
    const firstFallback = first || fn?.split(' ')?.[0] || '';

    let lastFallback = last;
    if (!lastFallback && fn) {
      const fnParts = fn.split(' ');
      lastFallback = fnParts.slice(1).join(' ');
    }

    return { firstFallback, lastFallback };
  }

  private _processVcardContact(map: Map<string, string[]>): ICreateContact {
    const { first, last } = this._extractNamesFromVcard(map);
    const fn = map.get('FN')?.[0]?.trim();
    const { firstFallback, lastFallback } = this._buildNameFallbacks(
      first,
      last,
      fn
    );

    const email = this._firstOf(map, 'EMAIL');
    const tel = this._firstOf(map, 'TEL');

    const processedEmail = this.processEmail(email);
    const processedPhone = this.processPhone(tel);

    const normalizedPhone = processedPhone
      ? extractPhoneAndDdi(processedPhone)
      : null;

    const documentRaw = this._firstOf(map, 'X-DOCUMENT');
    const { document, contact_document_type_id } =
      this._validateAndGetDocumentType(documentRaw);

    return {
      name: firstFallback,
      last_name: lastFallback,
      email: processedEmail,
      phone: normalizedPhone ? normalizedPhone.phone : processedPhone,
      phone_ddi: normalizedPhone ? normalizedPhone.phone_ddi : null,
      nickname: this._toNull(map.get('NICKNAME')?.[0]),
      document: document ?? null,
      contact_document_type_id,
      birthday: this._normDate(map.get('BDAY')?.[0]),
      notes: this._toNull(map.get('NOTE')?.[0]),
    };
  }

  private _parseVcard(content: string): ICreateContact[] {
    const lines = this._unfold(content.split(/\r?\n/));
    const cards = this._parseVcardCards(lines);

    const out: ICreateContact[] = [];
    for (const raw of cards) {
      const map = this._vmap(raw);
      const contact = this._processVcardContact(map);
      out.push(contact);
    }
    return out;
  }

  private _unfold(lines: string[]): string[] {
    const out: string[] = [];
    for (const l of lines) {
      if (/^[ \t]/.test(l) && out.length) {
        out[out.length - 1] += l.slice(1);
        continue;
      }
      out.push(l.trim());
    }
    return out;
  }

  private _vmap(lines: string[]): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const l of lines) {
      const i = l.indexOf(':');
      if (i === -1) continue;
      const key = l.slice(0, i).split(';')[0].toUpperCase();
      const val = this.sanitizeImportedText(l.slice(i + 1));
      const arr = m.get(key) ?? [];
      arr.push(val);
      m.set(key, arr);
    }
    return m;
  }

  private _firstOf(
    map: Map<string, string[]>,
    key: string
  ): string | undefined {
    const vals = map.get(key);
    return vals?.[0];
  }

  private _ext(name: string) {
    const m = /\.([^./\\]+)$/.exec(name);
    return (m ? m[1] : '').toLowerCase();
  }

  private _val(cols: string[], idx: number) {
    if (idx < 0) return '';
    return this.sanitizeImportedText(cols[idx] ?? '');
  }

  private _toNull(v?: string) {
    const s = this.sanitizeImportedText(v ?? '').trim();
    return s || null;
  }

  private _normDate(v?: string | null): string | null {
    const s = (v ?? '').trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;

    m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;

    m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;

    return null;
  }
}
