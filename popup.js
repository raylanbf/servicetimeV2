'use strict';

// ── Constantes ────────────────────────────────────────────────────────
const DEFAULT_TIPOS = [
  'Cards Deduca',
];

const DEFAULT_CANVAS_EXCEPTIONS = [
  'Apresentação da Disciplina',
  'Plano de Ensino',
  'Referências Bibliográficas',
  'Orientações de Estudo',
  'Material Complementar',
  'Atividade Objetiva',
  'O que você achou desta disciplina? (PÓS EAD)',
  'PROVA FINAL',
];

// Páginas que, por padrão, não precisam ter vídeo — editável em ⚙ Configurações.
const DEFAULT_CANVAS_NO_VIDEO = [
  'Apresentação da Disciplina',
  'Plano de Ensino',
  'Referências Bibliográficas',
  'Orientações de Estudo',
  'Material Complementar',
  'Atividade Objetiva',
  'Como você avalia esta disciplina?',
  'PROVA FINAL',
];

const APPS_SCRIPT =
`function doPost(e) {
  try {
    var dados = JSON.parse(e.postData.contents);
    var planilha = SpreadsheetApp.getActiveSpreadsheet();

    // Busca ou cria a aba "Service Timer"
    var aba = planilha.getSheetByName("Service Timer");
    if (!aba) {
      aba = planilha.insertSheet("Service Timer");
    }

    var CABECALHOS = [
      "ID", "Usuário", "Tipo de Serviço", "Data",
      "Início", "Fim", "Duração", "Duração (s)",
      "Pausas", "URLs", "Comentário", "Suspenso"
    ];

    // Cria cabeçalhos se a aba estiver vazia
    if (aba.getLastRow() === 0) {
      var hr = aba.getRange(1, 1, 1, CABECALHOS.length);
      hr.setValues([CABECALHOS]);
      hr.setFontWeight("bold");
      hr.setBackground("#4ade80");
      aba.setFrozenRows(1);
    }

    // Carrega IDs já registrados para evitar duplicatas
    var idsExistentes = {};
    var ultimaLinha = aba.getLastRow();
    if (ultimaLinha > 1) {
      var idsArr = aba.getRange(2, 1, ultimaLinha - 1, 1).getValues();
      for (var k = 0; k < idsArr.length; k++) {
        if (idsArr[k][0]) idsExistentes[String(idsArr[k][0])] = true;
      }
    }

    var registros = dados.registros || [];
    var novasLinhas = [];

    for (var i = 0; i < registros.length; i++) {
      var r = registros[i];
      var id = r._id || "";
      if (id && idsExistentes[id]) continue;

      var pausas = (r.pausas || []).filter(function(p) { return p.pausa; })
        .map(function(p) { return p.pausa + " → " + (p.retorno || "-"); })
        .join("; ");

      var allUrls = [r.url || ""].concat(r.links || []).filter(Boolean);

      novasLinhas.push([
        id,
        r.usuario || dados.usuario || "",
        r.tipo_servico || "",
        r.data || "",
        r.inicio || "",
        r.fim || "",
        r.tempo_total || "",
        r.tempo_total_segundos || 0,
        pausas,
        allUrls.join("\\n"),
        r.comentario || "",
        r.foiSuspenso ? "Sim" : "Não"
      ]);
    }

    if (novasLinhas.length > 0) {
      aba.getRange(aba.getLastRow() + 1, 1, novasLinhas.length, CABECALHOS.length)
        .setValues(novasLinhas);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok", adicionados: novasLinhas.length }))
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

// Acima deste intervalo sem prova de vida do heartbeat, considera-se que o
// navegador esteve fechado / o PC desligado: o timer é suspenso na reabertura.
const STALE_GAP_MS = 150 * 1000;

function extractTaskId(url) {
  const m = (url || '').match(/[?&]task=(\d+)/);
  return m ? `Task #${m[1]}` : null;
}

function extractIds(urls) {
  const ids = [], seen = new Set();
  for (const url of urls) {
    if (!url) continue;
    const task   = url.match(/[?&]task=(\d+)/);
    const course = url.match(/\/courses\/(\d+)/);
    const fic    = url.match(/\/fic\/relatorio\/(\d+)/);
    if (task   && !seen.has('t' + task[1]))   { ids.push({ icon: '🎯', label: 'Task',  value: task[1]   }); seen.add('t' + task[1]);   }
    if (course && !seen.has('c' + course[1])) { ids.push({ icon: '🎓', label: 'Curso', value: course[1] }); seen.add('c' + course[1]); }
    if (fic    && !seen.has('f' + fic[1]))    { ids.push({ icon: '📄', label: 'FIC',   value: fic[1]    }); seen.add('f' + fic[1]);    }
  }
  return ids;
}

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
  $('count-label').textContent = `${S.registros.length} registro(s)`;
}

// ── Sincroniza UI com estado ──────────────────────────────────────────
function syncMain() {
  $('user-label').textContent = '👤  ' + S.usuario;
  $('version-label').textContent = 'v' + chrome.runtime.getManifest().version;

  const combo = $('combo-tipo');
  combo.innerHTML = '';
  S.tipos.forEach(t => {
    const o = document.createElement('option');
    o.textContent = t;
    combo.appendChild(o);
  });
  if (S.currentRecord) combo.value = S.currentRecord.tipo_servico;

  $('btn-start').disabled   = S.running;
  $('btn-pause').disabled   = !S.running;
  $('btn-stop').disabled    = !S.running;
  $('btn-suspend').disabled = !S.running;

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

  // Toggle e painel do Google Sheets
  $('toggle-sheets').checked          = S.sheetsEnabled;
  $('sheets-panel').style.display     = S.sheetsEnabled ? 'block' : 'none';
  $('sheets-row').style.display       = S.sheetsEnabled && S.webhook_url ? 'flex' : 'none';
  $('webhook-setup-box').style.display = S.sheetsEnabled && !S.webhook_url ? 'block' : 'none';

  // Cards suspensos
  const suspBox = $('suspended-box');
  const suspended = S.suspended || [];
  if (suspended.length > 0) {
    suspBox.style.display = 'block';
    const list = $('suspended-list');
    list.innerHTML = '';
    suspended.forEach((entry, i) => {
      const label    = extractTaskId(entry.record.url) || entry.record.tipo_servico;
      const allUrls  = [entry.record.url, ...(entry.record.links || [])].filter(Boolean);
      const ids      = extractIds(allUrls);
      const badges   = ids.map(id => `<span class="suspended-id-badge">${id.icon} ${id.label} #${id.value}</span>`).join('');
      const div      = document.createElement('div');
      div.className  = 'suspended-item';
      const disabled = S.running ? 'disabled title="Finalize ou suspenda o card atual primeiro"' : '';
      div.innerHTML =
        `<div class="suspended-info">
           <div class="suspended-task">${label}</div>
           ${badges ? `<div class="suspended-ids">${badges}</div>` : ''}
           <div class="suspended-meta">${entry.record.data ? entry.record.data + ' · ' : ''}${entry.record.tipo_servico} · ${fmt(entry.accMs)} acumulado</div>
         </div>
         <button class="btn btn-green" style="font-size:10px;padding:3px 8px;flex-shrink:0" data-i="${i}" ${disabled}>▶ Retomar</button>`;
      list.appendChild(div);
    });
    list.onclick = e => {
      const btn = e.target.closest('[data-i]');
      if (btn) doResumeSuspended(+btn.dataset.i);
    };
  } else {
    suspBox.style.display = 'none';
  }

  // Últimos registros
  buildRecentRecords();

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

// ── Registros ─────────────────────────────────────────────────────
function recordItem(r) {
  const div = document.createElement('div');
  div.className = 'record-item';
  div.style.cursor = 'pointer';
  div.innerHTML =
    `<div class="record-info">
       <div class="record-tipo">${r.tipo_servico}</div>
       <div class="record-meta">${r.data || ''} · ${r.inicio || ''}–${r.fim || ''}</div>
     </div>
     <div class="record-dur">${r.tempo_total || ''}</div>`;
  div.addEventListener('click', () => showRecordDetail(r, div.closest('#all-records-list') ? 'records' : 'main'));
  return div;
}

function showRecordDetail(r, from = 'main') {
  $('btn-back-record-detail').dataset.from = from;
  $('btn-back-record-detail').dataset.recordId = r._id;
  function pauseDurLabel(p) {
    if (!p.pausa || !p.retorno) return '';
    const toMin = s => { const [h, m, sec] = s.split(':').map(Number); return h * 60 + m + (sec || 0) / 60; };
    const diff = Math.round(toMin(p.retorno) - toMin(p.pausa));
    return diff > 0 ? `${diff} min` : '';
  }

  const allLinks = [r.url, ...(r.links || [])].filter(Boolean);
  const pausas   = (r.pausas || []).filter(p => p.pausa);

  let html = `
    <div class="detail-tipo">${r.tipo_servico}</div>

    <div class="detail-dur-box">
      <div class="detail-dur">${r.tempo_total || '—'}</div>
      <div class="detail-dur-label">duração total</div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">📅 Período</div>
      <div class="detail-row"><span class="detail-row-label">Data</span><span class="detail-row-value">${r.data || '—'}</span></div>
      <div class="detail-row"><span class="detail-row-label">Início</span><span class="detail-row-value">${r.inicio || '—'}</span></div>
      <div class="detail-row"><span class="detail-row-label">Fim</span><span class="detail-row-value">${r.fim || '—'}</span></div>
    </div>`;

  if (allLinks.length) {
    html += `<div class="detail-section">
      <div class="detail-section-title">🔗 Links (${allLinks.length})</div>
      ${allLinks.map(l => `<div class="detail-link detail-link-clickable" data-url="${l}" title="Abrir: ${l}">${l} <span class="detail-link-open">↗</span></div>`).join('')}
    </div>`;
  }

  if (pausas.length) {
    html += `<div class="detail-section">
      <div class="detail-section-title">⏸ Pausas (${pausas.length})</div>
      ${pausas.map((p, i) => {
        const dur = pauseDurLabel(p);
        return `<div class="detail-pause-item">
          <span class="detail-pause-time">${p.pausa}</span>
          <span class="detail-pause-arrow">→</span>
          <span class="detail-pause-time">${p.retorno || '—'}</span>
          ${dur ? `<span class="detail-pause-dur">${dur}</span>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  if (r.comentario) {
    html += `<div class="detail-section">
      <div class="detail-section-title">💬 Comentário</div>
      <div class="detail-comment">${r.comentario}</div>
    </div>`;
  }

  const tags = [];
  if (r.enviado)      tags.push(`<span class="detail-tag detail-tag-green">✅ Enviado</span>`);
  if (r.foiSuspenso)  tags.push(`<span class="detail-tag detail-tag-yellow">📌 Suspenso</span>`);
  if (r.usuario)      tags.push(`<span class="detail-tag detail-tag-blue">👤 ${r.usuario}</span>`);
  if (tags.length) {
    html += `<div class="detail-tags">${tags.join('')}</div>`;
  }

  html += `<div class="row-btns mt10">
    <button id="btn-delete-record" class="btn btn-red" style="flex:1">🗑️  Deletar registro</button>
  </div>`;

  $('record-detail-body').innerHTML = html;
  $('record-detail-body').querySelectorAll('.detail-link-clickable').forEach(el => {
    el.addEventListener('click', () => chrome.tabs.create({ url: el.dataset.url }));
  });
  $('btn-delete-record').addEventListener('click', async () => {
    if (confirm('Tem certeza que deseja deletar este registro?')) {
      S.registros = S.registros.filter(x => x._id !== r._id);
      await chrome.storage.local.set({ registros: S.registros });
      show($('btn-back-record-detail').dataset.from === 'records' ? 'records' : 'main');
      syncMain();
    }
  });
  show('record-detail');
}

function buildRecentRecords() {
  const box = $('recent-box');
  const registros = S.registros || [];
  if (registros.length === 0) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  const list = $('recent-list');
  list.innerHTML = '';
  [...registros].reverse().slice(0, 3).forEach(r => list.appendChild(recordItem(r)));
}

function buildAllRecords() {
  const list = $('all-records-list');
  list.innerHTML = '';
  const registros = [...(S.registros || [])].reverse();
  if (registros.length === 0) {
    list.innerHTML = '<p class="muted small" style="text-align:center;margin-top:20px">Nenhum registro ainda.</p>';
    return;
  }
  registros.forEach(r => {
    const div = recordItem(r);
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-rm-record';
    delBtn.textContent = '🗑';
    delBtn.title = 'Deletar registro';
    delBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Deletar este registro?\n${r.tipo_servico} · ${r.data} · ${r.tempo_total || ''}`)) return;
      S.registros = S.registros.filter(x => x._id !== r._id);
      await chrome.storage.local.set({ registros: S.registros });
      buildRecentRecords();
      buildAllRecords();
    });
    div.appendChild(delBtn);
    list.appendChild(div);
  });
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

