import { ICreateContact } from '@core/common/interfaces/ICreateContact';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { injectable } from 'tsyringe';

@injectable()
export class CsvFileReaderService {
  async read(file: UploadFileRequest): Promise<ICreateContact[]> {
    const buf = await file.toBuffer();
    const text = buf.toString('utf8').trim();

    const isVcard =
      /^BEGIN:VCARD/i.test(text) ||
      ['vcf', 'vcard'].includes(this._ext(file.filename));

    if (isVcard) return this._parseVcard(text);
    return this._parseCsv(text);
  }

  private _parseCsv(content: string): ICreateContact[] {
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (!lines.length) return [];

    const sep =
      (lines[0].match(/;/g)?.length || 0) > (lines[0].match(/,/g)?.length || 0)
        ? ';'
        : ',';

    const header = this._splitCsvLine(lines[0], sep).map((h) =>
      h.trim().toLowerCase()
    );
    const idx = {
      nome: header.findIndex((h) =>
        ['nome', 'first name', 'given name'].includes(h)
      ),
      sobrenome: header.findIndex((h) =>
        ['sobrenome', 'last name', 'family name'].includes(h)
      ),
      email: header.findIndex((h) => ['e-mail', 'email'].includes(h)),
      telefone: header.findIndex((h) => ['telefone', 'phone'].includes(h)),
      apelido: header.findIndex((h) => ['apelido', 'nickname'].includes(h)),
      aniversario: header.findIndex((h) =>
        ['aniversário', 'aniversario', 'birthday'].includes(h)
      ),
      notas: header.findIndex((h) => ['notas', 'notes'].includes(h)),
    };

    const out: ICreateContact[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = this._splitCsvLine(lines[i], sep);

      const first = this._val(cols, idx.nome);
      const last = this._val(cols, idx.sobrenome);

      if (
        !first &&
        !last &&
        !this._val(cols, idx.email) &&
        !this._val(cols, idx.telefone)
      )
        continue;

      out.push({
        name: first,
        last_name: last,
        email: this._toNull(this._val(cols, idx.email)),
        phone: this._toNull(this._val(cols, idx.telefone)),
        nickname: this._toNull(this._val(cols, idx.apelido)),
        birthday: this._normDate(this._val(cols, idx.aniversario)),
        notes: this._toNull(this._val(cols, idx.notas)),
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
        } else {
          inQ = !inQ;
        }
      } else if (!inQ && ch === sep) {
        res.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }

    res.push(cur);
    return res.map((s) => s?.trim() ?? '');
  }

  private _parseVcard(content: string): ICreateContact[] {
    const lines = this._unfold(content.split(/\r?\n/));
    const cards: string[][] = [];
    let cur: string[] = [];

    for (const l of lines) {
      if (/^BEGIN:VCARD/i.test(l)) cur = [];
      else if (/^END:VCARD/i.test(l)) (cards.push(cur), (cur = []));
      else if (cur) cur.push(l);
    }

    const out: ICreateContact[] = [];
    for (const raw of cards) {
      const map = this._vmap(raw);

      const n = map.get('N')?.[0] ?? '';
      const parts = n.split(';');
      const last = (parts[0] ?? '').trim();
      const first = (parts[1] ?? '').trim();

      const fn = map.get('FN')?.[0]?.trim();
      const firstFallback = first || fn?.split(' ')?.[0] || '';
      const lastFallback = last || (fn ? fn.split(' ').slice(1).join(' ') : '');

      const email = this._firstOf(map, 'EMAIL');
      const tel = this._firstOf(map, 'TEL');

      out.push({
        name: firstFallback,
        last_name: lastFallback,
        email: this._toNull(email),
        phone: this._toNull(tel),
        nickname: this._toNull(map.get('NICKNAME')?.[0]),
        birthday: this._normDate(map.get('BDAY')?.[0]),
        notes: this._toNull(map.get('NOTE')?.[0]),
      });
    }
    return out;
  }

  private _unfold(lines: string[]): string[] {
    const out: string[] = [];
    for (const l of lines) {
      if (/^[ \t]/.test(l) && out.length) out[out.length - 1] += l.slice(1);
      else out.push(l.trim());
    }
    return out;
  }

  private _vmap(lines: string[]): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const l of lines) {
      const i = l.indexOf(':');
      if (i === -1) continue;
      const key = l.slice(0, i).split(';')[0].toUpperCase();
      const val = l.slice(i + 1);
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
    return cols[idx] ?? '';
  }

  private _toNull(v?: string) {
    const s = (v ?? '').trim();
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
