'use strict';

// Lê uma aba de um .xlsx como tabela de textos (string[][]), sem biblioteca: o
// .xlsx é um ZIP de XMLs; o ZIP é lido à mão e o DEFLATE fica com o
// DecompressionStream do Chrome. Usado pelo "Inserir vídeos do Studio" para a
// planilha. Fica em window.__svcXlsx.readSheet(arrayBuffer) → Promise.
window.__svcXlsx = (() => {
  async function unzip(buf) {
    const v = new DataView(buf);
    // Fim do diretório central: assinatura 0x06054b50, nos últimos ~64 KB.
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('o arquivo não é um .xlsx válido');
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const entries = new Map();
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const method = v.getUint16(p + 10, true);
      const csize  = v.getUint32(p + 20, true);
      const nlen   = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
      const local  = v.getUint32(p + 42, true);
      const name   = dec.decode(new Uint8Array(buf, p + 46, nlen));
      entries.set(name, { method, csize, local });
      p += 46 + nlen + xlen + clen;
    }
    return async name => {
      const e = entries.get(name);
      if (!e) return null;
      const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
      const data  = new Uint8Array(buf, start, e.csize);
      if (e.method === 0) return dec.decode(data);
      if (e.method !== 8) throw new Error('compactação do .xlsx não suportada');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    };
  }

  const xml  = s => new DOMParser().parseFromString(s, 'application/xml');
  const all  = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];
  // Texto de um <si>/<is>: junta os <t>, menos os da leitura fonética (<rPh>).
  const text = node => all(node, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join('');
  const col  = ref => [...ref.replace(/\d+$/, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

  // Aba que estava aberta quando o arquivo foi salvo; se ela estiver vazia, a
  // primeira aba com conteúdo.
  async function readSheet(buf) {
    const read = await unzip(buf);
    const wb   = xml(await read('xl/workbook.xml') || '<x/>');
    const sheets = all(wb, 'sheet');
    if (!sheets.length) throw new Error('o .xlsx não tem nenhuma aba');
    const rels = xml(await read('xl/_rels/workbook.xml.rels') || '<x/>');
    const ssXml  = await read('xl/sharedStrings.xml');
    const shared = ssXml ? all(xml(ssXml), 'si').map(text) : [];

    const active = parseInt(all(wb, 'workbookView')[0]?.getAttribute('activeTab') || '0', 10) || 0;
    const order  = [active, ...sheets.keys()].filter((i, k, a) => i < sheets.length && a.indexOf(i) === k);
    for (const i of order) {
      const rows = await sheetRows(read, rels, shared, sheets[i]);
      if (rows.some(r => r.some(c => String(c).trim()))) return rows;
    }
    return [];
  }

  async function sheetRows(read, rels, shared, sheet) {
    const rid = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet.getAttribute('r:id');
    const rel = all(rels, 'Relationship').find(r => r.getAttribute('Id') === rid);
    if (!rel) return [];
    const t  = rel.getAttribute('Target');
    const ws = await read(t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, ''));
    if (!ws) return [];

    const rows = [];
    for (const r of all(xml(ws), 'row')) {
      const ri  = (parseInt(r.getAttribute('r'), 10) || rows.length + 1) - 1;
      const out = rows[ri] = [];
      for (const c of all(r, 'c')) {
        const ref = c.getAttribute('r');
        const ci  = ref ? col(ref) : out.length;
        const t   = c.getAttribute('t');
        const val = all(c, 'v')[0]?.textContent ?? '';
        out[ci] = t === 's' ? (shared[+val] ?? '') : t === 'inlineStr' ? text(all(c, 'is')[0] || c) : t === 'b' ? (val === '1' ? 'VERDADEIRO' : 'FALSO') : val;
      }
    }
    return Array.from(rows, r => Array.from(r || [], x => x ?? ''));
  }

  return { readSheet };
})();