// ── Modal de resumo ───────────────────────────────────────────────
function showSummary(record) {
  $('summary-tipo').textContent = record.tipo_servico;
  $('summary-dur').textContent  = record.tempo_total;
  $('summary-inicio').textContent = record.inicio;
  $('summary-fim').textContent    = record.fim;
  const pausaCount = (record.pausas || []).filter(p => p.pausa).length;
  $('summary-pausas-row').style.display = pausaCount > 0 ? 'flex' : 'none';
  if (pausaCount > 0) $('summary-pausas').textContent = `${pausaCount}`;
  $('modal-summary').style.display = 'flex';
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
  const url = tabs[0]?.url;

  const record = {
    _id:                  `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
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
  await persist({ running: true, paused: false, startTs: Date.now(), accMs: 0, lastAlive: Date.now(), currentRecord: record });
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
    await persist({ paused: false, startTs: Date.now(), lastAlive: Date.now(), currentRecord: rec });
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

  const comentarioRaw = await askComment();
  const comentario = S.currentRecord.foiSuspenso
    ? `CARD SUSPENSO${comentarioRaw ? ' - ' + comentarioRaw : ''}`
    : comentarioRaw;

  const record    = { ...S.currentRecord, pausas, fim: fimHMS, tempo_total: dur, tempo_total_segundos: sec, comentario };
  const registros = [...S.registros, record];

  await persist({ running: false, paused: false, startTs: null, accMs: 0, currentRecord: null, registros });
  syncMain();
  showSummary(record);
}

// ── Suspender / Retomar card ──────────────────────────────────────────
async function doSuspend() {
  if (!S.running) return;
  const ms = elapsedMs();
  stopTick();

  // Fecha pausa aberta se existir
  const pausas = S.currentRecord.pausas.map((p, i, arr) =>
    i === arr.length - 1 && !p.retorno ? { ...p, retorno: nowHMS() } : p
  );

  const entry = { record: { ...S.currentRecord, pausas }, accMs: ms };
  const suspended = [...(S.suspended || []), entry];

  await persist({ running: false, paused: false, startTs: null, accMs: 0, currentRecord: null, suspended });
  syncMain();
}

async function doResumeSuspended(i) {
  if (S.running) {
    alert('Finalize ou suspenda o card atual antes de retomar outro.');
    return;
  }
  const entry     = S.suspended[i];
  const suspended = (S.suspended || []).filter((_, idx) => idx !== i);

  // Registra retorno da pausa no histórico do card suspenso
  const pausas = entry.record.pausas.map((p, idx, arr) =>
    idx === arr.length - 1 && !p.retorno ? { ...p, retorno: nowHMS() } : p
  );

  await persist({
    running:       true,
    paused:        false,
    startTs:       Date.now(),
    lastAlive:     Date.now(),
    accMs:         entry.accMs,
    // Suspensão automática (desligamento) não marca "CARD SUSPENSO"; só a manual marca.
    currentRecord: { ...entry.record, pausas, foiSuspenso: entry.auto ? !!entry.record.foiSuspenso : true },
    suspended,
  });
  syncMain();
  startTick();
}

// ── Google Sheets ─────────────────────────────────────────────────────
function setUploadingUI(loading) {
  const btn = $('btn-sheets');
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<span class="spinner"></span>Enviando...'
    : '📊  Enviar ao Google Sheets';
}

function showUploadResult(result) {
  if (!result) return;
  if (result.ok) {
    const n = result.adicionados;
    alert(n > 0
      ? `✅ ${n} registro(s) adicionado(s) na aba "Service Timer"!`
      : '⚠️ Nenhum registro novo — todos já haviam sido enviados.');
  } else {
    alert('Erro ao enviar: ' + result.erro);
  }
}

async function doUpload() {
  if (!S.webhook_url) {
    const url = prompt('Cole a URL do Web App (Google Apps Script):');
    if (!url) return;
    await persist({ webhook_url: url.trim() });
  }

  // Garante que todos os pendentes têm _id (registros antigos podem não ter)
  let registrosAtualizados = false;
  const registros = S.registros.map(r => {
    if (r._id || r.enviado) return r;
    registrosAtualizados = true;
    return { ...r, _id: `${r.data}-${r.inicio}-${(r.usuario||'').replace(/\s/g,'')}-${r.tipo_servico||''}` };
  });
  if (registrosAtualizados) {
    await persist({ registros });
  }

  const pendentes = registros.filter(r => !r.enviado);
  if (!pendentes.length) { alert('Todos os registros já foram enviados.'); return; }

  await persist({ uploading: true, uploadResult: null, uploadStartTs: Date.now() });
  setUploadingUI(true);
  chrome.runtime.sendMessage({ action: 'upload', webhookUrl: S.webhook_url, usuario: S.usuario, registros: pendentes });
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

// ── Links salvos / Starters ───────────────────────────────────────────
async function doOpenStarters() {
  const starters = (S.savedLinks || []).filter(l => l.starter);
  if (!starters.length) { alert('Nenhum link marcado como starter.'); return; }
  for (const l of starters) {
    await chrome.tabs.create({ url: l.url, active: false });
  }
}

function buildLinks() {
  const list = $('links-saved-list');

  function render() {
    list.innerHTML = '';
    (S.savedLinks || []).forEach((l, i) => {
      const div = document.createElement('div');
      div.className = 'saved-link-item';
      div.innerHTML =
        `<div class="saved-link-info" data-a="open" data-i="${i}" style="cursor:pointer">
           <div class="saved-link-label">${l.label}</div>
           <div class="saved-link-url">${l.url}</div>
         </div>
         <button class="star-btn ${l.starter ? 'active' : ''}" data-a="star" data-i="${i}" title="Starter">⭐</button>
         <button class="btn-rm-link" data-a="rm" data-i="${i}">✕</button>`;
      list.appendChild(div);
    });
  }
  render();

  list.onclick = async e => {
    const btn = e.target.closest('[data-a]');
    if (!btn) return;
    const i = +btn.dataset.i;
    const links = [...(S.savedLinks || [])];
    if (btn.dataset.a === 'open') {
      chrome.tabs.create({ url: links[i].url, active: true });
      return;
    } else if (btn.dataset.a === 'star') {
      links[i] = { ...links[i], starter: !links[i].starter };
    } else if (btn.dataset.a === 'rm') {
      links.splice(i, 1);
    }
    await persist({ savedLinks: links });
    render();
  };

  $('input-link-label').value     = '';
  $('input-link-url').value       = '';
  $('input-link-starter').checked = false;

  $('btn-add-saved-link').onclick = async () => {
    const label   = $('input-link-label').value.trim();
    const url     = $('input-link-url').value.trim();
    const starter = $('input-link-starter').checked;
    if (!label || !url) return;
    const links = [...(S.savedLinks || []), { label, url, starter }];
    await persist({ savedLinks: links });
    $('input-link-label').value     = '';
    $('input-link-url').value       = '';
    $('input-link-starter').checked = false;
    render();
  };
}

// Remove só atributos data-darkreader-* (lixo da extensão Dark Reader); mantém
// ids/classes/styles porque fazem parte da estrutura do template. Só normaliza
// (round-trip pelo parser) quando há sujeira a remover, para não alterar HTML limpo.
function stripDarkreader(html) {
  if (!html || !/data-darkreader-/.test(html)) return html;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('*').forEach(n => {
    [...n.attributes].forEach(a => {
      if (a.name.startsWith('data-darkreader-')) n.removeAttribute(a.name);
    });
  });
  return tmp.innerHTML;
}

// ── Blocos salvos (biblioteca de HTML reutilizável) ───────────────────
function buildBlocks() {
  const list = $('blocks-saved-list');
  let editId = null;

  function render() {
    const blocks = S.savedBlocks || [];
    if (!blocks.length) {
      list.innerHTML = '<div class="small muted" style="text-align:center;padding:10px">Nenhum bloco salvo ainda.</div>';
      return;
    }
    list.innerHTML = '';
    blocks.forEach(b => {
      const div = document.createElement('div');
      div.className = 'saved-link-item';
      div.innerHTML =
        `<div class="saved-link-info" data-a="edit" data-id="${b.id}" style="cursor:pointer">
           <div class="saved-link-label">${(b.name || '').replace(/</g, '&lt;')}</div>
           <div class="saved-link-url">${(b.html || '').replace(/</g, '&lt;').slice(0, 70)}…</div>
         </div>
         <button class="btn-rm-link" data-a="rm" data-id="${b.id}">✕</button>`;
      list.appendChild(div);
    });
  }

  function resetForm() {
    editId = null;
    $('input-block-name').value = '';
    $('input-block-html').value = '';
    $('btn-add-block').textContent = '+ Salvar bloco';
  }

  render();
  resetForm();

  list.onclick = async e => {
    const btn = e.target.closest('[data-a]');
    if (!btn) return;
    const blocks = [...(S.savedBlocks || [])];
    const idx = blocks.findIndex(b => b.id === btn.dataset.id);
    if (idx < 0) return;
    if (btn.dataset.a === 'edit') {
      editId = blocks[idx].id;
      $('input-block-name').value = blocks[idx].name;
      $('input-block-html').value = blocks[idx].html;
      $('btn-add-block').textContent = '💾 Salvar alterações';
      $('input-block-name').focus();
    } else if (btn.dataset.a === 'rm') {
      blocks.splice(idx, 1);
      await persist({ savedBlocks: blocks });
      if (editId === btn.dataset.id) resetForm();
      render();
    }
  };

  $('btn-add-block').onclick = async () => {
    const name = $('input-block-name').value.trim();
    const html = stripDarkreader($('input-block-html').value.trim());
    if (!name || !html) return;
    const blocks = [...(S.savedBlocks || [])];
    if (editId) {
      const idx = blocks.findIndex(b => b.id === editId);
      if (idx >= 0) blocks[idx] = { ...blocks[idx], name, html };
    } else {
      blocks.push({ id: 'b' + Date.now().toString(36), name, html });
    }
    await persist({ savedBlocks: blocks });
    resetForm();
    render();
  };
}

// ── Configurações ─────────────────────────────────────────────────────
function buildSettings() {
  $('settings-name').value       = S.usuario;
  $('settings-url').value        = S.webhook_url;
  $('settings-video-w').value    = S.video_width;
  $('settings-video-h').value    = S.video_height;
  $('settings-openrouter').value = S.openrouter_key || '';

  // Botão de envio: visível só quando há URL
  function syncSheetsBtn() {
    $('btn-settings-sheets').style.display =
      $('settings-url').value.trim() ? 'block' : 'none';
  }
  syncSheetsBtn();
  $('settings-url').addEventListener('input', syncSheetsBtn);
  $('btn-settings-sheets').onclick = doUpload;

  // Script do Apps Script
  $('settings-script-box').textContent = APPS_SCRIPT;
  $('btn-settings-toggle-script').onclick = () => {
    const wrap   = $('settings-script-wrap');
    const hidden = wrap.style.display === 'none';
    wrap.style.display = hidden ? 'block' : 'none';
    $('btn-settings-toggle-script').textContent =
      hidden ? '📄  Ocultar script' : '📄  Ver script do Apps Script';
  };
  $('btn-settings-copy-script').onclick = async () => {
    await navigator.clipboard.writeText(APPS_SCRIPT);
    $('btn-settings-copy-script').textContent = '✓ Copiado!';
    setTimeout(() => { $('btn-settings-copy-script').textContent = '📋  Copiar script'; }, 2000);
  };

  $('settings-canvas-exceptions').value = (S.canvasExceptions || []).join('\n');
  $('settings-canvas-no-video').value   = (S.canvasNoVideo || []).join('\n');

  $('btn-save-settings').onclick = async () => {
    const name = $('settings-name').value.trim();
    if (!name) return;
    const w          = parseInt($('settings-video-w').value, 10) || 620;
    const h          = parseInt($('settings-video-h').value, 10) || 398;
    const key        = $('settings-openrouter').value.trim();
    const toLines = el => $(el).value.split('\n').map(s => s.trim()).filter(Boolean);
    await persist({
      usuario: name, webhook_url: $('settings-url').value.trim(),
      video_width: w, video_height: h, openrouter_key: key,
      canvasExceptions: toLines('settings-canvas-exceptions'),
      canvasNoVideo:    toLines('settings-canvas-no-video'),
    });
    $('user-label').textContent = '👤  ' + name;
    show('main');
  };
  $('btn-clear-registros').onclick = async () => {
    const count = S.registros.length;
    if (!count) { alert('Não há registros para limpar.'); return; }
    if (!confirm(`Apagar todos os ${count} registro(s)?\nEsta ação não pode ser desfeita.`)) return;
    await persist({ registros: [] });
    updateCount();
    buildRecentRecords();
    alert('Registros apagados.');
  };

  $('btn-back-settings').onclick = () => show('main');
  $('btn-test-clipboard').onclick = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('test-clipboard.html') });
  };
  $('btn-manual').onclick = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('manual.html') });
  };
}

// ── Canvas LMS ────────────────────────────────────────────────────────
async function getCanvasCourseId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const url  = tabs[0]?.url || '';
  const m    = url.match(/\/courses\/(\d+)/);
  return m ? m[1] : null;
}

async function syncCanvasTools() {
  const courseId = await getCanvasCourseId();
  $('canvas-course-label').textContent = courseId ? `curso #${courseId}` : 'nenhum curso nesta aba';
}

async function doApplyIndent() {
  const courseId   = await getCanvasCourseId();
  if (!courseId) return;
  const exceptions = S.canvasExceptions || [];
  const btn        = $('btn-canvas-indent');
  const statusEl   = $('canvas-indent-status');

  btn.disabled    = true;
  btn.innerHTML   = '<span class="spinner"></span>Aplicando...';
  statusEl.style.display = 'none';

  try {
    const tabs    = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: async (courseId, exceptions) => {
        async function fetchAll(url) {
          const out = [];
          let next  = url;
          while (next) {
            const res  = await fetch(next);
            const data = await res.json();
            if (Array.isArray(data)) out.push(...data);
            const link = res.headers.get('Link') || '';
            const m    = link.match(/<([^>]+)>;\s*rel="next"/);
            next = m ? m[1] : null;
          }
          return out;
        }

        // Cookie _csrf_token é a fonte correta no Canvas
        const rawCsrf = document.cookie.split(';')
          .map(c => c.trim())
          .find(c => c.startsWith('_csrf_token='));
        const csrf = rawCsrf
          ? decodeURIComponent(rawCsrf.split('=').slice(1).join('='))
          : decodeURIComponent(document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '');

        const modules = await fetchAll(
          `/api/v1/courses/${courseId}/modules?per_page=100`
        );

        let adjusted = 0, failed = 0, total = 0, firstError = '';

        for (const mod of modules) {
          const items = await fetchAll(
            `/api/v1/courses/${courseId}/modules/${mod.id}/items?per_page=100`
          );
          for (const item of items) {
            const exclude = exceptions.some(exc =>
              item.title.toLowerCase().includes(exc.toLowerCase().trim())
            );
            const target = exclude ? 0 : 1;
            if (item.indent !== target) {
              const res = await fetch(
                `/api/v1/courses/${courseId}/modules/${mod.id}/items/${item.id}`,
                {
                  method:  'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrf,
                  },
                  body: JSON.stringify({ module_item: { indent: target } }),
                }
              );
              if (res.ok) adjusted++;
              else {
                if (!firstError) firstError = `HTTP ${res.status}`;
                failed++;
              }
            }
            total++;
          }
        }
        return { adjusted, failed, total, modules: modules.length, firstError };
      },
      args: [courseId, exceptions],
    });

    const r = results[0]?.result;
    if (r) {
      if (r.failed > 0) {
        statusEl.textContent = `⚠ ${r.adjusted} ajustado(s), ${r.failed} falharam · erro: ${r.firstError}`;
        statusEl.style.color = '#f97316';
      } else {
        statusEl.textContent = `✅ ${r.adjusted} item(s) ajustado(s) em ${r.modules} módulo(s) · ${r.total} total — recarregando...`;
        statusEl.style.color = '#4ade80';
        setTimeout(() => chrome.tabs.reload(tabs[0].id), 2000);
      }
    }
  } catch (err) {
    statusEl.textContent = '✗ Erro: ' + err.message;
    statusEl.style.color = '#f87171';
  }

  btn.disabled    = false;
  btn.textContent = '🔧  Aplicar recuo nos módulos';
  statusEl.style.display = 'block';
}

// ── Histórico de edições Canvas ──────────────────────────────────────
let _revisionsFetching = false;

