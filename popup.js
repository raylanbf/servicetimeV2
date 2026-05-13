'use strict';

// ── Constantes ────────────────────────────────────────────────────────
const DEFAULT_TIPOS = [
  'Cards Deduca',
];

const APPS_SCRIPT =
`function doPost(e) {
  try {
    var dados = JSON.parse(e.postData.contents);
    var planilha = SpreadsheetApp.getActiveSpreadsheet();
    var aba = planilha.getSheets()[0];

    var NOVOS_CABECALHOS = ["Data (AP)", "Início (AP)", "Fim (AP)", "Duração (AP)", "Pausas (AP)", "URLs (AP)", "Comentário (AP)"];

    // Mapear cabeçalhos existentes (case-insensitive)
    var ultimaColuna = aba.getLastColumn();
    var headerRow = aba.getRange(1, 1, 1, ultimaColuna).getValues()[0];
    var colMap = {};
    for (var c = 0; c < headerRow.length; c++) {
      var h = String(headerRow[c]).trim().toLowerCase();
      if (h) colMap[h] = c + 1;
    }

    // Criar novos cabeçalhos se não existirem
    var proxCol = ultimaColuna + 1;
    for (var nc = 0; nc < NOVOS_CABECALHOS.length; nc++) {
      var chave = NOVOS_CABECALHOS[nc].toLowerCase();
      if (!colMap[chave]) {
        aba.getRange(1, proxCol).setValue(NOVOS_CABECALHOS[nc]).setFontWeight("bold");
        colMap[chave] = proxCol;
        proxCol++;
      }
    }

    // Coluna "Id da tarefa"
    var colIdTarefa = colMap["id da tarefa"];
    if (!colIdTarefa) throw new Error('Coluna "Id da tarefa" não encontrada na planilha');

    // Carregar IDs da coluna de uma vez
    var lastRow = aba.getLastRow();
    var idsArr = aba.getRange(2, colIdTarefa, lastRow - 1, 1).getValues();

    var registros = dados.registros || [];
    var editados = 0;
    var naoEncontrados = 0;

    for (var i = 0; i < registros.length; i++) {
      var r = registros[i];

      // Extrair task ID de qualquer URL (ex: ?task=61101 ou &task=61101)
      var taskId = null;
      var allUrls = [r.url || ""].concat(r.links || []);
      for (var u = 0; u < allUrls.length; u++) {
        var m = String(allUrls[u]).match(/[?&]task=(\\d+)/);
        if (m) { taskId = m[1]; break; }
      }
      if (!taskId) { naoEncontrados++; continue; }

      // Buscar linha pelo ID
      var rowIndex = -1;
      for (var row = 0; row < idsArr.length; row++) {
        if (String(idsArr[row][0]).trim() === taskId) {
          rowIndex = row + 2;
          break;
        }
      }
      if (rowIndex === -1) { naoEncontrados++; continue; }

      // Formatar pausas e URLs
      var pausas = (r.pausas || []).map(function(p) {
        return (p.pausa || "") + " → " + (p.retorno || "-");
      }).join("; ");
      var urls = allUrls.filter(Boolean).join("\\n");

      // Preencher colunas novas na linha encontrada
      aba.getRange(rowIndex, colMap["data (ap)"]).setValue(r.data || "");
      aba.getRange(rowIndex, colMap["início (ap)"]).setValue(r.inicio || "");
      aba.getRange(rowIndex, colMap["fim (ap)"]).setValue(r.fim || "");
      aba.getRange(rowIndex, colMap["duração (ap)"]).setValue(r.tempo_total || "");
      aba.getRange(rowIndex, colMap["pausas (ap)"]).setValue(pausas);
      aba.getRange(rowIndex, colMap["urls (ap)"]).setValue(urls);
      aba.getRange(rowIndex, colMap["comentário (ap)"]).setValue(r.comentario || "");

      editados++;
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok", editados: editados, nao_encontrados: naoEncontrados }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "erro", erro: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}`;

// ── Estado ────────────────────────────────────────────────────────────
let S = {};
let ticker = null;

// ── Helpers ───────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

async function persist(updates) {
  Object.assign(S, updates);
  await chrome.storage.local.set(updates);
}

function show(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-' + name).classList.add('active');
}