async function doFetchRevisions() {
  if (_revisionsFetching) return;

  const statusEl  = $('canvas-revisions-status');
  const listEl    = $('canvas-revisions-list');
  const dateValue = $('revisions-date-filter').value;

  if (!dateValue) {
    statusEl.style.color = '#f97316';
    statusEl.textContent = 'Informe uma data para buscar.';
    return;
  }

  const courseId = await getCanvasCourseId();
  if (!courseId) return;

  const dateFrom = new Date(dateValue + 'T00:00:00');
  _revisionsFetching = true;
  statusEl.style.color = '#64748b';
  statusEl.textContent = 'Buscando páginas do curso...';
  listEl.innerHTML = '';

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

    const pagesResult = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: async (courseId) => {
        async function fetchAll(url) {
          const out = []; let next = url;
          while (next) {
            const res  = await fetch(next);
            const data = await res.json();
            if (Array.isArray(data)) out.push(...data);
            const m = (res.headers.get('Link') || '').match(/<([^>]+)>;\s*rel="next"/);
            next = m ? m[1] : null;
          }
          return out;
        }
        return fetchAll(`/api/v1/courses/${courseId}/pages?per_page=100`);
      },
      args: [courseId],
    });

    const pages = pagesResult[0]?.result || [];
    if (!pages.length) { statusEl.textContent = 'Nenhuma página encontrada.'; return; }

    statusEl.textContent = `Buscando revisões de ${pages.length} página(s)...`;

    const revisionsResult = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: async (courseId, pages) => {
        async function fetchAll(url) {
          const out = []; let next = url;
          while (next) {
            const res  = await fetch(next);
            const data = await res.json();
            if (Array.isArray(data)) out.push(...data);
            const m = (res.headers.get('Link') || '').match(/<([^>]+)>;\s*rel="next"/);
            next = m ? m[1] : null;
          }
          return out;
        }
        const entries = [];
        for (const page of pages) {
          try {
            const res  = await fetch(`/api/v1/courses/${courseId}/pages/${page.url}/revisions?per_page=2`);
            const revs = await res.json();
            for (const rev of Array.isArray(revs) ? revs : []) {
              if (!rev.edited_by) continue;
              entries.push({
                page_title:  page.title,
                editor:      rev.edited_by.display_name,
                updated_at:  rev.updated_at,
                latest:      !!rev.latest,
              });
            }
          } catch {}
        }
        entries.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        return { entries, total: pages.length };
      },
      args: [courseId, pages],
    });

    const { entries = [], total = 0 } = revisionsResult[0]?.result || {};

    if (!entries.length) { statusEl.textContent = 'Nenhuma revisão encontrada.'; return; }

    const filtered = dateFrom
      ? entries.filter(e => new Date(e.updated_at) >= dateFrom)
      : entries;

    if (!filtered.length) {
      statusEl.textContent = 'Nenhuma edição encontrada a partir dessa data.';
      return;
    }

    statusEl.textContent = `${filtered.length} edição(ões) em ${total} página(s)${dateFrom ? ' · filtrado por data' : ''}`;

    filtered.forEach(e => {
      const d         = new Date(e.updated_at);
      const formatted = `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      const div       = document.createElement('div');
      div.className   = 'revision-item';
      div.innerHTML   =
        `<div class="revision-page">📄 <span class="revision-page-label">Página:</span> ${e.page_title}${e.latest ? '<span class="revision-latest">atual</span>' : ''}</div>
         <div class="revision-editor">👤 ${e.editor}</div>
         <div class="revision-date">${formatted}</div>`;
      listEl.appendChild(div);
    });

  } catch (err) {
    statusEl.style.color = '#f87171';
    statusEl.textContent = '✗ Erro: ' + err.message;
  } finally {
    _revisionsFetching = false;
  }
}

// ── Duplicar bloco no editor do Canvas (Camada 1) ────────────────────
// Injeta no MAIN world (precisa do window.tinymce real da página) o modo de
// seleção: destaca blocos, clica na origem e no destino, insere uma cópia limpa.
async function doDuplicateBlock() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      world:  'MAIN',
      func:   blockDuplicatorMain,
    });
  } catch (err) {
    alert('Não foi possível ativar nesta página: ' + err.message);
  }
}

function blockDuplicatorMain() {
  if (window.__svcDupActive) return;

  const ed = window.tinymce && (tinymce.activeEditor || (tinymce.editors && tinymce.editors[0]));
  if (!ed || (ed.isHidden && ed.isHidden())) {
    alert('Abra uma página no editor de conteúdo do Canvas em modo visual (Rich Content) e tente de novo.');
    return;
  }

  const body = ed.getBody();
  const doc  = body.ownerDocument;
  const win  = doc.defaultView;
  window.__svcDupActive = true;
  doc.documentElement.style.cursor = 'copy';

  let phase   = 'source';   // 'source' (origem) | 'dest' (destino)
  let current = null;       // elemento destacado no momento
  let srcHTML = null;       // HTML da origem, já limpo
  const COLOR = { source: '#3b82f6', dest: '#22c55e' };

  // Barra de instruções (no topo da página, fora do iframe do editor)
  const bar = document.createElement('div');
  bar.id = '__svc-dup-bar__';
  Object.assign(bar.style, {
    position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
    background: '#1e1e2e', color: '#e2e8f0', font: '13px system-ui, sans-serif',
    padding: '8px 14px', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
  });
  document.body.appendChild(bar);
  function setBar() {
    bar.innerHTML = phase === 'source'
      ? '📑 <b>Duplicar bloco</b> — clique no bloco que quer copiar. <span style="opacity:.7">↑/↓ ajusta o nível · ESC cancela</span>'
      : '📑 <b>Clique no destino</b> — a cópia entra logo abaixo dele. <span style="opacity:.7">↑/↓ ajusta · ESC cancela</span>';
  }
  setBar();

  // Bloco mais interno sob o cursor (sobe nós inline até achar um bloco)
  function blockOf(node) {
    let el = node && node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== body) {
      const d = win.getComputedStyle(el).display;
      if (d && d.slice(0, 6) !== 'inline') return el;
      el = el.parentElement;
    }
    return null;
  }

  function paint(el) {
    if (!el) return;
    el.__svcOutline = el.style.outline;
    el.__svcOffset  = el.style.outlineOffset;
    el.style.outline       = '2px solid ' + (phase === 'source' ? COLOR.source : COLOR.dest);
    el.style.outlineOffset = '-2px';
  }
  function unpaint(el) {
    if (!el) return;
    el.style.outline       = el.__svcOutline || '';
    el.style.outlineOffset = el.__svcOffset  || '';
    delete el.__svcOutline; delete el.__svcOffset;
  }
  function setCurrent(el) {
    if (el === current) return;
    unpaint(current);
    current = el;
    paint(current);
  }

  // Remove ids e marcações internas do TinyMCE para não duplicar âncoras
  function cleanHTML(html) {
    const tmp = doc.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('script').forEach(n => n.remove());
    tmp.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    tmp.querySelectorAll('[data-mce-selected],[data-mce-bogus]').forEach(n => {
      n.removeAttribute('data-mce-selected');
      n.removeAttribute('data-mce-bogus');
    });
    return tmp.innerHTML;
  }

  function onMove(e) {
    const blk = blockOf(e.target);
    if (blk) setCurrent(blk);
  }

  function onDown(e) {
    if (!current) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

    if (phase === 'source') {
      srcHTML = cleanHTML(current.outerHTML);
      unpaint(current);
      current = null;
      phase = 'dest';
      setBar();
      return;
    }

    const dest = current;
    const run  = () => dest.insertAdjacentHTML('afterend', srcHTML);
    if (ed.undoManager && ed.undoManager.transact) ed.undoManager.transact(run);
    else run();
    if (ed.nodeChanged) ed.nodeChanged();
    if (ed.fire)        ed.fire('input');
    if (ed.setDirty)    ed.setDirty(true);
    flash('✓ Bloco duplicado! (Ctrl+Z desfaz)');
    cleanup();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); cleanup(); return; }
    if (!current) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const p = current.parentElement;
      if (p && p !== body) setCurrent(p);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const child = [...current.children].find(c => c.nodeType === 1);
      if (child) setCurrent(child);
    }
  }

  function flash(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      background: '#166534', color: '#fff', padding: '10px 18px', borderRadius: '8px',
      font: '13px system-ui', zIndex: '2147483647', boxShadow: '0 2px 10px rgba(0,0,0,.4)',
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  function cleanup() {
    unpaint(current);
    doc.documentElement.style.cursor = '';
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('mousedown', onDown, true);
    doc.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keydown', onKey, true);
    bar.remove();
    window.__svcDupActive = false;
  }

  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('mousedown', onDown, true);
  doc.addEventListener('keydown', onKey, true);
  document.addEventListener('keydown', onKey, true);
}

// ── Reorganizar blocos por arraste (drag-and-drop) ──────────────────
async function doMoveBlocks() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) return;
  const { savedBlocks = [] } = await chrome.storage.local.get('savedBlocks');
  try {
    await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'MAIN', func: blockMoverMain, args: [savedBlocks] });
  } catch (err) { alert('Não foi possível ativar nesta página: ' + err.message); }
}

function blockMoverMain(savedBlocks) {
  savedBlocks = savedBlocks || [];
  if (window.__svcMoveActive) return;
  const ed = window.tinymce && (tinymce.activeEditor || (tinymce.editors && tinymce.editors[0]));
  if (!ed || (ed.isHidden && ed.isHidden())) {
    alert('Abra uma página no editor visual do Canvas e tente de novo.');
    return;
  }
  const body = ed.getBody();
  const doc  = body.ownerDocument;
  const win  = doc.defaultView;
  window.__svcMoveActive = true;
  doc.documentElement.style.cursor = 'grab';

  let current = null;    // bloco destacado no hover
  let dragEl  = null;    // bloco sendo arrastado
  let overEl  = null;    // irmão sob o cursor
  let before  = false;   // soltar antes (true) / depois (false) do overEl
  let dragging = false;
  let downX = 0, downY = 0;
  const THRESHOLD = 5;

  // Modo "inserir bloco salvo": clique posiciona o snippet escolhido
  let pendingHtml = null;  // HTML do bloco salvo aguardando clique
  let insTarget   = null;  // bloco-alvo sob o cursor
  let insBefore   = false; // inserir antes (true) / depois (false)

  const BAR_NORMAL = '✋ <b>Reorganizar blocos</b> — arraste um bloco para mudar a ordem. <span style="opacity:.7">↑/↓ ajusta o que pega · a linha verde mostra onde cai · Ctrl+Z desfaz · ESC sai</span>';
  const BAR_INSERT = '➕ <b>Inserir bloco salvo</b> — clique num bloco. <span style="opacity:.7">metade de cima = antes · metade de baixo = depois · ESC cancela</span>';

  const bar = document.createElement('div');
  bar.id = '__svc-move-bar__';
  Object.assign(bar.style, { position:'fixed', top:'0', left:'0', right:'0', zIndex:'2147483647',
    background:'#1e1e2e', color:'#e2e8f0', font:'13px system-ui,sans-serif', padding:'8px 14px',
    textAlign:'center', boxShadow:'0 2px 8px rgba(0,0,0,.4)', cursor:'default' });
  const barText = document.createElement('span');
  barText.innerHTML = BAR_NORMAL;
  bar.appendChild(barText);
  const setBarNormal = () => { barText.innerHTML = BAR_NORMAL; };
  const setBarInsert = () => { barText.innerHTML = BAR_INSERT; };

  if (savedBlocks.length) {
    const sel = document.createElement('select');
    Object.assign(sel.style, { marginLeft:'10px', fontSize:'12px', padding:'2px 4px', borderRadius:'4px',
      border:'1px solid #45475a', background:'#313244', color:'#e2e8f0', cursor:'pointer' });
    sel.innerHTML = '<option value="">📦 inserir bloco salvo…</option>' +
      savedBlocks.map((b, i) => `<option value="${i}">${(b.name || '').replace(/</g, '&lt;')}</option>`).join('');
    sel.onchange = () => {
      if (sel.value === '') { pendingHtml = null; setBarNormal(); doc.documentElement.style.cursor = 'grab'; return; }
      pendingHtml = savedBlocks[+sel.value].html;
      sel.value = '';
      unpaint(current); current = null;
      setBarInsert();
      doc.documentElement.style.cursor = 'copy';
    };
    bar.appendChild(sel);
  }
  document.body.appendChild(bar);

  // Linha de drop inline (inserida no DOM entre blocos, permite scrollIntoView)
  const line = doc.createElement('div');
  Object.assign(line.style, { height: '3px', background: '#22c55e', borderRadius: '2px',
    margin: '2px 0', pointerEvents: 'none', boxShadow: '0 0 10px 3px rgba(34,197,94,0.6)' });

  function blockOf(node) {
    let el = node && node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== body) {
      const d = win.getComputedStyle(el).display;
      if (d && d.slice(0, 6) !== 'inline') return el;
      el = el.parentElement;
    }
    return null;
  }
  function paint(el, color) {
    if (!el) return;
    el.__o = el.style.outline; el.__oo = el.style.outlineOffset;
    el.style.outline = '2px solid ' + color; el.style.outlineOffset = '-2px';
  }
  function unpaint(el) {
    if (!el) return;
    el.style.outline = el.__o || ''; el.style.outlineOffset = el.__oo || '';
    delete el.__o; delete el.__oo;
  }
  function setCurrent(el) {
    if (el === current) return;
    unpaint(current); current = el; paint(current, '#3b82f6');
  }
  function posLine(sib, isBefore) {
    const prevSib = line.previousElementSibling;
    if (isBefore) sib.before(line); else sib.after(line);
    if (prevSib !== line.previousElementSibling) {
      line.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
  function flash(msg) {
    const t = document.createElement('div'); t.textContent = msg;
    Object.assign(t.style, { position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
      background:'#166534', color:'#fff', padding:'10px 18px', borderRadius:'8px', font:'13px system-ui',
      zIndex:'2147483647', boxShadow:'0 2px 10px rgba(0,0,0,.4)' });
    document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
  }

  function onMove(e) {
    if (pendingHtml) {
      const blk = blockOf(e.target);
      if (!blk || blk === body) { line.remove(); insTarget = null; return; }
      const r = blk.getBoundingClientRect();
      insBefore = e.clientY < r.top + r.height / 2;
      insTarget = blk;
      posLine(blk, insBefore);
      return;
    }
    if (dragEl && !dragging) {
      if (Math.abs(e.clientX - downX) > THRESHOLD || Math.abs(e.clientY - downY) > THRESHOLD) {
        dragging = true;
        unpaint(current); current = null;
        dragEl.style.opacity = '0.45';
        doc.documentElement.style.cursor = 'grabbing';
      } else return;
    }
    if (dragging) {
      const sibs = [...dragEl.parentElement.children].filter(c => c.nodeType === 1 && c !== line && c !== dragEl);
      let found = null;
      for (const s of sibs) {
        const r = s.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) { found = s; break; }
      }
      if (!found) { overEl = null; line.remove(); return; }
      const r = found.getBoundingClientRect();
      before = (e.clientY < r.top + r.height / 2);
      overEl = found;
      posLine(found, before);
      return;
    }
    const blk = blockOf(e.target);
    if (blk) setCurrent(blk);
  }

  function onDown(e) {
    if (pendingHtml) {
      e.preventDefault(); e.stopPropagation();
      if (insTarget) {
        const target = insTarget, html = pendingHtml, isBefore = insBefore;
        const run = () => target.insertAdjacentHTML(isBefore ? 'beforebegin' : 'afterend', html);
        if (ed.undoManager && ed.undoManager.transact) ed.undoManager.transact(run); else run();
        if (ed.nodeChanged) ed.nodeChanged();
        if (ed.fire) ed.fire('input');
        if (ed.setDirty) ed.setDirty(true);
        flash('✓ Bloco inserido! (Ctrl+Z desfaz)');
      }
      pendingHtml = null; insTarget = null; line.remove();
      setBarNormal();
      doc.documentElement.style.cursor = 'grab';
      return;
    }
    if (!current) return;
    e.preventDefault(); e.stopPropagation();
    dragEl = current; downX = e.clientX; downY = e.clientY; dragging = false;
  }

  function onUp(e) {
    if (!dragEl) return;
    if (dragging) {
      e.preventDefault(); e.stopPropagation();
      dragEl.style.opacity = '';
      doc.documentElement.style.cursor = 'grab';
      line.remove();
      if (overEl && overEl !== dragEl) {
        const ref = before ? overEl : overEl.nextSibling;
        if (ref !== dragEl) {
          const run = () => dragEl.parentElement.insertBefore(dragEl, ref);
          if (ed.undoManager && ed.undoManager.transact) ed.undoManager.transact(run); else run();
          if (ed.nodeChanged) ed.nodeChanged();
          if (ed.fire) ed.fire('input');
          if (ed.setDirty) ed.setDirty(true);
          flash('✓ Bloco movido! (Ctrl+Z desfaz)');
        }
      }
    }
    dragEl = null; dragging = false; overEl = null;
  }

  function onKey(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;   // não sequestrar teclas do seletor
    if (e.key === 'Escape') {
      e.preventDefault();
      if (pendingHtml) { pendingHtml = null; insTarget = null; line.remove(); setBarNormal(); doc.documentElement.style.cursor = 'grab'; return; }
      cleanup(); return;
    }
    if (e.key === 'Delete' && current && !dragging) {
      e.preventDefault();
      const el = current;
      unpaint(el); current = null;
      const run = () => el.remove();
      if (ed.undoManager && ed.undoManager.transact) ed.undoManager.transact(run); else run();
      if (ed.nodeChanged) ed.nodeChanged();
      if (ed.fire) ed.fire('input');
      if (ed.setDirty) ed.setDirty(true);
      flash('🗑 Bloco excluído. (Ctrl+Z desfaz)');
      return;
    }
    if (dragging || !current) return;
    if (e.key === 'ArrowUp')   { e.preventDefault(); const p = current.parentElement; if (p && p !== body) setCurrent(p); }
    if (e.key === 'ArrowDown') { e.preventDefault(); const c = [...current.children].find(x => x.nodeType === 1); if (c) setCurrent(c); }
  }

  function block(e) { e.preventDefault(); }

  function cleanup() {
    unpaint(current);
    if (dragEl) dragEl.style.opacity = '';
    doc.documentElement.style.cursor = '';
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('mousedown', onDown, true);
    doc.removeEventListener('mouseup', onUp, true);
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('dragstart', block, true);
    doc.removeEventListener('selectstart', block, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mouseup', onUp, true);
    line.remove(); bar.remove();
    window.__svcMoveActive = false;
  }

  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('mousedown', onDown, true);
  doc.addEventListener('mouseup', onUp, true);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('dragstart', block, true);
  doc.addEventListener('selectstart', block, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mouseup', onUp, true);
}

// ── Mapa de elementos (Camada 2) ────────────────────────────────────
async function doElementMap() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) return;
  const { savedBlocks = [] } = await chrome.storage.local.get('savedBlocks');
  try {
    // Ponte ISOLATED: recebe pedidos de "salvar bloco" vindos do mundo MAIN (que não acessa chrome.storage)
    await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: blockSaveBridge });
    await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'MAIN', func: blockMapMain, args: [savedBlocks] });
  } catch (err) { alert('Não foi possível ativar nesta página: ' + err.message); }
}

// Roda no mundo ISOLATED (tem chrome.storage). Escuta postMessage do mapa e salva o bloco.
function blockSaveBridge() {
  if (window.__svcBlockBridge) return;
  window.__svcBlockBridge = true;
  window.addEventListener('message', async (e) => {
    const d = e.data;
    if (!d || d.__svc !== 'saveBlock' || typeof d.html !== 'string') return;
    const { savedBlocks = [] } = await chrome.storage.local.get('savedBlocks');
    savedBlocks.push({ id: 'b' + Date.now().toString(36), name: (d.name || 'Bloco').trim(), html: d.html });
    await chrome.storage.local.set({ savedBlocks });
  });
}

function blockMapMain(savedBlocks) {
  savedBlocks = savedBlocks || [];
  if (window.__svcMapCleanup) { window.__svcMapCleanup(); return; }   // toggle: fecha se já aberto

  const ed = window.tinymce && (tinymce.activeEditor || (tinymce.editors && tinymce.editors[0]));
  if (!ed || (ed.isHidden && ed.isHidden())) {
    alert('Abra uma página no editor visual do Canvas e tente de novo.');
    return;
  }
  const body = ed.getBody();
  const doc  = body.ownerDocument;
  const win  = doc.defaultView;

  const txt   = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const idof  = el => (el.id || '').toLowerCase();
  const clsof = el => (el.className && el.className.toString ? el.className.toString() : '').toLowerCase();
  const bg    = el => { try { return win.getComputedStyle(el).backgroundColor; } catch (e) { return ''; } };

  // Classificador. Sempre devolve um rótulo (nunca null): tudo aparece no mapa.
  function classify(el) {
    const id = idof(el), cls = clsof(el), tag = el.tagName;
    const style = el.getAttribute('style') || '';

    // ── IDs específicos dos templates PUC Minas ──
    if (id === 'topo' || id === 'geral') return { icon: '▦', label: 'Container' };
    if (id === 'banner') return { icon: '🖼', label: 'Banner' };
    if (id === 'faixa') return { icon: '🏷', label: 'Faixa' };
    if (id === 'breadcrumb') return { icon: '🧭', label: 'Trilha (breadcrumb)' };
    if (id === 'texto-introdutorio') return { icon: '📝', label: 'Texto introdutório' };
    if (id === 'texto-introducao-menu') return { icon: '🔠', label: 'Chamada do menu' };
    if (id === 'box-ajuda') return { icon: 'ℹ️', label: 'Box de ajuda' };
    if (id === 'box-video') return { icon: '▶', label: 'Vídeo (espaço)' };
    if (id === 'box-curriculum' || id === 'caixa-nome') return { icon: '👤', label: 'Caixa do professor' };
    if (id === 'menu-lateral') return { icon: '📂', label: 'Menu lateral' };
    if (id === 'menu-imagem') return { icon: '🖼', label: 'Imagem do menu' };
    if (/^menu-unid\d+$/.test(id)) return { icon: '📂', label: 'Menu da unidade' };
    if (id === 'conteudo') return { icon: '📄', label: 'Conteúdo principal' };
    if (id === 'nesta-sessao') return { icon: '🏷', label: 'Título "Nesta sessão"' };
    if (id === 'microfundamento') return { icon: '📘', label: 'Box microfundamento' };
    if (id === 'texto-exercicio-fixacao') return { icon: '✏️', label: 'Exercício de fixação' };
    if (id === 'atencao') return { icon: '⚠️', label: 'Caixa de atenção' };
    if (id === 'sessao' || id === 'box-imagem-texto') return { icon: '🖼📝', label: 'Imagem + texto' };
    if (id === 'box-principal') return { icon: '📋', label: 'Box de dados' };
    if (id === 'videogeral') return { icon: '▦', label: 'Grade de cards' };
    if (id === 'texto') return { icon: '📝', label: 'Texto' };
    if (/^mod\d+$/.test(id)) return { icon: '🃏', label: 'Card' };
    if (/^borda-box-unidade\d+$/.test(id)) return { icon: '📚', label: 'Bloco de unidade' };
    if (/^box-geral-unidade\d+$/.test(id)) return { icon: '📦', label: 'Coluna da unidade' };
    if (/^box-unidade\d+$/.test(id))       return { icon: '🔢', label: 'Número da unidade' };
    if (/^titulo-unid\d+$/.test(id))       return { icon: '📌', label: 'Título da unidade' };
    if (/^tema\d+-unid\d+$/.test(id))      return { icon: '📑', label: 'Tema da unidade' };
    if (/^atividade-unid\d+$/.test(id))    return { icon: '✏️', label: 'Link de atividade' };
    if (/^sintese-ref-unid\d+$/.test(id))  return { icon: '📋', label: 'Síntese e referências' };
    if (id === 'sintese')                  return { icon: '📋', label: 'Síntese' };

    // ── Classes específicas ──
    if (/\bpuv_box_info_compass\b/.test(cls))   return { icon: '🧭', label: 'Box informativo (bússola)' };
    if (/\bpuv_box_info_lightbulb\b/.test(cls)) return { icon: '💡', label: 'Box reflexão' };
    if (/\bpuv_box_info_\w+\b/.test(cls))       return { icon: '📌', label: 'Box informativo' };
    if (/\bcard\b/.test(cls)) return { icon: '🃏', label: 'Card' };
    if (/\bgrid-row\b/.test(cls)) return { icon: '▦', label: 'Linha (grid)' };
    if (/\bcol-(xs|sm|md|lg|xl)-/.test(cls)) return { icon: '▥', label: 'Coluna' };
    if (/\bcontent-box\b/.test(cls)) return { icon: '▦', label: 'Container' };

    // ── Tags / mídia ──
    if (tag === 'IMG') {
      return /border-radius:\s*50%/.test(style)
        ? { icon: '🖼', label: 'Foto (redonda)' } : { icon: '🖼', label: 'Imagem' };
    }
    if (tag === 'IFRAME') return { icon: '▶', label: 'Vídeo' };
    if (el.querySelector && el.querySelector('iframe') && !txt(el)) return { icon: '▶', label: 'Vídeo' };
    if (el.querySelector && el.querySelector('img') && !txt(el)) return { icon: '🖼', label: 'Imagem' };
    if (tag === 'TABLE') return { icon: '▦', label: 'Tabela' };
    if (tag === 'UL' || tag === 'OL') return { icon: '•', label: 'Lista' };
    if (/^H[1-6]$/.test(tag)) return { icon: '🔤', label: 'Título' };
    if (tag === 'HR') return { icon: '—', label: 'Separador' };
    if (tag === 'A') return { icon: '🔗', label: 'Link' };
    if (tag === 'BUTTON') return { icon: '🔘', label: 'Botão' };
    if (tag === 'P') return { icon: '¶', label: 'Parágrafo' };

    // ── Cores de fundo conhecidas (catálogo antigo) ──
    if (style.includes('border') && style.includes('#4d4961'))
      return { icon: '📚', label: 'Box de unidade' };
    const b = bg(el);
    if (b === 'rgb(77, 73, 97)')    return { icon: '📚', label: 'Box de unidade' };
    if (b === 'rgb(43, 165, 136)')  return { icon: '🏷', label: 'Faixa' };
    if (b === 'rgb(255, 127, 80)')  return { icon: '🏷', label: 'Faixa (destaque)' };
    if (b === 'rgb(53, 65, 73)')    return { icon: '🏷', label: 'Faixa - Título' };
    if (b === 'rgb(114, 166, 142)') return { icon: '🔗', label: 'Botão de menu' };
    if (b === 'rgb(239, 239, 239)') return { icon: '📄', label: 'Bloco de texto' };
    if (b === 'rgb(223, 236, 231)') return { icon: '📋', label: 'Ficha da disciplina' };

    // ── Fallback genérico: nada fica de fora ──
    const hasBg = b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent';
    if (hasElementChildren(el) && (hasBg || /border|background/.test(style)))
      return { icon: '📦', label: 'Caixa' };
    if (hasElementChildren(el)) return { icon: '▭', label: 'Bloco' };
    if (txt(el)) return { icon: '📝', label: 'Texto' };
    return { icon: '▫', label: 'Elemento' };
  }

  // Tem pelo menos um filho-elemento que valha a pena mostrar?
  function hasElementChildren(el) {
    return [...el.children].some(c => c.nodeType === 1 && !trivial(c));
  }
  // Ruído estrutural que nunca vira linha: spans, <br>, scripts, espaçadores e vazios anônimos.
  function trivial(el) {
    const t = el.tagName;
    if (t === 'BR' || t === 'SPAN' || t === 'SCRIPT' || t === 'STYLE') return true;
    if (/^espaco/.test(idof(el))) return true;
    if (t === 'P' && !txt(el) && !(el.querySelector && el.querySelector('img,iframe'))) return true;
    const empty = !txt(el) && !(el.querySelector && el.querySelector('img,iframe')) && !el.children.length;
    if (empty && !el.id) return true;
    return false;
  }
  // Folha: aparece como UM item e a varredura não desce nela.
  function isLeaf(el) {
    const id = idof(el), cls = clsof(el), tag = el.tagName;
    if (['P','H1','H2','H3','H4','H5','H6','IMG','HR','UL','OL','TABLE','A','BUTTON','IFRAME','FIGURE'].includes(tag)) return true;
    if (id === 'sessao' || id === 'box-imagem-texto') return true;   // linha imagem+texto: 1 item
    if (/\bpuv_box_info_/.test(cls)) return true;                    // box informativo: 1 item
    if (el.querySelector && el.querySelector('iframe') && !txt(el)) return true; // wrapper só de vídeo
    if (!hasElementChildren(el)) return true;                        // sem filhos mapeáveis
    return false;
  }

  // Preview da linha: texto; senão host do vídeo; senão alt da imagem.
  function previewOf(el) {
    const t = txt(el).slice(0, 45);
    if (t) return t;
    const ifr = el.tagName === 'IFRAME' ? el : (el.querySelector && el.querySelector('iframe'));
    if (ifr) { try { return '▶ ' + new URL(ifr.src, doc.baseURI).hostname; } catch (e) { return 'vídeo incorporado'; } }
    const im = el.tagName === 'IMG' ? el : (el.querySelector && el.querySelector('img'));
    if (im) return (im.getAttribute('alt') || '').slice(0, 45) || 'imagem';
    return '';
  }

  const MAX_DEPTH = 12;
  const items = [];
  (function collect(parent, depth) {
    [...parent.children].forEach(el => {
      if (el.nodeType !== 1 || trivial(el)) return;
      const cls = classify(el);
      const leaf = isLeaf(el);
      items.push({ el, depth, icon: cls.icon, label: cls.label, preview: leaf ? previewOf(el) : '' });
      if (!leaf && depth < MAX_DEPTH) collect(el, depth + 1);
    });
  })(body, 0);

  if (!items.length) { alert('Nenhum bloco reconhecido nesta página.'); return; }

  doc.documentElement.style.cursor = 'pointer';

  let selected = null, actionsRow = null, activeRow = null;
  let dragRow = null, dragEl = null, mKey = false;
  const pulseStyle = doc.createElement('style');
  pulseStyle.textContent = '@keyframes __svcMapPulse{0%,100%{box-shadow:0 0 0 3px #22c55e,0 0 6px 2px rgba(34,197,94,.45)}50%{box-shadow:0 0 0 6px #22c55e,0 0 24px 10px rgba(34,197,94,.9)}}'
    + ' iframe{pointer-events:none!important}';   // deixa o clique no vídeo "atravessar" para o <p> que o envolve
  (doc.head || doc.documentElement).appendChild(pulseStyle);
  function paint(el, color, strong) {
    if (!el) return;
    el.__mo = el.style.outline; el.__moo = el.style.outlineOffset;
    el.__mbs = el.style.boxShadow; el.__man = el.style.animation;
    el.style.outline = (strong ? '3px' : '2px') + ' solid ' + color;
    el.style.outlineOffset = '2px';
    if (strong) {
      el.style.boxShadow = '0 0 0 3px ' + color + ', 0 0 16px 6px ' + color + 'aa';
      el.style.animation = '__svcMapPulse .8s ease-in-out 3';
    } else {
      el.style.boxShadow = '0 0 0 2px ' + color;
    }
  }
  function unpaint(el) {
    if (!el) return;
    el.style.outline = el.__mo || ''; el.style.outlineOffset = el.__moo || '';
    el.style.boxShadow = el.__mbs || ''; el.style.animation = el.__man || '';
    delete el.__mo; delete el.__moo; delete el.__mbs; delete el.__man;
  }
  function flash(msg) {
    const t = document.createElement('div'); t.textContent = msg;
    Object.assign(t.style, { position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
      background:'#166534', color:'#fff', padding:'10px 18px', borderRadius:'8px', font:'13px system-ui',
      zIndex:'2147483647', boxShadow:'0 2px 10px rgba(0,0,0,.4)' });
    document.body.appendChild(t); setTimeout(() => t.remove(), 2000);
  }
  function cleanHTML(html) {
    const tmp = doc.createElement('div'); tmp.innerHTML = html;
    tmp.querySelectorAll('script').forEach(n => n.remove());
    tmp.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    tmp.querySelectorAll('[data-mce-selected],[data-mce-bogus]').forEach(n => { n.removeAttribute('data-mce-selected'); n.removeAttribute('data-mce-bogus'); });
    return tmp.innerHTML;
  }
  function dupe(el, sourceRow) {
    const html = cleanHTML(el.outerHTML);
    let clone = null;
    const run = () => { el.insertAdjacentHTML('afterend', html); clone = el.nextElementSibling; };
    if (ed.undoManager && ed.undoManager.transact) ed.undoManager.transact(run); else run();
    if (ed.nodeChanged) ed.nodeChanged();
    if (ed.fire) ed.fire('input');
    if (ed.setDirty) ed.setDirty(true);
    flash('✓ Bloco duplicado! (Ctrl+Z desfaz)');
    if (!clone) return;
    if (actionsRow) { actionsRow.remove(); actionsRow = null; }
    // Linha da cópia entra logo abaixo do original, marcada em vermelho e com ✕
    const cls = classify(clone) || { icon: '📄', label: 'Bloco' };
    const dupRow = buildRow({ el: clone, icon: cls.icon, label: cls.label, preview: txt(clone).slice(0, 45), depth: sourceRow.__depth || 0, isDup: true });
    sourceRow.insertAdjacentElement('afterend', dupRow);
    clone.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function copyHtml(el) {
    const html = cleanHTML(el.outerHTML);
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(html).then(() => flash('📋 HTML copiado!'), () => flash('Não consegui copiar.'));
    else flash('Clipboard indisponível.');
  }

  // ── Integração com o Canvas Studio (sem API: dispara o popup nativo do editor) ──
  // Coloca o cursor do editor logo DEPOIS do elemento, pra o vídeo do Studio cair colado abaixo dele.
  function placeCursorAfter(el) {
    try {
      const rng = doc.createRange();
      rng.setStartAfter(el); rng.collapse(true);
      ed.selection.setRng(rng);
      if (ed.nodeChanged) ed.nodeChanged();
    } catch (e) {
      try { ed.selection.select(el); ed.selection.collapse(false); } catch (_) {}
    }
  }
  // Coloca o cursor DENTRO de um nó (no fim do conteúdo dele).
  function placeCursorInside(node) {
    try {
      const rng = doc.createRange();
      rng.selectNodeContents(node);
      rng.collapse(false);
      ed.selection.setRng(rng);
      if (ed.nodeChanged) ed.nodeChanged();
    } catch (e) {}
  }
  // Acha a área "revelável" do bloco: o conteúdo escondido de um <details> (#revelar).
  function findRevealArea(el) {
    if (!el) return null;
    if (idof(el) === 'revelar') return el;
    const byId = el.querySelector && el.querySelector('#revelar, [id^="revelar"]');
    if (byId) return byId;
    const det = el.tagName === 'DETAILS' ? el : (el.querySelector && el.querySelector('details'));
    if (det) return [...det.children].find(c => c.tagName !== 'SUMMARY') || det;
    return null;
  }
  // Quando um vídeo entrar na área escondida, recolhe o <details> de novo (vídeo fica oculto).
  function collapseWhenVideoArrives(det, reveal) {
    if (!det || !reveal || typeof MutationObserver === 'undefined') return;
    const obs = new MutationObserver(() => {
      if (reveal.querySelector('iframe')) {
        det.removeAttribute('open');
        if (ed.setDirty) ed.setDirty(true);
        obs.disconnect();
      }
    });
    obs.observe(reveal, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 180000);   // não observa pra sempre
  }
  // Centraliza o vídeo do Studio (que entra alinhado à esquerda por padrão).
  function centerVideo(iframe) {
    try {
      iframe.style.display = 'block';
      iframe.style.marginLeft = 'auto';
      iframe.style.marginRight = 'auto';
      const p = iframe.closest && iframe.closest('p');
      if (p && body.contains(p)) p.style.textAlign = 'center';
      if (ed.setDirty) ed.setDirty(true);
    } catch (e) {}
  }
  // Cria a linha do vídeo recém-inserido pelo Studio no painel do mapa.
  function addVideoRow(iframe, sourceRow, depth) {
    let videoEl = iframe;
    const p = iframe.closest && iframe.closest('p');
    if (p && body.contains(p)) videoEl = p;
    centerVideo(iframe);                                        // centraliza por padrão
    if (items.find(it => it.el === videoEl)) return;            // já listado
    const preview = previewOf(videoEl);
    const row = buildRow({ el: videoEl, icon: '▶', label: 'Vídeo', preview, depth: depth || 0, isDup: true, tag: 'novo' });
    if (sourceRow && sourceRow.parentNode) sourceRow.insertAdjacentElement('afterend', row);
    else panel.appendChild(row);
    items.push({ el: videoEl, row, depth: depth || 0, icon: '▶', label: 'Vídeo', preview });
    try { videoEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    flash('▶ Vídeo adicionado ao mapa!');
  }
  // Observa o editor e, quando o Studio inserir um vídeo novo, cria a linha dele no mapa.
  function watchForStudioVideo(sourceRow, depth) {
    if (typeof MutationObserver === 'undefined') return;
    const before = new Set([...body.querySelectorAll('iframe')]);
    const obs = new MutationObserver(() => {
      const fresh = [...body.querySelectorAll('iframe')].find(f => !before.has(f));
      if (!fresh) return;
      obs.disconnect();
      addVideoRow(fresh, sourceRow, depth);
    });
    obs.observe(body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 180000);
  }
  // Acha um gatilho dentro de `root` cujo rótulo (aria-label/title/texto) bate com `re`.
  // NÃO inclui <a>: evita clicar no link "Studio" da navegação lateral do Canvas (que sai da página).
  function findIn(root, re, useText) {
    const sel = 'button,[role="button"],[role="menuitem"],.tox-tbtn,.tox-mbtn,.tox-collection__item';
    const hit = s => s && re.test(s);
    return [...root.querySelectorAll(sel)].find(b =>
      hit(b.getAttribute('aria-label')) || hit(b.getAttribute('title')) || (useText && hit((b.textContent || '').trim())));
  }
  // Item "Studio" do menu flutuante do editor (renderiza em .tox-tinymce-aux, fora do .tox-tinymce).
  function findStudioMenuItem() {
    return [...document.querySelectorAll('.tox-collection__item,[role="menuitem"]')].find(it => {
      const s = (it.getAttribute('aria-label') || it.getAttribute('title') || it.textContent || '').trim();
      return /studio/i.test(s);
    });
  }
  // Tenta abrir o popup do Studio a partir da barra do editor. cb(true) se disparou algo.
  function tryOpenStudio(cb) {
    const tox = document.querySelector('.tox-tinymce') || document.body;
    // 1) Studio já visível como botão/menu na barra do editor.
    const direct = findIn(tox, /studio/i, true);
    if (direct) { direct.click(); return cb(true); }
    // 2) Abre o menu de apps/ferramentas (ícone de plug) DENTRO da barra do editor.
    const apps = findIn(tox, /\b(apps?|aplicativ|ferramentas?|tools?|plugins?|external)\b/i, false);
    if (!apps) return cb(false);
    apps.click();
    // 3) O item "Studio" aparece no menu flutuante logo depois — procura por alguns instantes.
    let tries = 0;
    (function poll() {
      const item = findStudioMenuItem();
      if (item) { item.click(); return cb(true); }
      if (++tries > 25) return cb(false);
      setTimeout(poll, 120);
    })();
  }
  function studioInsert(el, sourceRow) {
    if (ed.focus) ed.focus();
    const reveal = findRevealArea(el);
    let rowDepth = (sourceRow && sourceRow.__depth) || 0;
    if (reveal) {
      const det = (reveal.closest && reveal.closest('details')) || (reveal.tagName === 'DETAILS' ? reveal : null);
      if (det && !det.hasAttribute('open')) det.setAttribute('open', 'open');   // abre pra poder inserir dentro
      const target = [...reveal.querySelectorAll('p')].find(p => !txt(p)) || reveal;
      placeCursorInside(target);
      if (det) collapseWhenVideoArrives(det, reveal);
      rowDepth += 1;
    } else {
      placeCursorAfter(el);
    }
    watchForStudioVideo(sourceRow, rowDepth);
    tryOpenStudio(ok => {
      const onde = reveal ? 'dentro do bloco (vai ficar escondido)' : 'colado abaixo deste bloco';
      flash(ok
        ? '🎬 Studio aberto — escolha o vídeo; ele entra ' + onde + '.'
        : 'Cursor posicionado ' + (reveal ? 'dentro do bloco' : 'abaixo do bloco') + '. Clique no botão Studio na barra do editor.');
    });
  }

  const panel = document.createElement('div');
  Object.assign(panel.style, { position:'fixed', top:'0', left:'0', width:'300px', maxHeight:'100vh',
    overflowY:'auto', background:'#1e1e2e', color:'#e2e8f0', font:'12px system-ui,sans-serif',
    zIndex:'2147483647', boxShadow:'2px 0 12px rgba(0,0,0,.5)' });

  const head = document.createElement('div');
  Object.assign(head.style, { position:'sticky', top:'0', background:'#11111b', padding:'10px 12px',
    display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #313244' });
  head.innerHTML = '<b>🗺 Mapa de elementos</b>';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, { background:'transparent', border:'none', color:'#e2e8f0', cursor:'pointer', fontSize:'14px' });
  closeBtn.onclick = () => cleanup();
  head.appendChild(closeBtn);
  panel.appendChild(head);

  const hint = document.createElement('div');
  Object.assign(hint.style, { padding: '3px 12px 5px', fontSize: '10px', opacity: '.4', background: '#11111b', borderBottom: '1px solid #313244' });
  hint.textContent = 'Clique num elemento da página para achá-lo aqui · Segure M + arraste para reordenar';
  panel.appendChild(hint);

  const dropLine = document.createElement('div');
  Object.assign(dropLine.style, { height: '2px', background: '#22c55e', margin: '0', display: 'none', pointerEvents: 'none' });

  const editorLine = doc.createElement('div');
  Object.assign(editorLine.style, { height: '3px', background: '#22c55e', margin: '2px 0', borderRadius: '2px',
    boxShadow: '0 0 10px 3px rgba(34,197,94,0.6)', pointerEvents: 'none' });

  function cancelDrag() {
    if (dragRow) dragRow.style.opacity = '';
    document.body.style.cursor = '';
    panel.style.cursor = '';
    dragRow = null; dragEl = null;
    dropLine.style.display = 'none';
    editorLine.remove();
  }

  function onDragMove(e) {
    if (!dragRow) return;
    const rows = [...panel.querySelectorAll('[data-map-row]')].filter(r => r !== dragRow);
    let placed = false;
    for (const r of rows) {
      const rect = r.getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const before = e.clientY < rect.top + rect.height / 2;
        if (before) r.before(dropLine); else r.after(dropLine);
        dropLine.style.display = 'block';
        const targetEl = r.__el;
        if (targetEl && targetEl !== dragEl) {
          const wasPlaced = !!editorLine.parentNode;
          const prevSibling = editorLine.previousElementSibling;
          if (before) targetEl.before(editorLine); else targetEl.after(editorLine);
          // Rola o editor para mostrar onde o elemento vai cair, só quando muda de posição
          if (!wasPlaced || prevSibling !== editorLine.previousElementSibling) {
            editorLine.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
        placed = true;
        break;
      }
    }
    if (!placed) { dropLine.style.display = 'none'; editorLine.remove(); }
  }

  function onDragDrop() {
    if (!dragRow) return;
    const next = dropLine.nextElementSibling;
    const prev = dropLine.previousElementSibling;
    if (dropLine.parentNode === panel) {
      const targetRow = (next && next.dataset && next.dataset.mapRow) ? next
        : (prev && prev.dataset && prev.dataset.mapRow) ? prev : null;
      if (targetRow && targetRow !== dragRow) {
        const targetEl = targetRow.__el;
        const before = next === targetRow;
        if (targetEl && dragEl && targetEl !== dragEl) {
          const run = () => { if (before) targetEl.before(dragEl); else targetEl.after(dragEl); };
          if (ed.undoManager && ed.undoManager.transact) ed.undoManager.transact(run); else run();
          if (ed.nodeChanged) ed.nodeChanged();
          if (ed.fire) ed.fire('input');
          if (ed.setDirty) ed.setDirty(true);
          if (before) targetRow.before(dragRow); else targetRow.after(dragRow);
          flash('↕ Bloco movido! (Ctrl+Z desfaz)');
        }
      }
    }
    cancelDrag();
  }

  function buildRow({ el, icon, label, preview, depth, isDup, tag }) {
    const row = document.createElement('div');
    row.__depth = depth;
    row.__el = el;
    row.dataset.mapRow = '1';
    Object.assign(row.style, { padding: '6px 12px 6px ' + (12 + Math.min(depth, 7) * 12) + 'px', cursor: 'pointer',
      borderBottom: '1px solid #28283b', display: 'flex', alignItems: 'center', gap: '6px',
      background: isDup ? 'rgba(239,68,68,0.18)' : '' });
    const info = document.createElement('div');
    Object.assign(info.style, { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '2px' });
    info.innerHTML = '<span>' + icon + ' <b>' + label + '</b>' +
      (isDup ? ' <span style="color:#f87171;font-size:10px">(' + (tag || 'cópia') + ')</span>' : '') + '</span>' +
      (preview ? '<span style="opacity:.55;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + preview.replace(/</g, '&lt;') + '</span>' : '');
    row.appendChild(info);
    row.onmouseenter = () => { if (el !== selected && !dragRow) paint(el, '#f59e0b'); };
    row.onmouseleave = () => { if (el !== selected && !dragRow) unpaint(el); };
    row.onclick = () => {
      if (selected && selected !== el) unpaint(selected);
      selected = el;
      paint(selected, '#22c55e', true);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setActiveRow(row);
      openActions(row, el);
    };
    if (isDup) {
      const x = document.createElement('button');
      x.textContent = '✕';
      x.title = 'Excluir este bloco do editor';
      Object.assign(x.style, { background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '14px', flexShrink: '0', padding: '0 4px' });
      x.onclick = (e) => {
        e.stopPropagation();
        if (selected === el) { unpaint(el); selected = null; } else { unpaint(el); }
        const run = () => el.remove();
        if (ed.undoManager && ed.undoManager.transact) ed.undoManager.transact(run); else run();
        if (ed.nodeChanged) ed.nodeChanged();
        if (ed.fire) ed.fire('input');
        if (ed.setDirty) ed.setDirty(true);
        row.remove();
        flash('🗑 Cópia excluída.');
      };
      row.appendChild(x);
    }
    row.addEventListener('mousedown', e => {
      if (!mKey) return;
      e.preventDefault(); e.stopPropagation();
      dragRow = row; dragEl = el;
      row.style.opacity = '0.45';
      document.body.style.cursor = 'grabbing';
    });
    return row;
  }

  function openActions(afterRow, el) {
    if (actionsRow) actionsRow.remove();
    actionsRow = document.createElement('div');
    Object.assign(actionsRow.style, { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '6px 12px', background: '#181825' });
    const mk = (label, fn) => {
      const b = document.createElement('button'); b.textContent = label;
      Object.assign(b.style, { flex: '1 1 64px', minWidth: '64px', padding: '5px', borderRadius: '4px', border: 'none', cursor: 'pointer', background: '#313244', color: '#e2e8f0', fontSize: '11px' });
      b.onclick = fn; return b;
    };
    actionsRow.appendChild(mk('📑 Duplicar', () => dupe(el, afterRow)));
    actionsRow.appendChild(mk('📋 Copiar', () => copyHtml(el)));
    actionsRow.appendChild(mk('➕ Inserir', () => openInsertPicker(afterRow, el)));
    actionsRow.appendChild(mk('🎬 Studio', () => studioInsert(el, afterRow)));
    actionsRow.appendChild(mk('💾 Salvar', () => saveBlock(el)));
    afterRow.insertAdjacentElement('afterend', actionsRow);
  }

  // Limpeza para SALVAR um bloco da página: tira scripts e atributos do TinyMCE/Dark
  // Reader, mas MANTÉM ids/classes/styles (fazem parte da estrutura do template).
  function cleanForSave(html) {
    const tmp = doc.createElement('div'); tmp.innerHTML = html;
    tmp.querySelectorAll('script').forEach(n => n.remove());
    tmp.querySelectorAll('*').forEach(n => {
      [...n.attributes].forEach(a => {
        if (a.name.startsWith('data-mce-') || a.name.startsWith('data-darkreader-')) n.removeAttribute(a.name);
      });
    });
    return tmp.innerHTML;
  }

  function saveBlock(el) {
    const name = prompt('Nome do bloco salvo:');
    if (name === null) return;            // cancelado
    window.postMessage({ __svc: 'saveBlock', name: name || 'Bloco', html: cleanForSave(el.outerHTML) }, '*');
    flash('💾 Bloco salvo na biblioteca!');
  }

  // Escolhe qual bloco salvo inserir (substitui a barra de ações por uma lista)
  function openInsertPicker(afterRow, el) {
    if (actionsRow) { actionsRow.remove(); actionsRow = null; }
    if (!savedBlocks.length) { flash('Nenhum bloco salvo. Use 📦 Blocos salvos.'); return; }
    const pick = document.createElement('div');
    Object.assign(pick.style, { padding: '6px 12px', background: '#181825' });
    const title = document.createElement('div');
    title.textContent = 'Inserir qual bloco?';
    Object.assign(title.style, { fontSize: '11px', opacity: '.7', marginBottom: '4px' });
    pick.appendChild(title);
    savedBlocks.forEach(b => {
      const btn = document.createElement('button');
      btn.textContent = '📦 ' + b.name;
      Object.assign(btn.style, { display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px',
        marginBottom: '3px', borderRadius: '4px', border: 'none', cursor: 'pointer',
        background: '#313244', color: '#e2e8f0', fontSize: '11px',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
      btn.onclick = () => choosePosition(pick, afterRow, el, b.html);
      pick.appendChild(btn);
    });
    actionsRow = pick;                    // mantém a referência para o cleanup remover
    afterRow.insertAdjacentElement('afterend', pick);
  }

  // Pergunta antes/depois e insere
  function choosePosition(container, afterRow, el, html) {
    container.innerHTML = '';
    const t = document.createElement('div');
    t.textContent = 'Inserir onde?';
    Object.assign(t.style, { fontSize: '11px', opacity: '.7', marginBottom: '4px' });
    container.appendChild(t);
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '6px' });
    const mkb = (label, pos) => {
      const b = document.createElement('button'); b.textContent = label;
      Object.assign(b.style, { flex: '1', padding: '5px', borderRadius: '4px', border: 'none', cursor: 'pointer', background: '#313244', color: '#e2e8f0', fontSize: '11px' });
      b.onclick = () => insertSnippet(afterRow, el, html, pos); return b;
    };
    row.appendChild(mkb('⬆ Antes', 'before'));
    row.appendChild(mkb('⬇ Depois', 'after'));
    container.appendChild(row);
  }

  function insertSnippet(afterRow, el, html, pos) {
    let inserted = null;
    const run = () => {
      el.insertAdjacentHTML(pos === 'before' ? 'beforebegin' : 'afterend', html);
      inserted = pos === 'before' ? el.previousElementSibling : el.nextElementSibling;
    };
    if (ed.undoManager && ed.undoManager.transact) ed.undoManager.transact(run); else run();
    if (ed.nodeChanged) ed.nodeChanged();
    if (ed.fire) ed.fire('input');
    if (ed.setDirty) ed.setDirty(true);
    flash('✓ Bloco inserido! (Ctrl+Z desfaz)');
    if (actionsRow) { actionsRow.remove(); actionsRow = null; }
    if (!inserted) return;
    // Cria uma linha no painel para o bloco recém-inserido (marcada "novo", removível)
    const cls = classify(inserted) || { icon: '📄', label: 'Bloco' };
    const item = items.find(it => it.el === el);
    const depth = item ? item.depth : (afterRow.__depth || 0);
    const newRow = buildRow({ el: inserted, icon: cls.icon, label: cls.label, preview: txt(inserted).slice(0, 45), depth, isDup: true, tag: 'novo' });
    if (pos === 'before') afterRow.insertAdjacentElement('beforebegin', newRow);
    else afterRow.insertAdjacentElement('afterend', newRow);
    items.push({ el: inserted, row: newRow, depth, icon: cls.icon, label: cls.label, preview: txt(inserted).slice(0, 45) });
    inserted.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function setActiveRow(row) {
    if (activeRow && activeRow !== row) activeRow.style.background = activeRow.__origBg || '';
    activeRow = row;
    if (row) { row.__origBg = row.style.background; row.style.background = 'rgba(34,197,94,0.15)'; }
  }

  function selectRowFromEditor(item) {
    if (selected && selected !== item.el) unpaint(selected);
    selected = item.el;
    paint(selected, '#22c55e', true);
    setActiveRow(item.row);
    item.row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    openActions(item.row, item.el);
  }

  function onEditorClick(e) {
    let target = e.target;
    while (target && target !== body) {
      const item = items.find(it => it.el === target);
      if (item) { selectRowFromEditor(item); break; }
      target = target.parentElement;
    }
  }
  body.addEventListener('click', onEditorClick, true);

  items.forEach(it => {
    it.row = buildRow({ el: it.el, icon: it.icon, label: it.label, preview: it.preview, depth: it.depth, isDup: false });
    panel.appendChild(it.row);
  });

  function onKey(e) {
    if (e.key === 'Escape') { cleanup(); return; }
    if (e.key === 'Delete' && selected) {
      e.preventDefault();
      const el = selected;
      const item = items.find(it => it.el === el);
      unpaint(el); selected = null;
      if (activeRow) { activeRow.style.background = activeRow.__origBg || ''; activeRow = null; }
      if (actionsRow) { actionsRow.remove(); actionsRow = null; }
      if (item && item.row) item.row.remove();
      const run = () => el.remove();
      if (ed.undoManager && ed.undoManager.transact) ed.undoManager.transact(run); else run();
      if (ed.nodeChanged) ed.nodeChanged();
      if (ed.fire) ed.fire('input');
      if (ed.setDirty) ed.setDirty(true);
      flash('🗑 Bloco excluído. (Ctrl+Z desfaz)');
      return;
    }
    if (e.key === 'm' || e.key === 'M') { mKey = true; panel.style.cursor = 'grab'; doc.documentElement.style.cursor = 'grab'; }
  }
  function onKeyUp(e) {
    if (e.key === 'm' || e.key === 'M') { mKey = false; panel.style.cursor = ''; doc.documentElement.style.cursor = 'pointer'; cancelDrag(); }
  }
  function cleanup() {
    items.forEach(it => unpaint(it.el));
    unpaint(selected);
    doc.documentElement.style.cursor = '';
    pulseStyle.remove();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('mousemove', onDragMove, true);
    document.removeEventListener('mouseup', onDragDrop, true);
    doc.removeEventListener('keydown', onKey, true);
    body.removeEventListener('click', onEditorClick, true);
    cancelDrag();
    panel.remove();
    window.__svcMapCleanup = null;
  }
  window.__svcMapCleanup = cleanup;
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKeyUp, true);
  doc.addEventListener('keydown', onKey, true);
  document.addEventListener('mousemove', onDragMove, true);
  document.addEventListener('mouseup', onDragDrop, true);
  document.body.appendChild(panel);
}

// ── Checklist de publicação (multi-curso) ────────────────────────────

const CHECKLIST_ITEMS = [
  { id: 'novos-videos', name: 'Módulo "Novos Vídeos"',   icon: '🎬' },
  { id: 'lorem-ipsum',  name: 'Lorem Ipsum nas páginas', icon: '📄' },
  { id: 'paginas-sem-video', name: 'Páginas sem vídeo',  icon: '▶️' },
  { id: 'avisos',       name: 'Avisos antigos',           icon: '📢' },
  { id: 'foruns',       name: 'Fóruns antigos',           icon: '💬' },
  { id: 'testes',       name: 'Testes e pontuações',      icon: '📊' },
  { id: 'paginas-nao-publicadas', name: 'Páginas não publicadas', icon: '📌' },
  { id: 'requisitos-conclusao', name: 'Itens sem requisito de conclusão', icon: '⚙️' },
  { id: 'links',        name: 'Links quebrados',          icon: '🔗' },
];

function clEsc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseCourseIds(text) {
  return [...new Set(
    text.split(/[\n,\s]+/).map(s => s.trim()).filter(s => /^\d+$/.test(s))
  )];
}

function buildCourseCard(courseId) {
  const card = document.createElement('div');
  card.className = 'cl-course-card';
  card.id = 'cl-course-' + courseId;

  const header = document.createElement('div');
  header.className = 'cl-course-header';
  header.innerHTML =
    `<span class="cl-course-toggle" id="cl-toggle-${courseId}">▶</span>
     <span class="cl-course-id">Curso #${clEsc(courseId)}</span>
     <span class="cl-course-badge" id="cl-badge-${courseId}"><span class="spinner-sm"></span></span>`;

  const body = document.createElement('div');
  body.className = 'cl-course-body';
  body.id = 'cl-body-' + courseId;
  body.style.display = 'none';

  CHECKLIST_ITEMS.forEach(item => {
    const row = document.createElement('div');
    row.className = 'cl-check-row';
    row.innerHTML =
      `<span class="cl-check-row-icon">${item.icon}</span>
       <span class="cl-check-row-name">${item.name}</span>
       <span class="cl-check-row-status" id="cl-st-${courseId}-${item.id}"><span class="spinner-sm"></span></span>`;
    body.appendChild(row);

    const detail = document.createElement('div');
    detail.className = 'cl-check-detail-row';
    detail.id = `cl-dt-${courseId}-${item.id}`;
    detail.style.display = 'none';
    body.appendChild(detail);
  });

  header.addEventListener('click', () => {
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    $('cl-toggle-' + courseId)?.classList.toggle('open', !open);
  });

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function setCourseCheck(courseId, checkId, status, detail) {
  const stEl = $(`cl-st-${courseId}-${checkId}`);
  const dtEl = $(`cl-dt-${courseId}-${checkId}`);
  if (!stEl) return;

  if (status === 'loading') {
    stEl.innerHTML = '<span class="spinner-sm"></span>';
  } else {
    stEl.textContent = status === 'ok' ? '✅' : status === 'warn' ? '⚠️' : status === 'error' ? '❌' : '–';
  }

  if (detail) {
    const lines = Array.isArray(detail) ? detail : [detail];
    dtEl.innerHTML = lines.map(l => `<div>${clEsc(l)}</div>`).join('');
    dtEl.style.display = 'block';
  } else {
    dtEl.style.display = 'none';
  }

  updateCourseBadge(courseId);
}

function updateCourseBadge(courseId) {
  const badge = $('cl-badge-' + courseId);
  const card  = $('cl-course-' + courseId);
  if (!badge || !card) return;

  let loading = false, warn = false, error = false;
  CHECKLIST_ITEMS.forEach(item => {
    const st = $(`cl-st-${courseId}-${item.id}`);
    if (!st) return;
    if (st.querySelector('.spinner-sm')) loading = true;
    else if (st.textContent === '⚠️')   warn  = true;
    else if (st.textContent === '❌')   error = true;
  });

  if (loading) {
    badge.innerHTML = '<span class="spinner-sm"></span>';
    card.className  = 'cl-course-card';
  } else if (error) {
    badge.textContent = '❌';
    card.className    = 'cl-course-card cl-course-error';
  } else if (warn) {
    badge.textContent = '⚠️';
    card.className    = 'cl-course-card cl-course-warn';
  } else {
    badge.textContent = '✅';
    card.className    = 'cl-course-card cl-course-ok';
  }
}

// Todos os checks (menos o de links) num único executeScript por curso
async function clRunCourseChecks(tabId, courseId, opts) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (courseId, includeLoremIpsum, includePageNaoPublicadas, includeRequisitosConclusao, includeSemVideo, noVideoExceptions) => {
      const delay = ms => new Promise(r => setTimeout(r, ms));

      // Fetch com proteção de rate limit do Canvas
      async function safeFetch(url, opts = {}) {
        for (let attempt = 0; attempt <= 2; attempt++) {
          const res = await fetch(url, opts);
          if (res.status === 429) {
            await delay(2000 * (attempt + 1));
            continue;
          }
          const remaining = parseFloat(res.headers.get('X-Rate-Limit-Remaining') || '999');
          if (remaining < 30) await delay(800);
          return res;
        }
        throw new Error('Rate limit esgotado após 3 tentativas');
      }

      async function fetchAll(url) {
        const out = []; let next = url;
        while (next) {
          const res = await safeFetch(next);
          if (!res.ok) throw new Error(`API error: ${res.status}`);
          const data = await res.json();
          if (Array.isArray(data)) out.push(...data);
          const m = (res.headers.get('Link') || '').match(/<([^>]+)>;\s*rel="next"/);
          next = m ? m[1] : null;
        }
        return out;
      }

      // Módulos e seus itens são usados por vários checks — busca uma vez só,
      // senão cada check refaz as mesmas dezenas de chamadas e estoura o rate limit.
      let _modules = null;
      async function getModules() {
        if (!_modules) _modules = await fetchAll(`/api/v1/courses/${courseId}/modules?per_page=100`);
        return _modules;
      }

      let _modulesWithItems = null;
      async function getModulesWithItems() {
        if (_modulesWithItems) return _modulesWithItems;
        const acc = [];
        for (const mod of await getModules()) {
          acc.push({ mod, items: await fetchAll(`/api/v1/courses/${courseId}/modules/${mod.id}/items?per_page=100`) });
        }
        _modulesWithItems = acc;
        return acc;
      }

      // Páginas alcançáveis pelo aluno: só as vinculadas a algum módulo.
      // O índice /pages traz também páginas soltas — rascunhos removidos do
      // módulo, mas ainda existentes no curso — que não devem ser auditadas.
      // Dedupe por page_url: a mesma página pode estar em mais de um módulo.
      async function getModulePages() {
        const seen = new Map();
        for (const { mod, items } of await getModulesWithItems()) {
          for (const item of items) {
            if (item.type !== 'Page' || !item.page_url || seen.has(item.page_url)) continue;
            seen.set(item.page_url, { url: item.page_url, title: item.title, module: mod.name });
          }
        }
        return [...seen.values()];
      }

      // O corpo de cada página é o download mais caro do checklist e serve a mais
      // de um check (Lorem Ipsum, vídeo) — baixa uma vez só. `failed` marca o que
      // não deu para ler, para nenhum check tratar erro como resultado válido.
      let _pageBodies = null;
      async function getModulePagesWithBody() {
        if (_pageBodies) return _pageBodies;
        const pages = await getModulePages();
        const acc = [];
        for (let i = 0; i < pages.length; i += 3) {        // lotes de 3 para não sobrecarregar
          const results = await Promise.all(pages.slice(i, i + 3).map(async p => {
            try {
              const res = await safeFetch(`/api/v1/courses/${courseId}/pages/${p.url}`);
              if (!res.ok) return { ...p, failed: true };
              const d = await res.json();
              return { ...p, title: d.title || p.title, itemTitle: p.title, body: d.body || '' };
            } catch { return { ...p, failed: true }; }
          }));
          acc.push(...results);
          if (i + 3 < pages.length) await delay(150);      // pausa entre lotes
        }
        _pageBodies = acc;
        return acc;
      }

      // Só conta vídeo do próprio Canvas: player de mídia nativo (upload ou gravação
      // pelo editor) e embed do Studio — inclusive quando o iframe foi copiado de
      // outra página e colado aqui, já que a assinatura do src viaja junto.
      // Vídeo de terceiros (YouTube, Vimeo) e iframes que não são mídia (Padlet,
      // formulários) NÃO contam.
      const CANVAS_MEDIA_SRC = /media_objects_iframe|media_attachments_iframe|instructuremedia|custom_arc_media_id|\/media_objects\//i;
      function hasCanvasVideo(html) {
        if (!html) return false;
        try {
          const parsed = new DOMParser().parseFromString(html, 'text/html');
          // Player nativo, gravação pelo RCE ou comentário de mídia (formato antigo)
          if (parsed.querySelector('video, [data-media-id], [data-media_comment_id], [data-media-type="video"], .instructure_inline_media_comment')) return true;
          // iframe só vale se o src apontar para mídia do Canvas ou para o Studio
          return [...parsed.querySelectorAll('iframe')]
            .some(f => CANVAS_MEDIA_SRC.test(f.getAttribute('src') || ''));
        } catch (e) {
          return CANVAS_MEDIA_SRC.test(html);
        }
      }

      // Mesma regra do recuo dos módulos: comparação parcial, sem diferenciar maiúsculas.
      function isNoVideoException(title) {
        const t = (title || '').toLowerCase();
        return (noVideoExceptions || []).some(exc => {
          const e = exc.toLowerCase().trim();
          return e && t.includes(e);
        });
      }

      const out = {};

      // 1: Novos Vídeos
      try {
        const modules = await getModules();
        const mod = modules.find(m => {
          const n = m.name.toLowerCase()
            .replace(/[áàãâä]/g, 'a').replace(/[éèêë]/g, 'e')
            .replace(/[íìîï]/g, 'i').replace(/[óòõôö]/g, 'o').replace(/[úùûü]/g, 'u');
          return n.includes('novos videos');
        });
        if (!mod) { out.novosVideos = { found: false }; }
        else {
          const items = await fetchAll(`/api/v1/courses/${courseId}/modules/${mod.id}/items?per_page=100`);
          out.novosVideos = { found: true, name: mod.name, count: items.length };
        }
      } catch (e) { out.novosVideos = { error: e.message }; }

      // 2: Lorem Ipsum (apenas se habilitado)
      if (!includeLoremIpsum) {
        out.loremIpsum = { skipped: true };
      } else {
        try {
          const pages = await getModulePagesWithBody();
          const found = pages
            .filter(p => !p.failed && (p.body || '').toLowerCase().includes('lorem ipsum'))
            .map(p => p.title);
          out.loremIpsum = { found, scanned: pages.length };
        } catch (e) { out.loremIpsum = { error: e.message }; }
      }

      // 2b: Páginas sem vídeo (apenas se habilitado)
      if (!includeSemVideo) {
        out.semVideo = { skipped: true };
      } else {
        try {
          const pages = await getModulePagesWithBody();
          const found = [], excecoes = [];
          for (const p of pages) {
            if (p.failed) continue;
            if (isNoVideoException(p.title) || isNoVideoException(p.itemTitle)) { excecoes.push(p.title); continue; }
            if (!hasCanvasVideo(p.body)) found.push(p.title);
          }
          out.semVideo = { found, scanned: pages.length - excecoes.length, ignoradas: excecoes.length };
        } catch (e) { out.semVideo = { error: e.message }; }
      }

      // 3: Avisos
      try {
        const list = await fetchAll(`/api/v1/courses/${courseId}/discussion_topics?only_announcements=true&per_page=100`);
        out.avisos = { count: list.length, items: list.slice(0, 5).map(d => ({
          title:           d.title,
          created_at:      d.created_at      || null,
          delayed_post_at: d.delayed_post_at || null,
        })) };
      } catch (e) { out.avisos = { error: e.message }; }

      // 4: Fóruns
      try {
        const all = await fetchAll(`/api/v1/courses/${courseId}/discussion_topics?per_page=100`);
        const list = all.filter(d => !d.is_announcement);
        out.foruns = { count: list.length, titles: list.slice(0, 3).map(d => d.title) };
      } catch (e) { out.foruns = { error: e.message }; }

      // 5: Testes
      try {
        const [quizzes, assignments] = await Promise.all([
          fetchAll(`/api/v1/courses/${courseId}/quizzes?per_page=100`),
          fetchAll(`/api/v1/courses/${courseId}/assignments?per_page=100`),
        ]);
        const byQuizId = {};
        assignments.forEach(a => { if (a.quiz_id) byQuizId[a.quiz_id] = a; });
        out.testes = quizzes.map(q => {
          const a = byQuizId[q.id] || {};
          return {
            title:           q.title,
            question_count:  q.question_count  || 0,
            points_possible: q.points_possible || 0,
            published:   a.published   !== undefined ? a.published   : (q.published   || false),
            post_to_sis: a.post_to_sis !== undefined ? a.post_to_sis : false,
            shuffle_answers:  q.shuffle_answers === true,
            allowed_attempts: typeof q.allowed_attempts === 'number' ? q.allowed_attempts : null,
          };
        });
      } catch (e) { out.testes = { error: e.message }; }

      // 6: Páginas não publicadas nos módulos
      if (includePageNaoPublicadas) {
        try {
          const unpublished = [];

          for (const { mod, items } of await getModulesWithItems()) {
            const pageItems = items.filter(item => item.type === 'Page');

            for (let i = 0; i < pageItems.length; i += 5) {
              const batch = pageItems.slice(i, i + 5);
              const results = await Promise.all(batch.map(async item => {
                try {
                  const res = await safeFetch(`/api/v1/courses/${courseId}/pages/${item.page_url}`);
                  if (!res.ok) return null;
                  const page = await res.json();
                  return !page.published ? { module: mod.name, page: page.title } : null;
                } catch { return null; }
              }));
              unpublished.push(...results.filter(Boolean));
              if (i + 5 < pageItems.length) await delay(100);
            }
          }

          out.paginasNaoPublicadas = { unpublished };
        } catch (e) { out.paginasNaoPublicadas = { error: e.message }; }
      } else {
        out.paginasNaoPublicadas = { skipped: true };
      }

      // 7: Itens sem requisito de conclusão
      if (includeRequisitosConclusao) {
        try {
          const itemsWithoutRequirement = {};

          for (const { mod, items } of await getModulesWithItems()) {
            if (mod.published === false) continue;   // módulo oculto não aparece na tela
            // conta só os itens que aparecem na tela: ignora ocultos (published:false).
            // Itens excluídos não são retornados pela API de module items.
            const visiveis = items.filter(item => item.published !== false);
            const itemsWithoutReq = visiveis.filter(item => !item.completion_requirement);
            if (itemsWithoutReq.length > 0) {
              itemsWithoutRequirement[mod.name] = itemsWithoutReq.length;
            }
          }

          out.requisitosConclisao = { itemsWithoutRequirement };
        } catch (e) { out.requisitosConclisao = { error: e.message }; }
      } else {
        out.requisitosConclisao = { skipped: true };
      }

      return out;
    },
    args: [courseId, opts.lorem, opts.paginasNaoPublicadas, opts.requisitos, opts.semVideo, opts.noVideoExceptions],
  });
  return result[0]?.result || null;
}

function applyCourseResults(courseId, data, skipped = new Set()) {
  if (!data) {
    CHECKLIST_ITEMS.forEach(item => {
      if (item.id === 'links' || skipped.has(item.id)) return;
      setCourseCheck(courseId, item.id, 'error', 'Sem resposta da API');
    });
    return;
  }

  // 1: Novos Vídeos
  const nv = data.novosVideos;
  if (nv?.error)       setCourseCheck(courseId, 'novos-videos', 'error', 'Erro: ' + nv.error);
  else if (!nv?.found) setCourseCheck(courseId, 'novos-videos', 'ok',   'Módulo "Novos Vídeos" não encontrado');
  else if (nv.count === 0) setCourseCheck(courseId, 'novos-videos', 'ok', `Módulo "${nv.name}" vazio (0 vídeos)`);
  else                 setCourseCheck(courseId, 'novos-videos', 'ok', `${nv.count} vídeo${nv.count > 1 ? 's' : ''} encontrado${nv.count > 1 ? 's' : ''} em "${nv.name}"`);

  // 2: Lorem Ipsum
  const li = data.loremIpsum;
  if (!li?.skipped) {
    if (li?.error) {
      setCourseCheck(courseId, 'lorem-ipsum', 'error', 'Erro: ' + li.error);
    } else if (!li?.scanned) {
      setCourseCheck(courseId, 'lorem-ipsum', 'ok', 'Nenhuma página vinculada aos módulos');
    } else if (!li?.found?.length) {
      setCourseCheck(courseId, 'lorem-ipsum', 'ok', `Nenhuma página com Lorem Ipsum · ${li.scanned} página(s) dos módulos`);
    } else {
      const lines = li.found.slice(0, 5).map(t => `📄 ${t}`);
      if (li.found.length > 5) lines.push(`... e mais ${li.found.length - 5}`);
      setCourseCheck(courseId, 'lorem-ipsum', 'warn', [`${li.found.length} de ${li.scanned} página(s) dos módulos:`, ...lines]);
    }
  }

  // 2b: Páginas sem vídeo
  const sv = data.semVideo;
  if (!sv?.skipped) {
    const ignoradas = sv?.ignoradas ? ` · ${sv.ignoradas} na lista de exceções` : '';
    if (sv?.error) {
      setCourseCheck(courseId, 'paginas-sem-video', 'error', 'Erro: ' + sv.error);
    } else if (!sv?.scanned) {
      setCourseCheck(courseId, 'paginas-sem-video', 'ok', 'Nenhuma página a verificar' + ignoradas);
    } else if (!sv?.found?.length) {
      setCourseCheck(courseId, 'paginas-sem-video', 'ok', `${sv.scanned} página(s) com vídeo${ignoradas}`);
    } else {
      const lines = sv.found.slice(0, 5).map(t => `▶️ ${t}`);
      if (sv.found.length > 5) lines.push(`... e mais ${sv.found.length - 5}`);
      setCourseCheck(courseId, 'paginas-sem-video', 'warn', [`${sv.found.length} de ${sv.scanned} página(s) sem vídeo${ignoradas}:`, ...lines]);
    }
  }

  // 3: Avisos
  const av = data.avisos;
  if (av?.error) {
    setCourseCheck(courseId, 'avisos', 'error', 'Erro: ' + av.error);
  } else if (av.count === 0) {
    setCourseCheck(courseId, 'avisos', 'ok', 'Nenhum aviso');
  } else {
    const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : null;
    const lines = av.items.map(a => {
      const created = fmtDate(a.created_at);
      const delayed = fmtDate(a.delayed_post_at);
      const info    = delayed ? `criado ${created} · publica ${delayed}` : `criado ${created}`;
      return `📢 ${a.title} · ${info}`;
    });
    if (av.count > 5) lines.push(`... e mais ${av.count - 5}`);
    setCourseCheck(courseId, 'avisos', 'warn', [`${av.count} aviso(s):`, ...lines]);
  }

  // 4: Fóruns
  const fo = data.foruns;
  if (fo?.error) {
    setCourseCheck(courseId, 'foruns', 'error', 'Erro: ' + fo.error);
  } else if (fo.count === 0) {
    setCourseCheck(courseId, 'foruns', 'ok', 'Nenhum fórum');
  } else {
    const lines = fo.titles.map(t => `💬 ${t}`);
    if (fo.count > 3) lines.push(`... e mais ${fo.count - 3}`);
    setCourseCheck(courseId, 'foruns', 'warn', [`${fo.count} fórum(ns):`, ...lines]);
  }

  // 5: Testes
  applyTestesResult(courseId, data.testes);

  // 6: Páginas não publicadas
  const pnp = data.paginasNaoPublicadas;
  if (!pnp?.skipped) {
    if (pnp?.error) {
      setCourseCheck(courseId, 'paginas-nao-publicadas', 'error', 'Erro: ' + pnp.error);
    } else if (!pnp?.unpublished?.length) {
      setCourseCheck(courseId, 'paginas-nao-publicadas', 'ok', 'Nenhuma página não publicada');
    } else {
      setCourseCheck(courseId, 'paginas-nao-publicadas', 'warn', `${pnp.unpublished.length} página(s) não publicada(s)`);
    }
  }

  // 7: Itens sem requisito de conclusão
  const rc = data.requisitosConclisao;
  if (!rc?.skipped) {
    if (rc?.error) {
      setCourseCheck(courseId, 'requisitos-conclusao', 'error', 'Erro: ' + rc.error);
    } else {
      const itemsWithoutReq = rc?.itemsWithoutRequirement || {};
      const totalItens = Object.values(itemsWithoutReq).reduce((s, n) => s + n, 0);
      if (totalItens === 0) {
        setCourseCheck(courseId, 'requisitos-conclusao', 'ok', 'Todos os itens têm requisito de conclusão');
      } else {
        setCourseCheck(courseId, 'requisitos-conclusao', 'warn', `${totalItens} item${totalItens > 1 ? 'ns' : ''} sem requisito de conclusão`);
      }
    }
  }
}

// Regras de pontuação/publicação dos testes. Separado porque sai cedo em caso de
// erro — antes esse `return` estava no meio de applyCourseResults e deixava os
// checks seguintes presos no spinner quando /quizzes falhava.
function applyTestesResult(courseId, quizzes) {
  if (!quizzes || quizzes?.error) {
    setCourseCheck(courseId, 'testes', 'error', quizzes?.error ? 'Erro: ' + quizzes.error : 'Sem dados');
    return;
  }

  const issues = [];
  const tl = s => s.toLowerCase();

  const provaFinal = quizzes.find(q => tl(q.title).includes('prova final'));
  if (!provaFinal) {
    issues.push('Prova Final não encontrada');
  } else {
    if (provaFinal.points_possible !== 40) issues.push(`Prova Final: ${provaFinal.points_possible}pts (esperado: 40)`);
    if (provaFinal.question_count  !== 10) issues.push(`Prova Final: ${provaFinal.question_count} perguntas (esperado: 10)`);
    if (!provaFinal.published)             issues.push('Prova Final: não publicada');
    if (!provaFinal.post_to_sis)           issues.push('Prova Final: SIS não habilitado');
    if (!provaFinal.shuffle_answers)       issues.push('Prova Final: respostas não embaralhadas');
    if (provaFinal.allowed_attempts === 1) {
      issues.push('Prova Final: múltiplas tentativas desabilitadas');
    } else if (provaFinal.allowed_attempts != null && provaFinal.allowed_attempts !== 2) {
      const n = provaFinal.allowed_attempts === -1 ? 'ilimitadas' : provaFinal.allowed_attempts;
      issues.push(`Prova Final: ${n} tentativa(s) (esperado: 2)`);
    }
  }

  // Atividades = tudo com pontuação exceto a Prova Final (independente do nome)
  const atividades = quizzes.filter(q => q.points_possible > 0 && !tl(q.title).includes('prova final'));
  if (atividades.length === 0) {
    issues.push('Nenhuma atividade com pontuação encontrada (exceto Prova Final)');
  } else {
    const sumPts = atividades.reduce((s, a) => s + a.points_possible, 0);
    if (sumPts !== 60) issues.push(`Atividades: ${sumPts}pts (esperado: 60)`);
    atividades.forEach(a => {
      if (!a.published)   issues.push(`"${a.title}": não publicada`);
      if (!a.post_to_sis) issues.push(`"${a.title}": SIS não habilitado`);
    });
  }

  const atividadesPts = atividades.reduce((s, a) => s + a.points_possible, 0);
  const total = (provaFinal?.points_possible || 0) + atividadesPts;
  if (provaFinal && atividades.length && total !== 100) issues.push(`Total: ${total}pts (esperado: 100)`);

  if (issues.length === 0) {
    setCourseCheck(courseId, 'testes', 'ok', [
      `Prova Final: ${provaFinal.points_possible}pts · ${provaFinal.question_count} perguntas · ${provaFinal.allowed_attempts} tentativas · embaralhada`,
      `Atividades (${atividades.length}): ${atividadesPts}pts · Total: ${total}pts`,
    ]);
  } else {
    setCourseCheck(courseId, 'testes', 'warn', issues);
  }
}

async function clRunLinkCheck(tabId, courseId) {
  setCourseCheck(courseId, 'links', 'loading', 'Validando... (pode demorar)');
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (courseId) => {
        const rawCsrf = document.cookie.split(';').map(c => c.trim())
          .find(c => c.startsWith('_csrf_token='));
        const csrf = rawCsrf
          ? decodeURIComponent(rawCsrf.split('=').slice(1).join('='))
          : (document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '');

        await fetch(`/api/v1/courses/${courseId}/link_validation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({}),
        });

        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 3000));
          const res = await fetch(`/api/v1/courses/${courseId}/link_validation`);
          if (!res.ok) return { completed: false, failed: true };
          const data = await res.json();
          if (data.workflow_state === 'completed') {
            let totalBroken = 0;
            const brokenItems = [];
            const raw = data.results || {};
            const all = Array.isArray(raw) ? raw : Object.values(raw).flat().filter(Boolean);
            all.forEach(item => {
              const links = item.invalid_links || [];
              if (links.length) { totalBroken += links.length; brokenItems.push(`${item.name || item.title}: ${links.length} link(s)`); }
            });
            return { completed: true, totalBroken, brokenItems: brokenItems.slice(0, 5), more: Math.max(0, brokenItems.length - 5) };
          }
          if (data.workflow_state === 'failed') return { completed: false, failed: true };
        }
        return { completed: false, timeout: true };
      },
      args: [courseId],
    });

    const r = result[0]?.result;
    if (!r) { setCourseCheck(courseId, 'links', 'error', 'Sem resposta'); return; }
    if (!r.completed) {
      setCourseCheck(courseId, 'links', r.failed ? 'error' : 'warn',
        r.failed ? 'Falhou no servidor' : 'Tempo esgotado');
      return;
    }
    if (r.totalBroken === 0) {
      setCourseCheck(courseId, 'links', 'ok', 'Nenhum link quebrado');
    } else {
      const lines = [...r.brokenItems];
      if (r.more > 0) lines.push(`... e mais ${r.more} item(s)`);
      setCourseCheck(courseId, 'links', 'warn', [`${r.totalBroken} link(s) quebrado(s):`, ...lines]);
    }
  } catch (err) {
    setCourseCheck(courseId, 'links', 'error', 'Erro: ' + err.message);
  }
}