function elapsedMs() {
  if (!S.running) return 0;
  return S.paused ? S.accMs : S.accMs + (Date.now() - S.startTs);
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map(n => String(n).padStart(2, '0')).join(':');
}

function nowHMS()  { return new Date().toTimeString().slice(0, 8); }
function nowDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function startTick() {
  stopTick();
  ticker = setInterval(() => { $('timer').textContent = fmt(elapsedMs()); }, 1000);
}

function stopTick() {
  if (ticker) { clearInterval(ticker); ticker = null; }
}

function updateCount() {
  const pending = S.registros.filter(r => !r.enviado).length;
  $('count-label').textContent =
    `${S.registros.length} registro(s)` + (pending ? `  •  ${pending} pendente(s)` : '');
}

// ── Sincroniza UI com estado ──────────────────────────────────────────
function syncMain() {
  $('user-label').textContent = '👤  ' + S.usuario;

  const combo = $('combo-tipo');
  combo.innerHTML = '';
  S.tipos.forEach(t => {
    const o = document.createElement('option');
    o.textContent = t;
    combo.appendChild(o);
  });
  if (S.currentRecord) combo.value = S.currentRecord.tipo_servico;

  $('btn-start').disabled    = S.running;
  $('btn-pause').disabled    = !S.running;
  $('btn-stop').disabled     = !S.running;

  if (S.running && S.paused) {
    $('btn-pause').textContent  = '▶  Retomar';
    $('btn-pause').className    = 'btn btn-green';
    $('status').textContent     = '⏸ Pausado';
    $('status').style.color     = '#fbbf24';
    $('timer').style.color      = '#fbbf24';
  } else if (S.running) {
    $('btn-pause').textContent  = '⏸  Pausar';
    $('btn-pause').className    = 'btn btn-yellow';
    $('status').textContent     = '▶ Em andamento';
    $('status').style.color     = '#4ade80';
    $('timer').style.color      = '#4ade80';
  } else {
    $('btn-pause').textContent  = '⏸  Pausar';
    $('btn-pause').className    = 'btn btn-yellow';
    $('status').textContent     = 'Aguardando';
    $('status').style.color     = '#64748b';
    $('timer').style.color      = '#4ade80';
  }

  $('timer').textContent = fmt(elapsedMs());
  updateCount();

  const urlBox = $('url-box');
  if (S.running && S.currentRecord && S.currentRecord.url) {
    urlBox.style.display = 'block';
    const list = $('links-list');
    list.innerHTML = '';

    const startDiv = document.createElement('div');
    startDiv.className = 'link-item';
    startDiv.innerHTML = `<span class="link-text" title="${S.currentRecord.url}">${S.currentRecord.url}</span>`;
    list.appendChild(startDiv);

    (S.currentRecord.links || []).forEach((link, i) => {
      const div = document.createElement('div');
      div.className = 'link-item';
      div.innerHTML = `<span class="link-text" title="${link}">${link}</span><button class="btn-rm-link" data-i="${i}">✕</button>`;
      list.appendChild(div);
    });

    list.onclick = async e => {
      const btn = e.target.closest('.btn-rm-link');
      if (!btn) return;
      const i = +btn.dataset.i;
      const links = [...(S.currentRecord.links || [])];
      links.splice(i, 1);
      await persist({ currentRecord: { ...S.currentRecord, links } });
      syncMain();
    };
  } else {
    urlBox.style.display = 'none';
  }
}

// ── Links adicionais ──────────────────────────────────────────────
async function doAddLink() {
  if (!S.running || !S.currentRecord) return;
  const tabs = await chrome.tabs.query({active: true, currentWindow: true});
  const url = tabs[0]?.url;
  if (!url) return;
  const links = S.currentRecord.links || [];
  if (url === S.currentRecord.url || links.includes(url)) return;
  await persist({ currentRecord: { ...S.currentRecord, links: [...links, url] } });
  syncMain();
}

// ── Modal de comentário ───────────────────────────────────────────
function askComment() {
  return new Promise(resolve => {
    const modal = $('modal-comment');
    const input = $('comment-input');
    input.value = '';
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 50);

    function finish(value) {
      modal.style.display = 'none';
      document.removeEventListener('keydown', onKey);
      resolve(value || null);
    }

    function onKey(e) {
      if (e.key === 'Escape')                       finish(null);
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(input.value.trim());
    }

    $('btn-comment-save').onclick = () => finish(input.value.trim());
    $('btn-comment-skip').onclick = () => finish(null);
    document.addEventListener('keydown', onKey);
  });
}