function clAutoExpand(courseId) {
  const badge = $('cl-badge-' + courseId);
  if (!badge || badge.querySelector('.spinner-sm')) return;
  if (badge.textContent === '⚠️' || badge.textContent === '❌') {
    const body = $('cl-body-' + courseId);
    if (body && body.style.display === 'none') {
      body.style.display = 'block';
      $('cl-toggle-' + courseId)?.classList.add('open');
    }
  }
}

async function runChecklist() {
  const courseIds = parseCourseIds($('cl-courses-input').value);
  if (!courseIds.length) {
    alert('Informe pelo menos um código de curso válido (somente números).');
    return;
  }

  const tabs   = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId  = tabs[0]?.id;
  const tabUrl = tabs[0]?.url || '';
  if (!tabUrl.includes('instructure.com')) {
    alert('Abra uma página do Canvas (instructure.com) antes de rodar o checklist.');
    return;
  }

  const opts = {
    lorem:                $('cl-toggle-lorem').checked,
    semVideo:             $('cl-toggle-video').checked,
    paginasNaoPublicadas: $('cl-toggle-paginas-nao-pub').checked,
    requisitos:           $('cl-toggle-requisitos').checked,
    noVideoExceptions:    S.canvasNoVideo || [],
  };
  const includeLinks = $('cl-toggle-links').checked;

  // Checks desligados ficam com "–" e não podem ser sobrescritos pelo caminho de erro
  const skipped = new Set();
  if (!opts.lorem)                skipped.add('lorem-ipsum');
  if (!opts.semVideo)             skipped.add('paginas-sem-video');
  if (!opts.paginasNaoPublicadas) skipped.add('paginas-nao-publicadas');
  if (!opts.requisitos)           skipped.add('requisitos-conclusao');
  if (!includeLinks)              skipped.add('links');

  $('btn-run-checklist').disabled = true;
  $('btn-run-checklist').innerHTML = '<span class="spinner"></span>Verificando...';

  const results  = $('checklist-results');
  const progress = $('cl-progress');
  results.innerHTML = '';
  progress.style.display = 'block';
  progress.textContent   = `0 / ${courseIds.length} cursos verificados`;

  courseIds.forEach(id => {
    results.appendChild(buildCourseCard(id));
    skipped.forEach(checkId => setCourseCheck(id, checkId, 'skip'));
  });

  let done = 0;
  await Promise.all(courseIds.map(async (id, index) => {
    // Escalonamento: cada curso começa 300ms depois do anterior
    if (index > 0) await new Promise(r => setTimeout(r, index * 300));
    try {
      const data = await clRunCourseChecks(tabId, id, opts);
      applyCourseResults(id, data, skipped);
    } catch (err) {
      CHECKLIST_ITEMS.forEach(item => {
        if (item.id === 'links' || skipped.has(item.id)) return;
        setCourseCheck(id, item.id, 'error', 'Erro: ' + err.message);
      });
    }
    done++;
    progress.textContent = `${done} / ${courseIds.length} cursos verificados${includeLinks ? ' (links pendentes)' : ''}`;
    if (!includeLinks) clAutoExpand(id);
  }));

  if (includeLinks) {
    for (const id of courseIds) {
      await clRunLinkCheck(tabId, id);
      clAutoExpand(id);
    }
  }

  const okCount = courseIds.filter(id => $('cl-badge-' + id)?.textContent === '✅').length;
  progress.textContent = `Concluído — ${okCount}/${courseIds.length} curso(s) sem pendências`;
  $('btn-run-checklist').disabled = false;
  $('btn-run-checklist').textContent = '▶  Rodar verificações';
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
    lastAlive:     saved.lastAlive     || null,
    accMs:         saved.accMs         || 0,
    currentRecord: saved.currentRecord || null,
    registros:     saved.registros     || [],
    suspended:     saved.suspended     || [],
    video_width:    saved.video_width    || 620,
    video_height:   saved.video_height   || 398,
    openrouter_key: saved.openrouter_key || '',
    uploading:      saved.uploading      || false,
    uploadResult:  saved.uploadResult  || null,
    savedLinks:    saved.savedLinks    || [],
    savedBlocks:   saved.savedBlocks   || [],
    sheetsEnabled:      saved.sheetsEnabled      || false,
    canvasExceptions:   saved.canvasExceptions   ?? DEFAULT_CANVAS_EXCEPTIONS,
    canvasNoVideo:      saved.canvasNoVideo      ?? DEFAULT_CANVAS_NO_VIDEO,
  };

  // Bindings estáticos
  $('btn-summary-close').addEventListener('click', () => { $('modal-summary').style.display = 'none'; });

  $('btn-start').addEventListener('click',   doStart);
  $('btn-pause').addEventListener('click',   doPause);
  $('btn-stop').addEventListener('click',    doStop);
  $('btn-suspend').addEventListener('click', doSuspend);
  $('combo-tipo').addEventListener('change', async () => {
    if (!S.running || !S.currentRecord) return;
    await persist({ currentRecord: { ...S.currentRecord, tipo_servico: $('combo-tipo').value } });
  });
  $('btn-add-link').addEventListener('click', doAddLink);
  $('toggle-sheets').addEventListener('change', async () => {
    await persist({ sheetsEnabled: $('toggle-sheets').checked });
    syncMain();
  });
  $('btn-sheets').addEventListener('click', doUpload);
  $('btn-sheets-help').addEventListener('click', () => show('help'));
  $('btn-save-webhook').addEventListener('click', async () => {
    const url = $('input-main-webhook').value.trim();
    if (!url) return;
    await persist({ webhook_url: url });
    $('input-main-webhook').value = '';
    syncMain();
  });
  $('input-main-webhook').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-save-webhook').click();
  });
  $('btn-edit-tipos').addEventListener('click', () => { buildEditTipos(); show('edit-tipos'); });
  $('btn-settings').addEventListener('click',   () => { buildSettings();  show('settings');  });
  $('btn-canvas').addEventListener('click',     () => { syncCanvasTools(); show('canvas');   });
  $('btn-back-canvas').addEventListener('click', () => show('main'));
  $('btn-back-help').addEventListener('click',  () => show('main'));
  $('btn-starters').addEventListener('click', doOpenStarters);
  $('btn-links').addEventListener('click', () => { buildLinks(); show('links'); });
  $('btn-back-links').addEventListener('click', () => show('settings'));
  $('btn-all-records').addEventListener('click', () => { buildAllRecords(); show('records'); });
  $('btn-back-records').addEventListener('click', () => show('main'));
  $('btn-canvas-indent').addEventListener('click', doApplyIndent);
  $('btn-canvas-dup').addEventListener('click', doDuplicateBlock);
  $('btn-canvas-move').addEventListener('click', doMoveBlocks);
  $('btn-canvas-map').addEventListener('click', doElementMap);
  $('btn-canvas-blocks').addEventListener('click', () => { buildBlocks(); show('blocks'); });
  $('btn-back-blocks').addEventListener('click', () => show('canvas'));
  $('btn-canvas-revisions').addEventListener('click', () => show('canvas-revisions'));
  $('btn-apply-revisions-filter').addEventListener('click', doFetchRevisions);
  $('btn-back-canvas-revisions').addEventListener('click', () => show('canvas'));
  $('btn-canvas-checklist').addEventListener('click', () => show('checklist'));
  $('btn-back-checklist').addEventListener('click', () => show('canvas'));
  $('btn-run-checklist').addEventListener('click', runChecklist);
  $('btn-cl-use-tab').addEventListener('click', async () => {
    const id = await getCanvasCourseId();
    if (!id) { alert('Nenhum curso Canvas detectado na aba ativa.'); return; }
    const input    = $('cl-courses-input');
    const existing = parseCourseIds(input.value);
    if (!existing.includes(id)) {
      input.value = (input.value.trim() ? input.value.trim() + '\n' : '') + id;
    }
  });
  $('btn-back-record-detail').addEventListener('click', () => {
    const from = $('btn-back-record-detail').dataset.from || 'main';
    show(from);
  });

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

  // Listener: upload concluído pelo service worker enquanto popup está aberto
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    // Bloco salvo pela ponte do mapa (mundo ISOLATED) — mantém S em sincronia
    if ('savedBlocks' in changes) S.savedBlocks = changes.savedBlocks.newValue || [];
    if ('uploading' in changes && changes.uploading.newValue === false) {
      S.uploading = false;
      setUploadingUI(false);
      chrome.storage.local.get(['registros', 'uploadResult'], data => {
        S.registros = data.registros || [];
        updateCount();
        if (data.uploadResult) {
          showUploadResult(data.uploadResult);
          chrome.storage.local.remove(['uploadResult']);
        }
      });
    }
  });

  if (!S.usuario) { show('setup'); return; }

  // Se o navegador ficou aberto mas houve um buraco no tempo (PC dormiu), o
  // tempo ao vivo (accMs + agora − startTs) estaria inflado: reancora e continua
  // rodando, descartando só o período morto. Fechar todas as janelas / desligar
  // o PC já viram suspensão pelo service worker — aqui o card segue ativo.
  const gap = S.lastAlive ? Date.now() - S.lastAlive : 0;
  if (S.running && !S.paused && S.currentRecord && gap > STALE_GAP_MS) {
    await persist({ startTs: Date.now(), lastAlive: Date.now() });
  }

  syncMain();
  show('main');
  if (S.running && !S.paused) startTick();

  // Restaura estado de upload ao reabrir popup
  if (S.uploading) {
    const elapsed = Date.now() - (S.uploadStartTs || 0);
    if (elapsed > 60000) {
      // Service worker foi encerrado antes de salvar o resultado — reseta
      await chrome.storage.local.set({ uploading: false, uploadStartTs: null });
      S.uploading = false;
    } else {
      setUploadingUI(true);
    }
  } else if (S.uploadResult) {
    showUploadResult(S.uploadResult);
    S.uploadResult = null;
    chrome.storage.local.remove(['uploadResult']);
  }
});