// ── Ações do timer ────────────────────────────────────────────────────
async function doStart() {
  const tabs = await chrome.tabs.query({active: true, currentWindow: true});
  const url = tabs[0].url;

  const record = {
    usuario:              S.usuario,
    tipo_servico:         $('combo-tipo').value,
    data:                 nowDate(),
    inicio:               nowHMS(),
    pausas:               [],
    fim:                  null,
    tempo_total:          null,
    tempo_total_segundos: 0,
    enviado:              false,
    url:                  url,
    links:                [],
    comentario:           null,
  };
  await persist({ running: true, paused: false, startTs: Date.now(), accMs: 0, currentRecord: record });
  syncMain();
  startTick();
}

async function doPause() {
  if (!S.running) return;
  if (!S.paused) {
    const newAcc = S.accMs + (Date.now() - S.startTs);
    const rec    = { ...S.currentRecord, pausas: [...S.currentRecord.pausas, { pausa: nowHMS() }] };
    await persist({ paused: true, accMs: newAcc, startTs: null, currentRecord: rec });
    stopTick();
  } else {
    const pausas = S.currentRecord.pausas.map((p, i, arr) =>
      i === arr.length - 1 && !p.retorno ? { ...p, retorno: nowHMS() } : p);
    const rec = { ...S.currentRecord, pausas };
    await persist({ paused: false, startTs: Date.now(), currentRecord: rec });
    startTick();
  }
  syncMain();
}

async function doStop() {
  const ms    = elapsedMs();
  const sec   = Math.floor(ms / 1000);
  const dur   = [Math.floor(sec/3600), Math.floor((sec%3600)/60), sec%60]
    .map((n, i) => i === 0 ? String(n) : String(n).padStart(2,'0')).join(':');
  const fimHMS = nowHMS();

  stopTick();

  const pausas = S.currentRecord.pausas.map((p, i, arr) =>
    i === arr.length - 1 && !p.retorno ? { ...p, retorno: fimHMS } : p);

  const comentario = await askComment();

  const record    = { ...S.currentRecord, pausas, fim: fimHMS, tempo_total: dur, tempo_total_segundos: sec, comentario };
  const registros = [...S.registros, record];

  await persist({ running: false, paused: false, startTs: null, accMs: 0, currentRecord: null, registros });
  syncMain();

  alert(`Serviço finalizado!\n\nTipo: ${record.tipo_servico}\nDuração: ${dur}`);
}

// ── Google Sheets ─────────────────────────────────────────────────────
async function doUpload() {
  if (!S.webhook_url) {
    const url = prompt('Cole a URL do Web App (Google Apps Script):');
    if (!url) return;
    await persist({ webhook_url: url.trim() });
  }

  const pendentes = S.registros.filter(r => !r.enviado);
  if (!pendentes.length) { alert('Todos os registros já foram enviados.'); return; }

  try {
    const res = await fetch(S.webhook_url, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify({ usuario: S.usuario, registros: pendentes }),
    });
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.erro || 'Erro desconhecido');

    const registros = S.registros.map(r =>
      pendentes.find(p => p === r) ? { ...r, enviado: true } : r);
    await persist({ registros });
    updateCount();
    let msg = `${json.editados} linha(s) atualizada(s) na planilha.`;
    if (json.nao_encontrados) msg += `\n${json.nao_encontrados} registro(s) sem tarefa identificada.`;
    alert(msg);
  } catch (err) {
    alert('Erro ao enviar: ' + err.message);
  }
}

// ── Editor de serviços ────────────────────────────────────────────────
function buildEditTipos() {
  let editTipos = [...S.tipos];

  function render() {
    const list = $('tipos-list');
    list.innerHTML = '';
    editTipos.forEach((t, i) => {
      const div = document.createElement('div');
      div.className = 'tipo-item';
      div.innerHTML =
        `<span class="tipo-name">${t}</span>
         <div class="tipo-btns">
           <button data-a="up" data-i="${i}">↑</button>
           <button data-a="dn" data-i="${i}">↓</button>
           <button data-a="rm" data-i="${i}" class="rm-btn">✕</button>
         </div>`;
      list.appendChild(div);
    });
  }
  render();

  $('tipos-list').onclick = e => {
    const btn = e.target.closest('[data-a]');
    if (!btn) return;
    const i = +btn.dataset.i;
    if      (btn.dataset.a === 'up' && i > 0)                   [editTipos[i], editTipos[i-1]] = [editTipos[i-1], editTipos[i]];
    else if (btn.dataset.a === 'dn' && i < editTipos.length - 1) [editTipos[i], editTipos[i+1]] = [editTipos[i+1], editTipos[i]];
    else if (btn.dataset.a === 'rm' && editTipos.length > 1)      editTipos.splice(i, 1);
    render();
  };

  $('btn-add-tipo').onclick = () => {
    const inp = $('input-new-tipo');
    if (!inp.value.trim()) return;
    editTipos.push(inp.value.trim());
    inp.value = '';
    render();
  };
  $('input-new-tipo').onkeydown = e => { if (e.key === 'Enter') $('btn-add-tipo').click(); };

  $('btn-save-tipos').onclick = async () => {
    await persist({ tipos: editTipos });
    syncMain();
    show('main');
  };
  $('btn-back-tipos').onclick = () => show('main');
}

// ── Configurações ─────────────────────────────────────────────────────
function buildSettings() {
  $('settings-name').value    = S.usuario;
  $('settings-url').value     = S.webhook_url;
  $('settings-video-w').value = S.video_width;
  $('settings-video-h').value = S.video_height;

  $('btn-save-settings').onclick = async () => {
    const name = $('settings-name').value.trim();
    if (!name) return;
    const w = parseInt($('settings-video-w').value, 10) || 620;
    const h = parseInt($('settings-video-h').value, 10) || 398;
    await persist({ usuario: name, webhook_url: $('settings-url').value.trim(), video_width: w, video_height: h });
    $('user-label').textContent = '👤  ' + name;
    show('main');
  };
  $('btn-back-settings').onclick = () => show('main');
}

// ── Boot ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const saved = await chrome.storage.local.get(null);
  S = {
    usuario:       saved.usuario       || '',
    webhook_url:   saved.webhook_url   || '',
    tipos:         saved.tipos         || DEFAULT_TIPOS,
    running:       saved.running       || false,
    paused:        saved.paused        || false,
    startTs:       saved.startTs       || null,
    accMs:         saved.accMs         || 0,
    currentRecord: saved.currentRecord || null,
    registros:     saved.registros     || [],
    video_width:   saved.video_width   || 620,
    video_height:  saved.video_height  || 398,
  };

  // Bindings estáticos
  $('btn-start').addEventListener('click', doStart);
  $('btn-pause').addEventListener('click', doPause);
  $('btn-stop').addEventListener('click',  doStop);
  $('combo-tipo').addEventListener('change', async () => {
    if (!S.running || !S.currentRecord) return;
    await persist({ currentRecord: { ...S.currentRecord, tipo_servico: $('combo-tipo').value } });
  });
  $('btn-add-link').addEventListener('click', doAddLink);
  $('btn-sheets').addEventListener('click', doUpload);
  $('btn-sheets-help').addEventListener('click', () => show('help'));
  $('btn-edit-tipos').addEventListener('click', () => { buildEditTipos(); show('edit-tipos'); });
  $('btn-settings').addEventListener('click',   () => { buildSettings();  show('settings');  });
  $('btn-back-help').addEventListener('click',  () => show('main'));

  $('btn-setup-save').addEventListener('click', async () => {
    const name = $('input-name').value.trim();
    if (!name) return;
    await persist({ usuario: name });
    syncMain();
    show('main');
  });
  $('input-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-setup-save').click();
  });

  // Script na tela de ajuda
  $('script-box').textContent = APPS_SCRIPT;
  $('btn-copy-script').addEventListener('click', async () => {
    await navigator.clipboard.writeText(APPS_SCRIPT);
    $('btn-copy-script').textContent = '✓ Copiado!';
    setTimeout(() => { $('btn-copy-script').textContent = '📋  Copiar script'; }, 2000);
  });

  if (!S.usuario) { show('setup'); return; }

  syncMain();
  show('main');
  if (S.running && !S.paused) startTick();
});
