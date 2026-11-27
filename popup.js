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

// Cursos-template das disciplinas novas: se a 1ª importação de um curso veio de
// um deles, é fluxo de produção; senão, reaproveitamento (canvas-course-type.js).
const DEFAULT_CANVAS_FLOW_TEMPLATES = [
  'Template 2025 Deduca',
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

// Botão 🎫 do cabeçalho (Caminho CSC): só aparece com a chave ligada.
function syncCscButton() {
  $('btn-csc').style.display = S.cscEnabled ? '' : 'none';
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
  $('settings-course-type').checked     = !!S.courseTypeEnabled;
  $('settings-flow-templates').value    = (S.canvasFlowTemplates || []).join('\n');
  // A chave vale na hora, sem "Salvar" — as abas do Canvas abertas se atualizam sozinhas.
  $('settings-course-type').onchange = () => persist({ courseTypeEnabled: $('settings-course-type').checked });

  // Atalho do editor de equação: também vale na hora. A colagem da fórmula
  // só faz sentido com o atalho ligado, então fica apagada sem ele.
  $('settings-equation-shortcut').checked = !!S.equationShortcutEnabled;
  $('settings-equation-paste').checked    = !!S.equationPasteEnabled;
  const syncEquationPaste = () => {
    const on = $('settings-equation-shortcut').checked;
    $('settings-equation-paste').disabled = !on;
    $('settings-equation-paste-group').classList.toggle('is-disabled', !on);
  };
  syncEquationPaste();
  $('settings-equation-shortcut').onchange = () => {
    persist({ equationShortcutEnabled: $('settings-equation-shortcut').checked });
    syncEquationPaste();
  };
  $('settings-equation-paste').onchange = () => persist({ equationPasteEnabled: $('settings-equation-paste').checked });

  // Selo "H5P" nos Módulos: vale na hora — a página de módulos aberta põe ou
  // tira os selos sozinha (canvas-h5p-marks.js).
  $('settings-h5p-marks').checked = !!S.h5pMarksEnabled;
  $('settings-h5p-marks').onchange = () => persist({ h5pMarksEnabled: $('settings-h5p-marks').checked });

  // Botão "📁 Pasta H5P": também vale na hora — a página de módulos aberta
  // mostra ou tira o botão sozinha.
  // O destino (My Content privado x pasta da equipe) só faz sentido com o
  // botão ligado, então fica apagado sem ele. Vale a partir do próximo clique.
  $('settings-h5p-folder').checked      = !!S.h5pFolderEnabled;
  $('settings-h5p-folder-team').checked = !!S.h5pFolderTeam;
  const syncH5pFolderTeam = () => {
    const on = $('settings-h5p-folder').checked;
    $('settings-h5p-folder-team').disabled = !on;
    $('settings-h5p-folder-team-group').classList.toggle('is-disabled', !on);
  };
  syncH5pFolderTeam();
  $('settings-h5p-folder').onchange = () => {
    persist({ h5pFolderEnabled: $('settings-h5p-folder').checked });
    syncH5pFolderTeam();
  };
  $('settings-h5p-folder-team').onchange = () => persist({ h5pFolderTeam: $('settings-h5p-folder-team').checked });

  // "🔎 Procurar texto" no menu do botão direito: o service worker (find-text.js)
  // mostra ou esconde o item na hora, ao ver a chave mudar.
  $('settings-find-text').checked = !!S.findTextEnabled;
  $('settings-find-text').onchange = () => persist({ findTextEnabled: $('settings-find-text').checked });

  // Caminho CSC: vale na hora — mostra ou tira o 🎫 do cabeçalho, e as abas
  // do CSC já abertas ligam ou desligam sozinhas (csc-comum.js).
  // A lista do Acervo (lembrete do csc-acervo.js) só faz sentido com a chave
  // ligada, então fica apagada sem ela. Grava ao sair da caixa e vale na hora
  // no chamado aberto; vazia, nenhum lembrete.
  $('settings-csc').checked = !!S.cscEnabled;
  $('settings-csc-acervo').value = (S.cscAcervoCaminhos || []).join('\n');
  const syncCscAcervo = () => {
    const on = $('settings-csc').checked;
    $('settings-csc-acervo').disabled = !on;
    $('settings-csc-acervo-group').classList.toggle('is-disabled', !on);
  };
  syncCscAcervo();
  $('settings-csc').onchange = async () => {
    await persist({ cscEnabled: $('settings-csc').checked });
    syncCscButton();
    syncCscAcervo();
  };
  $('settings-csc-acervo').onchange = () => persist({
    cscAcervoCaminhos: $('settings-csc-acervo').value.split('\n').map(s => s.trim()).filter(Boolean),
  });

  $('btn-save-settings').onclick = async () => {
    const name = $('settings-name').value.trim();
    if (!name) return;
    const w          = parseInt($('settings-video-w').value, 10) || 700;
    const h          = parseInt($('settings-video-h').value, 10) || 442;
    const key        = $('settings-openrouter').value.trim();
    const toLines = el => $(el).value.split('\n').map(s => s.trim()).filter(Boolean);
    const flowTemplates = toLines('settings-flow-templates');
    await persist({
      usuario: name, webhook_url: $('settings-url').value.trim(),
      video_width: w, video_height: h, openrouter_key: key,
      canvasExceptions: toLines('settings-canvas-exceptions'),
      canvasNoVideo:    toLines('settings-canvas-no-video'),
      // Lista vazia classificaria tudo como reaproveitamento: volta ao padrão.
      canvasFlowTemplates: flowTemplates.length ? flowTemplates : DEFAULT_CANVAS_FLOW_TEMPLATES,
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
  const itemOf = el => items.find(it => it.el === el);

  // ── Estado ──
  let selected = null;                              // bloco selecionado (verde): é o que o M arrasta
  let actionsRow = null, activeRow = null;
  let hoverEl = null;                               // destaque de passagem: laranja (linha) ou azul (M na página)
  let dragRow = null, dragEl = null, drop = null;   // arraste pelas linhas do painel; drop = { el, before }
  let pDrag = null;                                 // arraste direto na página
  let mKey = false, skipClick = false, closed = false;
  const marks = new WeakMap();                      // blocos criados pelo mapa → 'cópia' | 'novo' (linha vermelha, com ✕)

  // Linha verde no editor mostrando onde o bloco vai cair (sai do editor antes de qualquer gravação)
  const editorLine = doc.createElement('div');
  Object.assign(editorLine.style, { height: '3px', background: '#22c55e', margin: '2px 0', borderRadius: '2px',
    boxShadow: '0 0 10px 3px rgba(34,197,94,0.6)', pointerEvents: 'none' });

  const items = [];
  function collectItems() {
    items.length = 0;
    (function collect(parent, depth) {
      [...parent.children].forEach(el => {
        if (el.nodeType !== 1 || el === editorLine || trivial(el)) return;
        const cls = classify(el);
        const leaf = isLeaf(el);
        items.push({ el, depth, icon: cls.icon, label: cls.label, preview: leaf ? previewOf(el) : '' });
        if (!leaf && depth < MAX_DEPTH) collect(el, depth + 1);
      });
    })(body, 0);
  }
  collectItems();

  if (!items.length) { alert('Nenhum bloco reconhecido nesta página.'); return; }

  doc.documentElement.style.cursor = 'pointer';

  const pulseStyle = doc.createElement('style');
  pulseStyle.textContent = '@keyframes __svcMapPulse{0%,100%{box-shadow:0 0 0 3px #22c55e,0 0 6px 2px rgba(34,197,94,.45)}50%{box-shadow:0 0 0 6px #22c55e,0 0 24px 10px rgba(34,197,94,.9)}}'
    + ' iframe{pointer-events:none!important}';   // deixa o clique no vídeo "atravessar" para o <p> que o envolve
  (doc.head || doc.documentElement).appendChild(pulseStyle);

  // ── Destaques ──
  // Desenhados numa camada presa ao <html> do editor, FORA do <body>: nunca entram no HTML
  // salvo nem no Ctrl+Z. (Estilo inline no próprio bloco entrava — visto no TinyMCE 5 e 6.)
  const layer = doc.createElement('div');
  Object.assign(layer.style, { position: 'absolute', left: '0', top: '0', width: '0', height: '0',
    pointerEvents: 'none', zIndex: '2147483646' });
  doc.documentElement.appendChild(layer);
  const slots = {};                                 // 'sel' | 'hover' | 'drag' → { el, box }
  function paintSlot(slot, el, color, mode) {
    clearSlot(slot);
    if (!el) return;
    const box = doc.createElement('div');
    Object.assign(box.style, { position: 'absolute', pointerEvents: 'none' });
    if (mode === 'fade') {
      Object.assign(box.style, { background: 'rgba(255,255,255,.55)', outline: '2px dashed ' + color, outlineOffset: '2px' });
    } else {
      const strong = mode === 'strong';
      Object.assign(box.style, { outline: (strong ? '3px' : '2px') + ' solid ' + color, outlineOffset: '2px',
        boxShadow: strong ? '0 0 0 3px ' + color + ', 0 0 16px 6px ' + color + 'aa' : '0 0 0 2px ' + color,
        animation: strong ? '__svcMapPulse .8s ease-in-out 3' : '' });
    }
    layer.appendChild(box);
    slots[slot] = { el, box };
    placeBoxes();
  }
  function clearSlot(slot) {
    if (!slots[slot]) return;
    slots[slot].box.remove();
    delete slots[slot];
  }
  function placeBoxes() {
    for (const k in slots) {
      const { el, box } = slots[k];
      if (!el.isConnected) { box.style.display = 'none'; continue; }
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { display: '', left: (r.left + win.scrollX) + 'px', top: (r.top + win.scrollY) + 'px',
        width: r.width + 'px', height: r.height + 'px' });
    }
  }
  let raf = 0;
  (function follow() { placeBoxes(); raf = win.requestAnimationFrame(follow); })();   // acompanha rolagem e edição

  function hover(el, color) {
    hoverEl = el && el !== selected ? el : null;
    if (hoverEl) paintSlot('hover', hoverEl, color, 'soft'); else clearSlot('hover');
  }

  function flash(msg) {
    const t = document.createElement('div'); t.textContent = msg;
    Object.assign(t.style, { position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
      background:'#166534', color:'#fff', padding:'10px 18px', borderRadius:'8px', font:'13px system-ui',
      zIndex:'2147483647', boxShadow:'0 2px 10px rgba(0,0,0,.4)' });
    document.body.appendChild(t); setTimeout(() => t.remove(), 2400);
  }
  function cleanHTML(html) {
    const tmp = doc.createElement('div'); tmp.innerHTML = html;
    tmp.querySelectorAll('script').forEach(n => n.remove());
    tmp.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    tmp.querySelectorAll('[data-mce-selected],[data-mce-bogus]').forEach(n => { n.removeAttribute('data-mce-selected'); n.removeAttribute('data-mce-bogus'); });
    return tmp.innerHTML;
  }

  // Toda mudança passa pelo undoManager do TinyMCE: Ctrl+Z desfaz.
  function commit(run) {
    if (ed.undoManager && ed.undoManager.transact) ed.undoManager.transact(run); else run();
    if (ed.nodeChanged) ed.nodeChanged();
    if (ed.fire) ed.fire('input');
    if (ed.setDirty) ed.setDirty(true);
  }

  // ── Seleção ──
  // from: 'panel' rola a página até o bloco; 'page' rola o painel até a linha.
  function selectEl(el, from) {
    selected = el;
    if (hoverEl === el) hover(null);
    paintSlot('sel', el, '#22c55e', 'strong');
    const it = itemOf(el);
    setActiveRow(it ? it.row : null);
    if (it) openActions(it.row, el); else closeActions();
    if (from === 'panel') el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (from === 'page' && it) it.row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function clearSelection() {
    selected = null;
    clearSlot('sel');
    setActiveRow(null);
    closeActions();
  }
  function setActiveRow(row) {
    if (activeRow && activeRow !== row) activeRow.style.background = activeRow.__origBg || '';
    activeRow = row;
    if (row) { row.__origBg = row.style.background; row.style.background = 'rgba(34,197,94,0.15)'; }
  }
  function parentItem(el) {
    for (let n = el.parentElement; n && n !== body; n = n.parentElement) if (itemOf(n)) return n;
    return null;
  }
  function firstChildItem(el) {
    const it = items.find(x => x.el !== el && el.contains(x.el));
    return it ? it.el : null;
  }
  // Bloco que o M pega na página: o selecionado, se o clique cair dentro dele; senão o bloco do mapa mais interno.
  function pickAt(target) {
    if (selected && selected.isConnected && selected.contains(target)) return selected;
    for (let n = target; n && n !== body; n = n.parentElement) if (itemOf(n)) return n;
    return null;
  }

  // ── Mudanças no editor ──
  function dupe(el) {
    const html = cleanHTML(el.outerHTML);
    let clone = null;
    commit(() => { el.insertAdjacentHTML('afterend', html); clone = el.nextElementSibling; });
    if (!clone) return;
    marks.set(clone, 'cópia');
    refresh();
    selectEl(clone, 'panel');   // a cópia já fica selecionada: é só segurar M e arrastar até o lugar
    flash('✓ Bloco duplicado — segure M e arraste para levá-lo ao lugar. (Ctrl+Z desfaz)');
  }
  function moveBlock(el, target, before) {
    if (!el || !target || el === target || el.contains(target) || !body.contains(target)) return;   // nunca dentro dele mesmo
    if ((before ? target.previousElementSibling : target.nextElementSibling) === el) return;        // já estava aí
    commit(() => { if (before) target.before(el); else target.after(el); });
    refresh();
    selectEl(el, 'page');       // o bloco movido fica selecionado: dá para continuar ajustando
    flash('↕ Bloco movido! (Ctrl+Z desfaz)');
  }
  function removeBlock(el, msg) {
    if (selected === el) clearSelection();
    commit(() => el.remove());
    refresh();
    flash(msg);
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
  // Põe no mapa o vídeo recém-inserido pelo Studio (marcado "novo").
  function addVideoRow(iframe, srcEl) {
    let videoEl = iframe;
    const p = iframe.closest && iframe.closest('p');
    if (p && body.contains(p)) videoEl = p;
    centerVideo(iframe);                                        // centraliza por padrão
    if (closed) return;
    marks.set(videoEl, 'novo');
    refresh();
    if (!itemOf(videoEl)) {
      // Caiu dentro de um bloco que o mapa mostra fechado: a linha entra à mão, logo abaixo da origem.
      const src = itemOf(srcEl);
      const it = { el: videoEl, icon: '▶', label: 'Vídeo', preview: previewOf(videoEl), depth: src ? src.depth + 1 : 0 };
      it.row = buildRow(it);
      if (src) lastRowOf(src.row).after(it.row); else panel.appendChild(it.row);
      items.push(it);
    }
    try { videoEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    flash('▶ Vídeo adicionado ao mapa!');
  }
  // Observa o editor e, quando o Studio inserir um vídeo novo, cria a linha dele no mapa.
  function watchForStudioVideo(srcEl) {
    if (typeof MutationObserver === 'undefined') return;
    const before = new Set([...body.querySelectorAll('iframe')]);
    const obs = new MutationObserver(() => {
      const fresh = [...body.querySelectorAll('iframe')].find(f => !before.has(f));
      if (!fresh) return;
      obs.disconnect();
      addVideoRow(fresh, srcEl);
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
  function studioInsert(el) {
    if (ed.focus) ed.focus();
    const reveal = findRevealArea(el);
    if (reveal) {
      const det = (reveal.closest && reveal.closest('details')) || (reveal.tagName === 'DETAILS' ? reveal : null);
      if (det && !det.hasAttribute('open')) det.setAttribute('open', 'open');   // abre pra poder inserir dentro
      const target = [...reveal.querySelectorAll('p')].find(p => !txt(p)) || reveal;
      placeCursorInside(target);
      if (det) collapseWhenVideoArrives(det, reveal);
    } else {
      placeCursorAfter(el);
    }
    watchForStudioVideo(el);
    tryOpenStudio(ok => {
      const onde = reveal ? 'dentro do bloco (vai ficar escondido)' : 'colado abaixo deste bloco';
      flash(ok
        ? '🎬 Studio aberto — escolha o vídeo; ele entra ' + onde + '.'
        : 'Cursor posicionado ' + (reveal ? 'dentro do bloco' : 'abaixo do bloco') + '. Clique no botão Studio na barra do editor.');
    });
  }

  // ── Painel ──
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
  Object.assign(hint.style, { padding: '4px 12px 6px', fontSize: '10px', lineHeight: '1.45', opacity: '.6', background: '#11111b', borderBottom: '1px solid #313244' });
  hint.innerHTML = 'Clique num bloco (aqui ou na página) para selecionar.<br>'
    + '<b>Segure M</b> e arraste — aqui ou direto na página — para mover · M + ↑/↓ troca o nível · Del exclui · ESC fecha';
  panel.appendChild(hint);

  const dropLine = document.createElement('div');
  Object.assign(dropLine.style, { height: '2px', background: '#22c55e', margin: '0', display: 'none', pointerEvents: 'none' });

  // Refaz a lista a partir do editor depois de cada mudança: o painel nunca fica fora de ordem.
  function refresh() {
    if (closed) return;
    const top = panel.scrollTop;
    closeActions();
    hover(null);
    panel.querySelectorAll('[data-map-row]').forEach(r => r.remove());
    activeRow = null;
    collectItems();
    items.forEach(it => { it.row = buildRow(it); panel.appendChild(it.row); });
    panel.scrollTop = top;
    if (selected && !selected.isConnected) clearSelection();
    else if (selected && itemOf(selected)) setActiveRow(itemOf(selected).row);
  }
  // Última linha do "galho" de uma linha (ela + as linhas dos blocos de dentro dela).
  function lastRowOf(row) {
    let last = row;
    for (let n = row.nextElementSibling; n; n = n.nextElementSibling) {
      if (!n.dataset || !n.dataset.mapRow) continue;   // barra de ações, linha de soltar
      if (n.__depth > row.__depth) last = n; else break;
    }
    return last;
  }
  // Mostra no editor onde o bloco vai cair; rola só quando a posição muda.
  function showEditorLine(target, before) {
    const prev = editorLine.isConnected ? editorLine.previousElementSibling : undefined;
    if (before) target.before(editorLine); else target.after(editorLine);
    if (prev !== editorLine.previousElementSibling) editorLine.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── Arrastar pelas linhas do painel (M + arrastar) ──
  function cancelDrag() {
    if (dragRow) dragRow.style.opacity = '';
    document.body.style.cursor = '';
    panel.style.cursor = mKey ? 'grab' : '';
    dragRow = null; dragEl = null; drop = null;
    dropLine.style.display = 'none';
    editorLine.remove();
  }
  function onDragMove(e) {
    if (!dragRow) return;
    if (!e.buttons) { cancelDrag(); return; }        // o botão foi solto fora da página
    drop = null;
    const rows = [...panel.querySelectorAll('[data-map-row]')].filter(r => r !== dragRow);
    const r = rows.find(x => { const b = x.getBoundingClientRect(); return e.clientY >= b.top && e.clientY <= b.bottom; });
    const target = r && r.__el;
    if (!target || target === dragEl || dragEl.contains(target)) {   // não dá para pôr um bloco dentro dele mesmo
      dropLine.style.display = 'none'; editorLine.remove(); return;
    }
    const b = r.getBoundingClientRect();
    const before = e.clientY < b.top + b.height / 2;
    drop = { el: target, before };                    // o mesmo destino que a linha verde do editor mostra
    if (before) r.before(dropLine); else lastRowOf(r).after(dropLine);
    dropLine.style.display = 'block';
    showEditorLine(target, before);
  }
  function onDragDrop() {
    if (!dragRow) return;
    const d = drop, el = dragEl;
    cancelDrag();                                     // tira as linhas antes de mexer no editor
    if (d) moveBlock(el, d.el, d.before);
  }

  // ── Arrastar direto na página (M + arrastar o bloco) ──
  function cancelPageDrag() {
    if (!pDrag) return;
    pDrag = null;
    clearSlot('drag');
    editorLine.remove();
    doc.documentElement.style.cursor = mKey ? 'grab' : 'pointer';
  }
  function onPageDown(e) {
    if (!mKey || e.button !== 0) { skipClick = false; return; }
    e.preventDefault(); e.stopPropagation();          // nada de cursor de texto nem seleção no editor
    skipClick = true;                                 // M + clique não muda a seleção
    const el = pickAt(e.target);
    if (el) pDrag = { el, x: e.clientX, y: e.clientY, moving: false, over: null, before: false };
  }
  function onPageMove(e) {
    if (!pDrag) { if (mKey && !dragRow) hover(pickAt(e.target), '#3b82f6'); return; }
    if (!e.buttons) { cancelPageDrag(); return; }
    if (!pDrag.moving) {
      if (Math.abs(e.clientX - pDrag.x) <= 5 && Math.abs(e.clientY - pDrag.y) <= 5) return;
      pDrag.moving = true;
      hover(null);
      paintSlot('drag', pDrag.el, '#3b82f6', 'fade');
      doc.documentElement.style.cursor = 'grabbing';
    }
    e.preventDefault();
    // Como no antigo "Reorganizar": troca de lugar com os blocos do mesmo nível.
    const sibs = [...pDrag.el.parentElement.children].filter(c => c !== editorLine && c !== pDrag.el);
    const over = sibs.find(s => { const r = s.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; });
    if (!over) { pDrag.over = null; editorLine.remove(); return; }
    const r = over.getBoundingClientRect();
    pDrag.over = over;
    pDrag.before = e.clientY < r.top + r.height / 2;
    showEditorLine(over, pDrag.before);
  }
  function onPageUp(e) {
    if (!pDrag) return;
    const d = pDrag;
    cancelPageDrag();
    if (!d.moving) return;
    e.preventDefault(); e.stopPropagation();
    if (d.over) moveBlock(d.el, d.over, d.before);
  }
  // Soltar o botão fora da área onde o arraste começou cancela.
  function onInnerUp(e) { if (dragRow) cancelDrag(); onPageUp(e); }
  function onOuterUp() { if (pDrag) cancelPageDrag(); onDragDrop(); }

  function buildRow(it) {
    const { el, icon, label, preview, depth } = it;
    const tag = marks.get(el);
    const row = document.createElement('div');
    row.__depth = depth;
    row.__el = el;
    row.dataset.mapRow = '1';
    Object.assign(row.style, { padding: '6px 12px 6px ' + (12 + Math.min(depth, 7) * 12) + 'px', cursor: 'pointer',
      borderBottom: '1px solid #28283b', display: 'flex', alignItems: 'center', gap: '6px',
      background: tag ? 'rgba(239,68,68,0.18)' : '' });
    const info = document.createElement('div');
    Object.assign(info.style, { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '2px' });
    info.innerHTML = '<span>' + icon + ' <b>' + label + '</b>' +
      (tag ? ' <span style="color:#f87171;font-size:10px">(' + tag + ')</span>' : '') + '</span>' +
      (preview ? '<span style="opacity:.55;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + preview.replace(/</g, '&lt;') + '</span>' : '');
    row.appendChild(info);
    row.onmouseenter = () => { if (!dragRow && !pDrag) hover(el, '#f59e0b'); };
    row.onmouseleave = () => { if (!dragRow && !pDrag && hoverEl === el) hover(null); };
    row.onclick = () => selectEl(el, 'panel');
    if (tag) {
      const x = document.createElement('button');
      x.textContent = '✕';
      x.title = 'Excluir este bloco do editor';
      Object.assign(x.style, { background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '14px', flexShrink: '0', padding: '0 4px' });
      x.onclick = (e) => {
        e.stopPropagation();
        removeBlock(el, (tag === 'cópia' ? '🗑 Cópia excluída.' : '🗑 Bloco excluído.') + ' (Ctrl+Z desfaz)');
      };
      row.appendChild(x);
    }
    row.addEventListener('mousedown', e => {
      if (!mKey || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      hover(null);
      dragRow = row; dragEl = el;
      row.style.opacity = '0.45';
      document.body.style.cursor = 'grabbing';
    });
    return row;
  }

  function closeActions() {
    if (actionsRow) { actionsRow.remove(); actionsRow = null; }
  }
  function openActions(afterRow, el) {
    closeActions();
    actionsRow = document.createElement('div');
    Object.assign(actionsRow.style, { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '6px 12px', background: '#181825' });
    const mk = (label, fn) => {
      const b = document.createElement('button'); b.textContent = label;
      Object.assign(b.style, { flex: '1 1 64px', minWidth: '64px', padding: '5px', borderRadius: '4px', border: 'none', cursor: 'pointer', background: '#313244', color: '#e2e8f0', fontSize: '11px' });
      b.onclick = fn; return b;
    };
    actionsRow.appendChild(mk('📑 Duplicar', () => dupe(el)));
    actionsRow.appendChild(mk('📋 Copiar', () => copyHtml(el)));
    actionsRow.appendChild(mk('➕ Inserir', () => openInsertPicker(afterRow, el)));
    actionsRow.appendChild(mk('🎬 Studio', () => studioInsert(el)));
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
    closeActions();
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
      btn.onclick = () => choosePosition(pick, el, b.html);
      pick.appendChild(btn);
    });
    actionsRow = pick;                    // mantém a referência para o cleanup remover
    afterRow.insertAdjacentElement('afterend', pick);
  }

  // Pergunta antes/depois e insere
  function choosePosition(container, el, html) {
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
      b.onclick = () => insertSnippet(el, html, pos); return b;
    };
    row.appendChild(mkb('⬆ Antes', 'before'));
    row.appendChild(mkb('⬇ Depois', 'after'));
    container.appendChild(row);
  }

  function insertSnippet(el, html, pos) {
    let inserted = null;
    commit(() => {
      el.insertAdjacentHTML(pos === 'before' ? 'beforebegin' : 'afterend', html);
      inserted = pos === 'before' ? el.previousElementSibling : el.nextElementSibling;
    });
    if (inserted) marks.set(inserted, 'novo');   // linha vermelha "novo", removível pelo ✕
    refresh();
    if (inserted) selectEl(inserted, 'panel');
    flash('✓ Bloco inserido! (Ctrl+Z desfaz)');
  }

  function onEditorClick(e) {
    if (skipClick) { skipClick = false; return; }
    for (let n = e.target; n && n !== body; n = n.parentElement) {
      if (itemOf(n)) { selectEl(n, 'page'); return; }
    }
  }

  items.forEach(it => { it.row = buildRow(it); panel.appendChild(it.row); });

  // ── Teclado ──
  const isM = e => (e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.altKey && !e.metaKey;
  const inField = e => { const t = e.target; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'); };
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (dragRow || pDrag) { cancelDrag(); cancelPageDrag(); } else cleanup();
      return;
    }
    if (inField(e)) return;                           // campos do Canvas (título da página etc.) seguem normais
    if (isM(e)) {
      e.preventDefault();                             // com o mapa aberto, M é o atalho de mover: não escreve "m" no texto
      if (!mKey) {
        mKey = true;
        panel.style.cursor = 'grab';
        if (!pDrag) doc.documentElement.style.cursor = 'grab';
      }
      return;
    }
    if (mKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      // M + ↑/↓: sobe ou desce um nível no bloco que o M vai pegar
      e.preventDefault();
      const base = hoverEl || selected;
      const next = base && (e.key === 'ArrowUp' ? parentItem(base) : firstChildItem(base));
      if (next) selectEl(next, 'page');
      return;
    }
    if (e.key === 'Delete' && selected) {
      e.preventDefault();
      removeBlock(selected, '🗑 Bloco excluído. (Ctrl+Z desfaz)');
    }
  }
  // Soltar o M não interrompe um arraste já começado: ele termina ao soltar o mouse.
  function releaseM() {
    if (!mKey) return;
    mKey = false;
    if (!dragRow && !pDrag) hover(null);
    panel.style.cursor = '';
    if (!pDrag) doc.documentElement.style.cursor = 'pointer';
  }
  function onKeyUp(e) {
    if (e.key === 'm' || e.key === 'M') releaseM();
  }
  // Ctrl+Z / Ctrl+Y do editor trocam os blocos por outros: o mapa é refeito.
  function onEditorUndo() { setTimeout(refresh, 0); }

  function cleanup() {
    closed = true;
    cancelDrag();
    cancelPageDrag();
    win.cancelAnimationFrame(raf);
    layer.remove();
    editorLine.remove();
    pulseStyle.remove();
    doc.documentElement.style.cursor = '';
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('mousemove', onDragMove, true);
    document.removeEventListener('mouseup', onOuterUp, true);
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('keyup', onKeyUp, true);
    doc.removeEventListener('mousedown', onPageDown, true);
    doc.removeEventListener('mousemove', onPageMove, true);
    doc.removeEventListener('mouseup', onInnerUp, true);
    body.removeEventListener('click', onEditorClick, true);
    window.removeEventListener('blur', releaseM);
    win.removeEventListener('blur', releaseM);
    if (ed.off) ed.off('Undo Redo SetContent', onEditorUndo);
    panel.remove();
    window.__svcMapCleanup = null;
  }
  window.__svcMapCleanup = cleanup;
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('mousemove', onDragMove, true);
  document.addEventListener('mouseup', onOuterUp, true);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('keyup', onKeyUp, true);
  doc.addEventListener('mousedown', onPageDown, true);
  doc.addEventListener('mousemove', onPageMove, true);
  doc.addEventListener('mouseup', onInnerUp, true);
  body.addEventListener('click', onEditorClick, true);
  window.addEventListener('blur', releaseM);
  win.addEventListener('blur', releaseM);
  if (ed.on) ed.on('Undo Redo SetContent', onEditorUndo);
  document.body.appendChild(panel);
}

// ── Edição em escala (localizar e substituir multi-curso) ────────────

const BULK_MAX_COURSES = 10;

let _bulkPages    = [];    // páginas listadas do curso base
let _bulkSelected = null;  // { url, title }
let _bulkPreview  = null;  // último resultado de prévia, reusado no apply
let _bulkListedIn = null;  // curso que gerou a lista exibida em _bulkPages
let _bulkGen      = 0;     // muda a cada edição: prévia que volta depois disso é descartada

function bulkStatus(msg, color) {
  const el = $('bulk-list-status');
  el.textContent = msg;
  el.style.color = color || '#94a3b8';
  el.style.display = msg ? 'block' : 'none';
}

function bulkReset() {
  _bulkPages    = [];
  _bulkSelected = null;
  _bulkPreview  = null;
  _bulkListedIn = null;
  _bulkGen++;
  $('bulk-page-section').style.display    = 'none';
  $('bulk-replace-section').style.display = 'none';
  $('btn-bulk-apply').style.display       = 'none';
  $('bulk-results').innerHTML = '';
  bulkStatus('');
}

function bulkCourseIds() {
  return parseCourseIds($('bulk-courses-input').value);
}

// Modo "texto" troca só o texto visível; "intervalo" troca um trecho do
// código HTML entre um início e um fim — os campos mudam de papel.
function bulkSyncMode() {
  const isRange = $('bulk-mode').value === 'range';
  $('bulk-find-label').textContent = isRange ? 'Início do trecho' : 'Texto original';
  $('bulk-find').placeholder = isRange ? 'ex.: <div class="col-xs-12' : 'texto que será procurado';
  $('bulk-repl').placeholder = isRange ? 'HTML novo (vazio = apagar o trecho)' : 'texto novo (vazio = remover)';
  $('bulk-find').classList.toggle('bulk-code', isRange);
  $('bulk-repl').classList.toggle('bulk-code', isRange);
  $('bulk-end-wrap').style.display      = isRange ? '' : 'none';
  $('bulk-inclusive-row').style.display = isRange ? '' : 'none';
  $('bulk-hint-text').style.display     = isRange ? 'none' : 'block';
  $('bulk-hint-range').style.display    = isRange ? 'block' : 'none';
}

// Executa `fn` na aba ativa do Canvas — todas as chamadas usam a sessão da aba,
// então não é preciso token de API.
async function bulkExec(fn, args) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab  = tabs[0];
  if (!tab || !/\/courses\//.test(tab.url || '')) {
    throw new Error('Abra uma aba do Canvas (qualquer curso) para usar esta ferramenta.');
  }
  const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fn, args });
  const out = res[0]?.result;
  if (out && out.__error) throw new Error(out.__error);
  return out;
}

// ── Listagem de páginas do primeiro curso ────────────────────────────
function bulkListPagesMain(courseId) {
  return (async () => {
    try {
      const out = [];
      let next = `/api/v1/courses/${courseId}/pages?per_page=100`;
      while (next) {
        const res = await fetch(next);
        if (!res.ok) return { __error: `Curso ${courseId}: HTTP ${res.status}` };
        const data = await res.json();
        if (Array.isArray(data)) out.push(...data);
        const m = (res.headers.get('Link') || '').match(/<([^>]+)>;\s*rel="next"/);
        next = m ? m[1] : null;
      }
      return out.map(pg => ({ url: pg.url, title: pg.title, published: !!pg.published }));
    } catch (err) {
      return { __error: err.message };
    }
  })();
}

async function doBulkListPages() {
  const ids = bulkCourseIds();
  if (!ids.length) { bulkStatus('✗ Informe ao menos um código de curso.', '#f87171'); return; }
  if (ids.length > BULK_MAX_COURSES) {
    bulkStatus(`✗ Máximo de ${BULK_MAX_COURSES} cursos — você informou ${ids.length}.`, '#f87171');
    return;
  }

  const btn = $('btn-bulk-list');
  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span>Listando...';
  $('bulk-results').innerHTML = '';
  $('btn-bulk-apply').style.display = 'none';

  try {
    const pages = await bulkExec(bulkListPagesMain, [ids[0]]);
    _bulkPages    = pages;
    _bulkSelected = null;
    _bulkListedIn = ids[0];
    $('bulk-replace-section').style.display = 'none';
    if (!pages.length) {
      bulkStatus(`Nenhuma página no curso #${ids[0]}.`, '#f97316');
      $('bulk-page-section').style.display = 'none';
    } else {
      const extra = ids.length > 1 ? ` · a mesma página será buscada nos outros ${ids.length - 1}` : '';
      bulkStatus(`${pages.length} página(s) no curso #${ids[0]}${extra}`, '#4ade80');
      $('bulk-page-filter').value = '';
      buildBulkPages();
      $('bulk-page-section').style.display = 'block';
    }
  } catch (err) {
    bulkStatus('✗ ' + err.message, '#f87171');
  }

  btn.disabled    = false;
  btn.textContent = '🔍  Listar páginas';
}

function buildBulkPages() {
  const term = $('bulk-page-filter').value.trim().toLowerCase();
  const list = $('bulk-pages-list');
  list.innerHTML = '';

  const shown = _bulkPages.filter(pg => !term || pg.title.toLowerCase().includes(term));
  if (!shown.length) {
    const empty = document.createElement('div');
    empty.className = 'small muted';
    empty.style.padding = '6px';
    empty.textContent = 'Nenhuma página com esse nome.';
    list.appendChild(empty);
    return;
  }

  for (const pg of shown) {
    const row = document.createElement('div');
    row.className = 'bulk-page-item' + (_bulkSelected?.url === pg.url ? ' selected' : '');

    const title = document.createElement('span');
    title.className = 'bulk-page-title';
    title.textContent = pg.title;
    row.appendChild(title);

    if (!pg.published) {
      const tag = document.createElement('span');
      tag.className = 'bulk-page-unpub';
      tag.textContent = 'não publicada';
      row.appendChild(tag);
    }

    row.addEventListener('click', () => {
      _bulkSelected = { url: pg.url, title: pg.title };
      _bulkPreview  = null;
      _bulkGen++;
      $('bulk-results').innerHTML = '';
      $('btn-bulk-apply').style.display = 'none';
      $('bulk-replace-section').style.display = 'block';
      buildBulkPages();
    });

    list.appendChild(row);
  }
}

// ── Núcleo: substituição preservando a estrutura do HTML ─────────────
// Roda na aba do Canvas. Nunca reserializa o documento: opera sobre a string
// do HTML original e só toca os trechos que estão FORA de tags, para que
// atributos, cores, negrito, itálico e links permaneçam byte a byte iguais.
// No modo 'range' a busca é no código: troca o trecho entre `find` e `end`.
// opts = { mode: 'text'|'range', find, end, repl, cs, firstOnly, inclusive }
function bulkReplaceMain(courseIds, pageRef, opts, dryRun) {
  const { mode, find, end, repl, cs: caseSensitive, firstOnly, inclusive } = opts;
  return (async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));

    async function safeFetch(url, opts = {}) {
      for (let attempt = 0; attempt <= 2; attempt++) {
        const res = await fetch(url, opts);
        if (res.status === 429) { await delay(2000 * (attempt + 1)); continue; }
        const remaining = parseFloat(res.headers.get('X-Rate-Limit-Remaining') || '999');
        if (remaining < 30) await delay(800);
        return res;
      }
      throw new Error('Rate limit esgotado após 3 tentativas');
    }

    const rawCsrf = document.cookie.split(';').map(c => c.trim())
      .find(c => c.startsWith('_csrf_token='));
    const csrf = rawCsrf
      ? decodeURIComponent(rawCsrf.split('=').slice(1).join('='))
      : decodeURIComponent(document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '');

    function escRe(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    // O Canvas grava vários caracteres como entidade HTML. Buscar "P&D" ou
    // "aluno's" literalmente não acharia "P&amp;D" / "aluno&#39;s", então cada
    // um desses caracteres vira uma alternativa que casa as duas formas.
    const ENT_ALT = {
      '&': '(?:&|&amp;)',
      '<': '(?:<|&lt;)',
      '>': '(?:>|&gt;)',
      '"': '(?:"|&quot;|&#34;|“|”)',
      "'": "(?:'|’|&#39;|&apos;|&rsquo;)",
      '’': "(?:’|'|&#39;|&apos;|&rsquo;)",
      '“': '(?:“|"|&quot;|&ldquo;)',
      '”': '(?:”|"|&quot;|&rdquo;)',
      '–': '(?:–|&ndash;|&#8211;)',
      '—': '(?:—|&mdash;|&#8212;)',
    };

    // Letras acentuadas podem estar gravadas como caractere (ó) ou como
    // entidade (&oacute;, &#243;) — conteúdo importado costuma vir assim.
    const ACCENT_NAMES = {
      'á': 'aacute', 'à': 'agrave', 'â': 'acirc', 'ã': 'atilde', 'ä': 'auml',
      'é': 'eacute', 'è': 'egrave', 'ê': 'ecirc', 'ë': 'euml',
      'í': 'iacute', 'ì': 'igrave', 'î': 'icirc', 'ï': 'iuml',
      'ó': 'oacute', 'ò': 'ograve', 'ô': 'ocirc', 'õ': 'otilde', 'ö': 'ouml',
      'ú': 'uacute', 'ù': 'ugrave', 'û': 'ucirc', 'ü': 'uuml',
      'ç': 'ccedil', 'ñ': 'ntilde',
    };
    function accentAlt(ch) {
      const cp = ch.codePointAt(0);
      if (cp < 128) return null;
      const lower = ch.toLowerCase();
      const name  = ACCENT_NAMES[lower];
      const alts  = [ch, `&#${cp};`, `&#x${cp.toString(16)};`];
      if (name) alts.push('&' + (ch === lower ? name : name[0].toUpperCase() + name.slice(1)) + ';');
      return '(?:' + alts.join('|') + ')';
    }

    // Converte um trecho literal em regex, char a char — assim a alternativa
    // gerada para um caractere nunca é reprocessada pela do caractere seguinte.
    function litToRe(chunk) {
      let out = '';
      for (const ch of chunk) out += (ENT_ALT[ch] || accentAlt(ch) || escRe(ch));
      return out;
    }

    const WS_RE = '(?:\\s|&nbsp;|&#160;|&#xA0;|\\u00a0)+';

    // O texto novo entra como TEXTO, nunca como marcação: um "<" digitado pelo
    // usuário viraria uma tag no corpo da página e mudaria a estrutura.
    function escHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Espaço no termo buscado casa também com &nbsp; / &#160; / NBSP literal,
    // que é como o Canvas costuma gravar espaços vindos do editor.
    function buildPattern(term, cs) {
      // Sem trim: espaco no inicio/fim do termo tambem conta na busca. Cada
      // corrida de espacos vira um padrao flexivel para casar &nbsp; tambem.
      const src = term.split(/\s+/).map(litToRe).join(WS_RE);
      return new RegExp(src, cs ? 'g' : 'gi');
    }

    // "&oacute;" colado do editor HTML vira "ó", que depois casa as duas
    // formas via accentAlt. Entidades de ASCII (&lt; &amp; …) ficam como
    // estão: no marcador elas fazem parte do código.
    function decodeAccents(str) {
      const ta = document.createElement('textarea');
      return str.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, ent => {
        ta.innerHTML = ent;
        const ch = ta.value;
        return ch.length === 1 && ch.charCodeAt(0) > 127 ? ch : ent;
      });
    }

    // Marcador de início/fim do modo intervalo, casado no código HTML bruto.
    // O editor HTML do Canvas reindenta o código, então espaços viram
    // "qualquer espaço" e, colados a uma tag, podem até faltar: "</span></p>"
    // casa "</span>\n  </p>".
    function markerToRe(marker) {
      const chars = Array.from(decodeAccents(marker.trim()));
      let out = '';
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (/\s/.test(ch)) {
          let j = i;
          while (j + 1 < chars.length && /\s/.test(chars[j + 1])) j++;
          out += (chars[i - 1] === '>' || chars[j + 1] === '<') ? '\\s*' : WS_RE;
          i = j;
          continue;
        }
        out += accentAlt(ch) || escRe(ch);
        if (ch === '>' && chars[i + 1] === '<') out += '\\s*';
      }
      return out;
    }

    // Tags abertas sem fechar (ou fechadas sem abrir) dentro de um trecho.
    // Elementos vazios (<br>, <img>…) e "/>" não contam; fechar uma tag
    // descarta as que ficaram abertas dentro dela (<li>/<p> sem fechamento).
    const VOID_TAGS = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
    function unpairedTags(fragment) {
      const stack = [];
      let stray = 0;
      for (const m of fragment.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
        const name = m[2].toLowerCase();
        if (VOID_TAGS.test(name) || m[3]) continue;
        if (!m[1]) { stack.push(name); continue; }
        const at = stack.lastIndexOf(name);
        if (at === -1) stray++;
        else stack.length = at;
      }
      return stray + stack.length;
    }

    function rangeSample(html, from, to) {
      let hit = html.slice(from, to);
      if (hit.length > 140) hit = `${hit.slice(0, 80)} … (+${hit.length - 120} caract.) … ${hit.slice(-40)}`;
      return {
        pre:  html.slice(Math.max(0, from - 30), from),
        hit,
        post: html.slice(to, to + 30),
      };
    }

    // Troca cada trecho que vai de `startTerm` até o primeiro `endTerm`
    // seguinte. Aqui a substituição entra como HTML, sem escape: o trecho
    // removido também é código.
    function replaceRange(html, startTerm, endTerm, replacement, cs) {
      const flags   = cs ? 'g' : 'gi';
      const reStart = new RegExp(markerToRe(startTerm), flags);
      const reEnd   = new RegExp(markerToRe(endTerm), flags);
      const samples = [];
      let out = '', cursor = 0, hits = 0, unpaired = 0, orphan = false, s;

      while ((s = reStart.exec(html)) !== null) {
        reEnd.lastIndex = s.index + s[0].length;
        const e = reEnd.exec(html);
        if (!e) { orphan = true; break; }

        const from = inclusive ? s.index : s.index + s[0].length;
        const to   = inclusive ? e.index + e[0].length : e.index;
        out += html.slice(cursor, from) + replacement;
        if (samples.length < 3) samples.push(rangeSample(html, from, to));
        if (unpairedTags(html.slice(from, to))) unpaired++;
        cursor = to;
        hits++;
        if (firstOnly) break;
        reStart.lastIndex = e.index + e[0].length;
      }
      out += html.slice(cursor);
      return { html: out, hits, samples, unpaired, orphan };
    }

    // Fatia o HTML em segmentos de texto (fora de tags) e devolve os índices.
    // Conteúdo de <script>/<style> e comentários são ignorados.
    function textSegments(html) {
      const segs = [];
      let i = 0;
      while (i < html.length) {
        const lt = html.indexOf('<', i);
        if (lt === -1) { if (i < html.length) segs.push([i, html.length]); break; }
        if (lt > i) segs.push([i, lt]);

        if (html.startsWith('<!--', lt)) {
          const end = html.indexOf('-->', lt + 4);
          i = end === -1 ? html.length : end + 3;
          continue;
        }
        const gt = html.indexOf('>', lt);
        if (gt === -1) { i = html.length; break; }

        const tagName = (html.slice(lt + 1, gt).match(/^\/?\s*([a-zA-Z0-9-]+)/) || [])[1];
        const lower   = (tagName || '').toLowerCase();
        if (lower === 'script' || lower === 'style') {
          const closeRe = new RegExp('</\\s*' + lower + '\\s*>', 'i');
          const rest    = html.slice(gt + 1);
          const m       = rest.match(closeRe);
          i = m ? gt + 1 + m.index + m[0].length : html.length;
          continue;
        }
        i = gt + 1;
      }
      return segs;
    }

    function contextOf(text, start, end) {
      return {
        pre:  text.slice(Math.max(0, start - 35), start),
        hit:  text.slice(start, end),
        post: text.slice(end, Math.min(text.length, end + 35)),
      };
    }

    // Substitui `find` por `repl` só nos segmentos de texto do HTML.
    function replaceInHtml(html, term, rawReplacement, cs) {
      const replacement = escHtml(rawReplacement);
      const re          = buildPattern(term, cs);
      const segs    = textSegments(html);
      const samples = [];
      let out = '', cursor = 0, hits = 0;

      for (const [a, b] of segs) {
        if (firstOnly && hits) break;
        const chunk = html.slice(a, b);
        re.lastIndex = 0;
        if (!re.test(chunk)) continue;

        out += html.slice(cursor, a);
        re.lastIndex = 0;
        let last = 0, piece = '', m;
        while ((m = re.exec(chunk)) !== null) {
          piece += chunk.slice(last, m.index) + replacement;
          if (samples.length < 3) samples.push(contextOf(chunk, m.index, m.index + m[0].length));
          last = m.index + m[0].length;
          hits++;
          if (firstOnly) break;
          if (m[0] === '') re.lastIndex++;
        }
        piece += chunk.slice(last);
        out   += piece;
        cursor = b;
      }
      out += html.slice(cursor);
      return { html: out, hits, samples };
    }

    // Quantas vezes o termo aparece no texto puro da página. Se for maior que
    // os hits do HTML, a ocorrência está partida por uma tag (<strong>, <em>,
    // <a>…) — nesse caso NÃO mexemos, para não alterar a formatação, e apenas
    // avisamos.
    function plainCount(html, term, cs) {
      const doc  = new DOMParser().parseFromString(html, 'text/html');
      const text = (doc.body.textContent || '').replace(/\u00a0/g, ' ');
      const re   = buildPattern(term, cs);
      return (text.match(re) || []).length;
    }

    const results = [];

    for (const courseId of courseIds) {
      const entry = { courseId, status: 'zero', hits: 0, samples: [], note: '', title: '' };
      try {
        // Tenta pelo slug; se não existir nesse curso, procura pelo título.
        const direct = await safeFetch(`/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageRef.url)}`);
        let page = direct.ok ? await direct.json() : null;

        if (!page) {
          const all = [];
          let next  = `/api/v1/courses/${courseId}/pages?per_page=100`;
          while (next) {
            const lr = await safeFetch(next);
            if (!lr.ok) throw new Error(`HTTP ${lr.status} ao listar páginas`);
            const data = await lr.json();
            if (Array.isArray(data)) all.push(...data);
            const m = (lr.headers.get('Link') || '').match(/<([^>]+)>;\s*rel="next"/);
            next = m ? m[1] : null;
          }
          const wanted = pageRef.title.trim().toLowerCase();
          const found  = all.find(pg => (pg.title || '').trim().toLowerCase() === wanted);
          if (!found) {
            entry.status = 'warn';
            entry.note   = 'Página não encontrada neste curso.';
            results.push(entry);
            continue;
          }
          const pr = await safeFetch(`/api/v1/courses/${courseId}/pages/${encodeURIComponent(found.url)}`);
          if (!pr.ok) throw new Error(`HTTP ${pr.status} ao abrir a página`);
          page = await pr.json();
        }

        entry.title = page.title || pageRef.title;
        const body  = page.body || '';
        const isRange = mode === 'range';
        const r = isRange
          ? replaceRange(body, find, end, repl, caseSensitive)
          : replaceInHtml(body, find, repl, caseSensitive);
        const { html: newHtml, hits, samples } = r;
        entry.hits    = hits;
        entry.samples = samples;

        if (hits === 0) {
          if (isRange) {
            entry.status = r.orphan ? 'warn' : 'zero';
            entry.note   = r.orphan
              ? 'Início encontrado, mas o fim não aparece depois dele.'
              : 'Início do trecho não encontrado nesta página.';
          } else {
            const plain = plainCount(body, find, caseSensitive);
            if (plain > 0) {
              entry.status = 'warn';
              entry.note   = `${plain} ocorrência(s) partida(s) por formatação (negrito, itálico, link…) — não alteradas para preservar a estrutura.`;
            } else {
              entry.status = 'zero';
              entry.note   = 'Texto não encontrado nesta página.';
            }
          }
          results.push(entry);
          continue;
        }

        if (isRange) {
          const notes = [];
          if (r.unpaired) notes.push(`${r.unpaired} trecho(s) com tags sem par (ex.: abre um <div> e não fecha) — o layout pode mudar.`);
          if (r.orphan)   notes.push('Um início sem fim depois dele foi ignorado.');
          entry.note = notes.join(' ');
        } else if (!firstOnly) {
          // Com "só a 1ª", as demais ocorrências sobram de propósito — não
          // são "partidas por formatação".
          const split = plainCount(body, find, caseSensitive) - hits;
          if (split > 0) {
            entry.note = `${split} ocorrência(s) partida(s) por formatação foram ignoradas.`;
          }
        }

        if (!dryRun) {
          const pr = await safeFetch(`/api/v1/courses/${courseId}/pages/${encodeURIComponent(page.url)}`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
            body:    JSON.stringify({ wiki_page: { body: newHtml } }),
          });
          if (!pr.ok) throw new Error(`HTTP ${pr.status} ao gravar`);
        }
        entry.status = 'ok';
      } catch (err) {
        entry.status = 'error';
        entry.note   = err.message;
      }
      results.push(entry);
    }

    return results;
  })();
}

function buildBulkResults(results, applied) {
  const box = $('bulk-results');
  box.innerHTML = '';

  const okCourses = results.filter(r => r.status === 'ok').length;
  const total     = results.reduce((n, r) => n + (r.status === 'ok' ? r.hits : 0), 0);

  const head = document.createElement('div');
  head.className = 'small';
  head.style.marginBottom = '6px';
  if (applied) {
    head.style.color = total ? '#4ade80' : '#94a3b8';
    head.textContent = total
      ? `✅ ${total} substituição(ões) gravada(s) em ${okCourses} curso(s).`
      : 'Nada foi alterado.';
  } else {
    head.style.color = total ? '#60a5fa' : '#f97316';
    head.textContent = total
      ? `Prévia — ${total} ocorrência(s) em ${okCourses} curso(s). Nada foi gravado ainda.`
      : 'Prévia — nenhuma ocorrência encontrada.';
  }
  box.appendChild(head);

  for (const r of results) {
    const row = document.createElement('div');
    row.className = 'bulk-course-row ' + r.status;

    const h = document.createElement('div');
    h.className = 'bulk-course-row-head';
    const icon = { ok: '✅', zero: '—', warn: '⚠', error: '✗' }[r.status] || '—';
    h.innerHTML =
      `<span>${icon}</span><span>Curso #${clEsc(r.courseId)}</span>` +
      (r.hits ? `<span class="bulk-count">${r.hits}×</span>` : '');
    row.appendChild(h);

    if (r.note) {
      const note = document.createElement('div');
      note.className = 'bulk-course-note';
      note.textContent = r.note;
      row.appendChild(note);
    }

    for (const sm of r.samples || []) {
      const sample = document.createElement('div');
      sample.className = 'bulk-sample';
      sample.innerHTML = `…${clEsc(sm.pre)}<mark>${clEsc(sm.hit)}</mark>${clEsc(sm.post)}…`;
      row.appendChild(sample);
    }

    box.appendChild(row);
  }
}

async function doBulkPreview() {
  const ids     = bulkCourseIds();
  const isRange = $('bulk-mode').value === 'range';
  const opts    = {
    mode:      isRange ? 'range' : 'text',
    find:      $('bulk-find').value,
    end:       isRange ? $('bulk-end').value : '',
    repl:      $('bulk-repl').value,
    cs:        $('bulk-toggle-case').checked,
    firstOnly: $('bulk-toggle-first').checked,
    inclusive: $('bulk-toggle-inclusive').checked,
  };
  if (!ids.length) { bulkStatus('✗ Informe ao menos um código de curso.', '#f87171'); return; }
  if (ids.length > BULK_MAX_COURSES) {
    bulkStatus(`✗ Máximo de ${BULK_MAX_COURSES} cursos — você informou ${ids.length}.`, '#f87171');
    return;
  }
  if (!_bulkSelected) { bulkStatus('✗ Escolha uma página na lista.', '#f87171'); return; }
  if (!opts.find.trim()) {
    bulkStatus(isRange ? '✗ Informe o início do trecho.' : '✗ Informe o texto original.', '#f87171');
    return;
  }
  if (isRange && !opts.end.trim()) { bulkStatus('✗ Informe o fim do trecho.', '#f87171'); return; }

  const page = _bulkSelected;
  const gen  = ++_bulkGen;
  const btn  = $('btn-bulk-preview');
  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span>Verificando...';
  $('btn-bulk-apply').style.display = 'none';
  $('bulk-progress').textContent   = `Lendo ${ids.length} curso(s)...`;
  $('bulk-progress').style.display = 'block';
  bulkStatus('');

  try {
    const results = await bulkExec(bulkReplaceMain, [ids, page, opts, true]);

    // Se a página ou algum campo mudou enquanto a prévia rodava, o resultado
    // não corresponde mais à tela — descarta em vez de liberar o "Aplicar".
    if (gen === _bulkGen) {
      _bulkPreview = { ids, page, opts, results };
      buildBulkResults(results, false);
      if (results.some(r => r.status === 'ok')) $('btn-bulk-apply').style.display = 'block';
    }
  } catch (err) {
    bulkStatus('✗ ' + err.message, '#f87171');
  }

  $('bulk-progress').style.display = 'none';
  btn.disabled    = false;
  btn.textContent = '👁  Ver prévia';
}

// Modal próprio em vez de confirm(): diálogos nativos do navegador não são
// exibidos de forma confiável dentro do side panel, e o clique acabaria sem
// efeito nenhum.
function askBulkConfirm(total, courseIds, pageTitle, opts) {
  return new Promise(resolve => {
    const modal   = $('modal-bulk-confirm');
    const isRange = opts.mode === 'range';
    const row     = (label, html) =>
      `<div class="bc-row"><span class="bc-label">${label}:</span> ${html}</div>`;

    const modeDesc = [isRange
      ? `intervalo, ${opts.inclusive ? 'incluindo' : 'sem'} o início e o fim`
      : 'texto'];
    if (opts.firstOnly) modeDesc.push('só a 1ª ocorrência de cada página');

    $('bulk-confirm-sub').textContent =
      `${total} ${isRange ? 'trecho(s)' : 'ocorrência(s)'} em ${courseIds.length} curso(s). Grava direto no Canvas.`;

    $('bulk-confirm-detail').innerHTML =
      row('Página', clEsc(pageTitle)) +
      row('Modo', clEsc(modeDesc.join(' · '))) +
      (isRange
        ? row('Início', `<code>${clEsc(opts.find)}</code>`) + row('Fim', `<code>${clEsc(opts.end)}</code>`)
        : row('De', `<code>${clEsc(opts.find)}</code>`)) +
      row('Para', `<code>${opts.repl ? clEsc(opts.repl) : '(vazio — remove)'}</code>`) +
      row('Cursos', `<span class="bc-courses">${courseIds.map(id => '#' + clEsc(id)).join(', ')}</span>`);

    modal.style.display = 'flex';

    function finish(value) {
      modal.style.display = 'none';
      document.removeEventListener('keydown', onKey);
      resolve(value);
    }
    function onKey(e) { if (e.key === 'Escape') finish(false); }

    $('btn-bulk-confirm-ok').onclick     = () => finish(true);
    $('btn-bulk-confirm-cancel').onclick = () => finish(false);
    document.addEventListener('keydown', onKey);
  });
}

async function doBulkApply() {
  if (!_bulkPreview) { bulkStatus('✗ Rode a prévia antes de aplicar.', '#f87171'); return; }
  const { page, opts, results } = _bulkPreview;
  const total = results.reduce((n, r) => n + (r.status === 'ok' ? r.hits : 0), 0);

  // Só grava nos cursos onde a prévia realmente encontrou ocorrências: os
  // demais não têm nada a alterar e não precisam de uma chamada PUT.
  const targets = results.filter(r => r.status === 'ok').map(r => r.courseId);
  if (!targets.length) { bulkStatus('✗ Nenhum curso com ocorrências para aplicar.', '#f87171'); return; }

  const ok = await askBulkConfirm(total, targets, page.title, opts);
  if (!ok) return;

  const btn = $('btn-bulk-apply');
  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span>Gravando...';
  $('bulk-progress').textContent   = `Gravando em ${targets.length} curso(s)...`;
  $('bulk-progress').style.display = 'block';

  try {
    const applied = await bulkExec(bulkReplaceMain, [targets, page, opts, false]);
    buildBulkResults(applied, true);
    _bulkPreview = null;
    btn.style.display = 'none';
  } catch (err) {
    bulkStatus('✗ ' + err.message, '#f87171');
    btn.style.display = 'block';
  }

  $('bulk-progress').style.display = 'none';
  btn.disabled  = false;
  btn.innerHTML = '✅  Aplicar substituição';
}

// ── Vídeos em lote ───────────────────────────────────────────────────
// Passa nas páginas dos módulos marcados do curso da aba e põe todos os
// vídeos (Studio, YouTube, Vimeo, mídia do Canvas...) no tamanho das
// Configurações — a mesma regra do "Redimensionar vídeos da página"
// (video-size.js, carregado pelo popup.html). Só os atributos de tamanho dos
// vídeos mudam; o resto do HTML fica byte a byte igual. Primeiro a prévia; o
// "Aplicar" só começa depois de redigitar o número do curso da aba, e cada
// página é lida de novo na hora de gravar.

const VID_RECENT_MIN = 30;   // página editada há menos que isso: avisa na prévia

let _vidCourseId = null;      // curso que gerou a lista de módulos
let _vidModules  = [];        // [{ id, name, pages: [{ url, title }] }]
let _vidChecked  = new Set(); // ids dos módulos marcados
let _vidPreview  = null;      // { courseId, w, h, rows }
let _vidBusy     = false;
let _vidGen      = 0;         // muda a cada mudança na seleção: prévia em curso é descartada

function vidStatus(msg, color) {
  const el = $('vid-status');
  el.textContent = msg;
  el.style.color = color || '#94a3b8';
  el.style.display = msg ? 'block' : 'none';
}

function vidProgress(msg) {
  $('vid-progress').textContent   = msg || '';
  $('vid-progress').style.display = msg ? 'block' : 'none';
}

async function openVideos() {
  show('canvas-videos');
  $('vid-size-label').textContent = `${S.video_width}×${S.video_height}`;
  if (_vidBusy) return;
  const courseId = await getCanvasCourseId();
  $('vid-course-label').textContent = courseId ? `curso #${courseId}` : 'nenhum curso nesta aba';
  // Mudou de curso: módulos e prévia do anterior não valem mais.
  if (_vidCourseId && courseId !== _vidCourseId) vidReset();
}

function vidReset() {
  _vidCourseId = null;
  _vidModules  = [];
  _vidChecked  = new Set();
  vidDropPreview();
  $('vid-module-section').style.display = 'none';
  $('btn-vid-modules').textContent = '📚  Ler módulos do curso';
  vidStatus('');
}

function vidDropPreview() {
  _vidGen++;
  _vidPreview = null;
  $('vid-results').innerHTML = '';
  $('btn-vid-apply').style.display = 'none';
}

function vidSyncUI() {
  $('btn-vid-modules').disabled = _vidBusy;
  $('btn-vid-preview').disabled = _vidBusy;
  $('btn-vid-apply').disabled   = _vidBusy;
  $('btn-vid-toggle-all').disabled = _vidBusy;
  document.querySelectorAll('#vid-modules-list input').forEach(cb => { cb.disabled = _vidBusy || cb.dataset.empty === '1'; });
  const withPages = _vidModules.filter(m => m.pages.length);
  $('btn-vid-toggle-all').textContent =
    withPages.length && withPages.every(m => _vidChecked.has(m.id)) ? 'desmarcar todos' : 'marcar todos';
}

// Páginas dos módulos marcados, sem repetir a que aparece em dois módulos.
function vidSelectedPages() {
  const seen = new Set(), out = [];
  for (const m of _vidModules) {
    if (!_vidChecked.has(m.id)) continue;
    for (const pg of m.pages) {
      if (seen.has(pg.url)) continue;
      seen.add(pg.url);
      out.push({ ...pg, module: m.name });
    }
  }
  return out;
}

async function vidExec(tabId, courseId, op, p) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    func: vidCanvasMain,
    args: [op, courseId, p || null],
  });
  const out = res[0]?.result;
  if (out && out.__error) throw new Error(out.__error);
  return out;
}

// Roda na aba do Canvas (sessão + CSRF). Uma só função serializada para as
// operações: 'modules' (módulos com as páginas de cada um), 'get' e 'put'.
function vidCanvasMain(op, courseId, p) {
  return (async () => {
    try {
      const api   = `/api/v1/courses/${courseId}`;
      const delay = ms => new Promise(r => setTimeout(r, ms));

      async function safeFetch(url, opts = {}) {
        for (let attempt = 0; attempt <= 2; attempt++) {
          const res = await fetch(url, opts);
          if (res.status === 429) { await delay(2000 * (attempt + 1)); continue; }
          const remaining = parseFloat(res.headers.get('X-Rate-Limit-Remaining') || '999');
          if (remaining < 30) await delay(800);
          return res;
        }
        throw new Error('Limite de requisições do Canvas esgotado após 3 tentativas');
      }

      async function fetchAll(url) {
        const out = [];
        let next = url;
        while (next) {
          const res = await safeFetch(next);
          if (!res.ok) throw new Error(`HTTP ${res.status} ao ler ${url.split('?')[0]}`);
          const data = await res.json();
          if (Array.isArray(data)) out.push(...data);
          const m = (res.headers.get('Link') || '').match(/<([^>]+)>;\s*rel="next"/);
          next = m ? m[1] : null;
        }
        return out;
      }

      if (op === 'modules') {
        const mods = await fetchAll(`${api}/modules?include[]=items&per_page=100`);
        const out  = [];
        for (const m of mods) {
          // Módulo com muitos itens vem sem a lista: busca à parte.
          const items = Array.isArray(m.items) ? m.items : await fetchAll(`${api}/modules/${m.id}/items?per_page=100`);
          out.push({
            id: m.id, name: m.name,
            pages: items.filter(it => it.type === 'Page' && it.page_url).map(it => ({ url: it.page_url, title: it.title })),
          });
        }
        return out;
      }

      const pageApi = `${api}/pages/${encodeURIComponent(p.url)}`;

      if (op === 'get') {
        const res = await safeFetch(pageApi);
        if (!res.ok) throw new Error(`HTTP ${res.status} ao ler a página`);
        const pg = await res.json();
        return { body: pg.body || '', updatedAt: pg.updated_at || null, editor: pg.last_edited_by?.display_name || '' };
      }

      if (op === 'put') {
        const rawCsrf = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('_csrf_token='));
        const csrf = rawCsrf
          ? decodeURIComponent(rawCsrf.split('=').slice(1).join('='))
          : decodeURIComponent(document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '');
        const res = await safeFetch(pageApi, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body:    JSON.stringify({ wiki_page: { body: p.body } }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status} ao gravar${text ? ' — ' + text.slice(0, 120) : ''}`);
        let saved = null;
        try { saved = text ? JSON.parse(text) : null; } catch { saved = null; }
        return { body: typeof saved?.body === 'string' ? saved.body : null };
      }

      return { __error: 'Operação desconhecida: ' + op };
    } catch (err) {
      return { __error: err.message };
    }
  })();
}

async function doVidLoadModules() {
  if (_vidBusy) return;
  const btn = $('btn-vid-modules');
  _vidBusy = true;
  vidSyncUI();
  btn.innerHTML = '<span class="spinner"></span>Lendo módulos...';

  try {
    const { tabId, courseId } = await matCanvasTab();
    const mods = await vidExec(tabId, courseId, 'modules');
    vidReset();
    _vidCourseId = courseId;
    _vidModules  = mods;
    // Começa com todos os módulos que têm páginas marcados.
    _vidChecked  = new Set(mods.filter(m => m.pages.length).map(m => m.id));
    $('vid-course-label').textContent = `curso #${courseId}`;
    const pages = vidSelectedPages().length;
    if (!mods.length) {
      vidStatus(`Nenhum módulo no curso #${courseId}.`, '#f97316');
    } else {
      vidStatus(`${mods.length} módulo(s), ${pages} página(s) no curso #${courseId}`, '#4ade80');
      buildVidModules();
      $('vid-module-section').style.display = 'block';
    }
  } catch (err) {
    vidStatus('✗ ' + err.message, '#f87171');
  }

  _vidBusy = false;
  btn.textContent = _vidModules.length ? '🔄  Reler módulos do curso' : '📚  Ler módulos do curso';
  vidSyncUI();
}

function buildVidModules() {
  buildModuleChecks($('vid-modules-list'), _vidModules, _vidChecked, 'vid', () => { vidDropPreview(); vidSyncUI(); });
  vidSyncUI();
}

// Lista de módulos com caixa de marcar (Vídeos em lote e Vídeos do Studio).
// checked é o Set de ids marcados; onChange roda a cada clique.
function buildModuleChecks(list, modules, checked, prefix, onChange) {
  list.innerHTML = '';
  for (const m of modules) {
    const row = document.createElement('label');
    row.className = 'bulk-page-item vid-mod-item' + (m.pages.length ? '' : ' empty');

    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.id      = `${prefix}-mod-${m.id}`;
    cb.checked = checked.has(m.id);
    if (!m.pages.length) cb.dataset.empty = '1';
    cb.addEventListener('change', () => {
      if (cb.checked) checked.add(m.id); else checked.delete(m.id);
      onChange();
    });
    row.appendChild(cb);

    const title = document.createElement('span');
    title.className   = 'bulk-page-title';
    title.textContent = m.name;
    row.appendChild(title);

    const count = document.createElement('span');
    count.className   = 'vid-mod-count';
    count.textContent = m.pages.length ? `${m.pages.length} pág.` : 'sem páginas';
    row.appendChild(count);

    list.appendChild(row);
  }
}

function vidToggleAll() {
  const withPages = _vidModules.filter(m => m.pages.length);
  const allOn = withPages.every(m => _vidChecked.has(m.id));
  _vidChecked = new Set(allOn ? [] : withPages.map(m => m.id));
  vidDropPreview();
  buildVidModules();
}

// Aba do curso dos módulos lidos — trocar de aba no meio não muda o destino.
async function vidCourseTab() {
  const tab = await matCanvasTab();
  if (tab.courseId !== _vidCourseId) {
    throw new Error(`A aba ativa é do curso #${tab.courseId}, mas os módulos lidos são do curso #${_vidCourseId}. Volte para a aba do curso ou clique em "Reler módulos do curso".`);
  }
  return tab;
}

const vidVideoList = (videos, w, h, applied) => videos.map(v => v.changed
  ? `${v.label} ${v.size} → ${w}×${h}`
  : `<span class="vid-ok">${v.label} ${v.size}${applied ? '' : ' (já está)'}</span>`).join(' · ');

function buildVidResults(rows, applied, w, h) {
  const box = $('vid-results');
  box.innerHTML = '';

  const changed = rows.filter(r => r.changes > 0 && r.status !== 'error');
  const videos  = changed.reduce((n, r) => n + r.changes, 0);
  const errors  = rows.filter(r => r.status === 'error').length;
  const nothing = rows.length - changed.length - errors;

  const head = document.createElement('div');
  head.className = 'small';
  head.style.marginBottom = '6px';
  const tail = (nothing ? ` ${nothing} página(s) sem nada a mudar.` : '') + (errors ? ` ${errors} com erro.` : '');
  if (applied) {
    head.style.color = videos ? '#4ade80' : '#94a3b8';
    head.textContent = (videos ? `✅ ${videos} vídeo(s) gravado(s) em ${w}×${h}, em ${changed.length} página(s).` : 'Nada foi alterado.') + tail;
  } else {
    head.style.color = videos ? '#60a5fa' : '#f97316';
    head.textContent = (videos
      ? `Prévia — ${videos} vídeo(s) em ${changed.length} página(s) vão para ${w}×${h}.`
      : 'Prévia — nenhum vídeo para mudar.') + tail + ' Nada foi gravado ainda.';
  }
  box.appendChild(head);

  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'bulk-course-row ' + r.status;

    const h1 = document.createElement('div');
    h1.className = 'bulk-course-row-head';
    const icon = { ok: '✅', zero: '—', warn: '⚠', error: '✗' }[r.status] || '—';
    h1.innerHTML = `<span>${icon}</span><span class="bulk-page-title" title="${clEsc(r.module)}">${clEsc(r.title)}</span>` +
      (r.changes ? `<span class="bulk-count">${r.changes}×</span>` : '');
    row.appendChild(h1);

    if (r.videos?.length) {
      const vl = document.createElement('div');
      vl.className = 'vid-video-list';
      vl.innerHTML = vidVideoList(r.videos, w, h, applied);
      row.appendChild(vl);
    }

    const note = r.note || (r.status === 'zero' && !r.videos?.length ? 'Sem vídeos nesta página.' : '');
    if (note) {
      const n = document.createElement('div');
      n.className   = 'bulk-course-note';
      n.textContent = note;
      row.appendChild(n);
    }
    box.appendChild(row);
  }
}

async function doVidPreview() {
  if (_vidBusy) return;
  const pages = vidSelectedPages();
  if (!pages.length) { vidStatus('✗ Marque ao menos um módulo com páginas.', '#f87171'); return; }

  let tab;
  try { tab = await vidCourseTab(); } catch (err) { vidStatus('✗ ' + err.message, '#f87171'); return; }

  const { videoEdits } = window.__svcVideoSize;
  const courseId = _vidCourseId, w = S.video_width, h = S.video_height;
  vidDropPreview();
  const gen = _vidGen;
  _vidBusy = true;
  vidSyncUI();
  vidStatus('');
  $('btn-vid-preview').innerHTML = '<span class="spinner"></span>Lendo páginas...';

  const rows = [];
  for (let i = 0; i < pages.length; i++) {
    vidProgress(`Lendo página ${i + 1} de ${pages.length}...`);
    const pg  = pages[i];
    const row = { url: pg.url, title: pg.title, module: pg.module, changes: 0 };
    try {
      const got = await vidExec(tab.tabId, courseId, 'get', { url: pg.url });
      const r   = videoEdits(got.body, w, h);
      row.changes = r.edits.length;
      row.videos  = r.videos;
      row.status  = r.edits.length ? 'ok' : 'zero';
      // Alguém pode estar com a página aberta no editor: se salvar depois do
      // lote, a versão dessa pessoa sobrescreve a mudança nesta página.
      const mins = got.updatedAt ? (Date.now() - new Date(got.updatedAt).getTime()) / 60000 : Infinity;
      if (r.edits.length && mins < VID_RECENT_MIN) {
        row.status = 'warn';
        row.note   = `Editada há ${Math.max(1, Math.round(mins))} min${got.editor ? ' por ' + got.editor : ''}. Se a página ainda estiver aberta no editor e for salva depois, a mudança se perde nela.`;
      }
    } catch (err) {
      row.status = 'error';
      row.note   = err.message;
    }
    rows.push(row);
  }

  _vidBusy = false;
  vidProgress('');
  $('btn-vid-preview').textContent = '👁  Ver prévia';
  if (gen === _vidGen) {
    _vidPreview = { courseId, w, h, rows };
    buildVidResults(rows, false, w, h);
    const n = rows.filter(r => r.changes > 0 && r.status !== 'error').length;
    if (n) {
      $('btn-vid-apply').textContent   = `✅  Aplicar em ${n} página(s)`;
      $('btn-vid-apply').style.display = 'block';
    }
  }
  vidSyncUI();
}

const confirmRow = (label, html) => `<div class="bc-row"><span class="bc-label">${label}:</span> ${html}</div>`;

function askVidConfirm(pages, videos, preview) {
  return askCourseConfirm(
    `${videos} vídeo(s) em ${pages.length} página(s) vão para ${preview.w}×${preview.h}. Grava direto no Canvas.`,
    confirmRow('Tamanho', `<code>${preview.w}×${preview.h}</code>`) +
    confirmRow('Páginas', pages.map(p => clEsc(p.title)).join(', ')),
    preview.courseId);
}

// Modal próprio (diálogos nativos não aparecem direito no side panel). Só
// libera quando o número digitado é o do curso da aba ativa — e esse curso
// tem que ser o da prévia (courseId). Devolve a aba ({ tabId, courseId }) ou null.
function askCourseConfirm(sub, detailHtml, courseId) {
  return new Promise(resolve => {
    const modal = $('modal-vid-confirm');
    const input = $('vid-confirm-course');
    const alertEl = $('vid-confirm-alert');

    $('vid-confirm-sub').textContent = sub;
    $('vid-confirm-detail').innerHTML = detailHtml;
    input.value = '';
    alertEl.style.display = 'none';
    modal.style.display = 'flex';
    input.focus();

    const warn = msg => { alertEl.textContent = '⚠ ' + msg; alertEl.style.display = 'block'; input.focus(); input.select(); };

    function finish(value) {
      modal.style.display = 'none';
      document.removeEventListener('keydown', onKey);
      input.onkeydown = null;
      resolve(value);
    }
    function onKey(e) { if (e.key === 'Escape') finish(null); }

    async function tryOk() {
      const typed = input.value.trim();
      if (!/^\d+$/.test(typed)) { warn('Digite o número do curso (só os algarismos).'); return; }
      let tab;
      try { tab = await matCanvasTab(); } catch (err) { warn(err.message); return; }
      if (typed !== tab.courseId) {
        warn(`O número digitado (${typed}) não é o do curso da aba aberta. Confira a aba e o número — nada foi alterado.`);
        return;
      }
      if (tab.courseId !== courseId) {
        warn(`A aba aberta é de outro curso, não do curso da prévia (#${courseId}). Volte para a aba desse curso ou rode a prévia de novo — nada foi alterado.`);
        return;
      }
      finish(tab);
    }

    $('btn-vid-confirm-ok').onclick     = tryOk;
    $('btn-vid-confirm-cancel').onclick = () => finish(null);
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); tryOk(); } };
    document.addEventListener('keydown', onKey);
  });
}

async function doVidApply() {
  if (_vidBusy) return;
  const preview = _vidPreview;
  if (!preview) { vidStatus('✗ Rode a prévia antes de aplicar.', '#f87171'); return; }
  if (S.video_width !== preview.w || S.video_height !== preview.h) {
    vidDropPreview();
    vidStatus('✗ O tamanho das Configurações mudou depois da prévia — rode a prévia de novo.', '#f87171');
    return;
  }
  const targets = preview.rows.filter(r => r.changes > 0 && r.status !== 'error');
  if (!targets.length) { vidStatus('✗ Nenhuma página com vídeo para mudar.', '#f87171'); return; }

  const tab = await askVidConfirm(targets, targets.reduce((n, r) => n + r.changes, 0), preview);
  if (!tab) return;

  // Trava antes do primeiro await seguinte — senão um duplo clique grava duas vezes.
  _vidBusy = true;
  vidSyncUI();
  vidStatus('');
  $('btn-vid-apply').innerHTML = '<span class="spinner"></span>Gravando...';

  const { videoEdits, applyEdits } = window.__svcVideoSize;
  const { w, h, courseId } = preview;
  const rows = [];
  for (let i = 0; i < targets.length; i++) {
    vidProgress(`Gravando página ${i + 1} de ${targets.length}... mantenha o painel aberto.`);
    const t   = targets[i];
    const row = { url: t.url, title: t.title, module: t.module, changes: 0 };
    try {
      // Lê de novo: se alguém salvou depois da prévia, vale o conteúdo novo.
      const got = await vidExec(tab.tabId, courseId, 'get', { url: t.url });
      const r   = videoEdits(got.body, w, h);
      row.videos = r.videos;
      if (!r.edits.length) {
        row.status = 'zero';
        row.note   = `Os vídeos já estavam em ${w}×${h} — nada gravado.`;
      } else {
        const saved = await vidExec(tab.tabId, courseId, 'put', { url: t.url, body: applyEdits(got.body, r.edits) });
        row.changes = r.edits.length;
        // Confere o que o Canvas gravou.
        const left = saved.body === null ? 0 : videoEdits(saved.body, w, h).edits.length;
        row.status = left ? 'warn' : 'ok';
        if (left) row.note = `O Canvas gravou a página, mas ${left} vídeo(s) não ficaram em ${w}×${h}. Confira no editor.`;
      }
    } catch (err) {
      row.status = 'error';
      row.note   = err.message;
    }
    rows.push(row);
  }

  _vidBusy = false;
  vidProgress('');
  _vidPreview = null;
  $('btn-vid-apply').style.display = 'none';
  $('btn-vid-apply').textContent   = '✅  Aplicar';
  buildVidResults(rows, true, w, h);
  vidSyncUI();
}

// ── Inserir vídeos do Studio ──────────────────────────────────────────
// 1) Lê os vídeos da coleção do curso no Studio: abre o Studio do curso numa
//    aba; studio-hook.js + studio-capture.js gravam a lista em
//    studioVideos:<curso> e esta tela acompanha a chave. 2) A planilha (Página ·
//    Título · Vídeo) vem de .xlsx/.csv ou colada. 3) As páginas são procuradas
//    só nos módulos marcados (começa sem nenhum: a unidade é escolhida de
//    propósito). A prévia casa página e vídeo pelo nome e mostra o que entra em
//    cada espaço [ ... ] (regra em video-slots.js). Gravar segue as travas do
//    "Vídeos em lote": redigitar o número do curso, ler cada página de novo
//    (e parar se ela mudou) e conferir o que o Canvas gravou.

const STU_TOOL_ID = 33;      // Studio na conta da PUC: /courses/<id>/external_tools/33
const STU_WAIT_MS = 45000;   // tempo para o Studio abrir e mandar a lista
const STU_SETTLE  = 6000;    // lista incompleta parada há tanto tempo: fica com o que veio

let _stuCourseId = null;      // curso dos módulos lidos
let _stuModules  = [];        // [{ id, name, pages: [{ url, title }] }]
let _stuChecked  = new Set();
let _stuRows     = [];        // linhas da planilha com página
let _stuSheetBad = [];        // linhas sem página: [{ line, msg }]
let _stuPreview  = null;      // { courseId, w, h, studio, pages }
let _stuBusy     = false;
let _stuGen      = 0;         // muda quando algo da prévia muda: prévia em curso é descartada
let _stuReading  = null;      // leitura do Studio em andamento

function stuStatus(msg, color) {
  const el = $('stu-status');
  el.textContent = msg;
  el.style.color = color || '#94a3b8';
  el.style.display = msg ? 'block' : 'none';
}

function stuProgress(msg) {
  $('stu-progress').textContent   = msg || '';
  $('stu-progress').style.display = msg ? 'block' : 'none';
}

async function openStudio() {
  show('canvas-studio');
  if (_stuBusy) return;
  const courseId = await getCanvasCourseId();
  $('stu-course-label').textContent = courseId ? `curso #${courseId}` : 'nenhum curso nesta aba';
  if (_stuCourseId && courseId !== _stuCourseId) stuReset();
  stuRenderStudio(await stuLoadStudio(courseId), courseId);
  stuSyncUI();
}

function stuReset() {
  _stuCourseId = null;
  _stuModules  = [];
  _stuChecked  = new Set();
  stuDropPreview();
  $('stu-module-section').style.display = 'none';
  $('btn-stu-modules').textContent = '📚  3. Ler módulos do curso';
  stuStatus('');
}

function stuDropPreview() {
  _stuGen++;
  _stuPreview = null;
  $('stu-results').innerHTML = '';
  $('btn-stu-apply').style.display = 'none';
}

function stuSyncUI() {
  const busy = _stuBusy || !!_stuReading;
  $('btn-stu-read').disabled     = busy;
  $('btn-stu-file').disabled     = _stuBusy;
  $('stu-sheet').disabled        = _stuBusy;
  $('btn-stu-modules').disabled  = _stuBusy;
  $('btn-stu-preview').disabled  = _stuBusy || !_stuChecked.size;
  $('btn-stu-apply').disabled    = _stuBusy;
  $('btn-stu-toggle-all').disabled = _stuBusy;
  document.querySelectorAll('#stu-modules-list input').forEach(cb => { cb.disabled = _stuBusy || cb.dataset.empty === '1'; });
  const withPages = _stuModules.filter(m => m.pages.length);
  $('btn-stu-toggle-all').textContent =
    withPages.length && withPages.every(m => _stuChecked.has(m.id)) ? 'desmarcar todos' : 'marcar todos';
}

// ── 1. Vídeos do Studio ──
async function stuLoadStudio(courseId) {
  if (!courseId) return null;
  const key = 'studioVideos:' + courseId;
  return (await chrome.storage.local.get(key))[key] || null;
}

function stuAgo(ts) {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`;
  return 'em ' + new Date(ts).toLocaleDateString('pt-BR');
}

function stuRenderStudio(rec, courseId) {
  const el = $('stu-studio-info');
  el.style.color = '';
  if (!courseId) { el.textContent = 'Abra uma aba de um curso no Canvas.'; return; }
  if (!rec) { el.textContent = 'Ainda não lidos neste curso.'; return; }
  const n = rec.videos.length;
  const partial = rec.total != null && n < rec.total;
  el.textContent = `${n}${partial ? ` de ${rec.total}` : ''} vídeo(s)` +
    (rec.collectionName ? ` · coleção "${rec.collectionName}"` : '') + ` · lidos ${stuAgo(rec.capturedAt)}` +
    (partial ? ' — lista incompleta, leia de novo.' : '');
  el.style.color = partial ? '#f97316' : '#4ade80';
}

async function doStuRead() {
  if (_stuBusy || _stuReading) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const m = (tab?.url || '').match(/^(https:\/\/[^/]+)\/courses\/(\d+)/);
  if (!m) { stuStatus('✗ Abra uma aba de um curso no Canvas para ler os vídeos do Studio.', '#f87171'); return; }
  stuStatus('');
  const r = _stuReading = { courseId: m[2], prevTabId: tab.id, tabId: null, since: Date.now(), got: null, timer: null, settle: null };
  $('btn-stu-read').innerHTML = '<span class="spinner"></span>Lendo o Studio...';
  stuSyncUI();
  try {
    const studioTab = await chrome.tabs.create({ url: `${m[1]}/courses/${m[2]}/external_tools/${STU_TOOL_ID}`, active: true });
    r.tabId = studioTab.id;
    r.timer = setTimeout(stuReadTimeout, STU_WAIT_MS);
  } catch (err) {
    _stuReading = null;
    $('btn-stu-read').textContent = '🎬  Ler vídeos do Studio';
    stuStatus('✗ Não consegui abrir o Studio: ' + err.message, '#f87171');
    stuSyncUI();
  }
}

// studio-capture.js gravou (ou atualizou) a lista de um curso.
async function stuOnStudio(courseId, rec) {
  if (courseId === (await getCanvasCourseId())) stuRenderStudio(rec, courseId);
  if (!_stuBusy && _stuPreview?.courseId === courseId) stuDropPreview();
  const r = _stuReading;
  if (!r || r.courseId !== courseId || !rec || rec.capturedAt < r.since) return;
  r.got = rec;
  clearTimeout(r.settle);
  // Completa: pronto. Senão, as outras páginas da lista ainda podem chegar.
  r.settle = setTimeout(stuReadDone, rec.total != null && rec.videos.length >= rec.total ? 0 : STU_SETTLE);
}

function stuReadDone() {
  const r = _stuReading;
  if (!r) return;
  clearTimeout(r.timer);
  clearTimeout(r.settle);
  _stuReading = null;
  const rec = r.got;
  $('btn-stu-read').textContent = rec ? '🔄  Ler vídeos do Studio de novo' : '🎬  Ler vídeos do Studio';
  if (rec) {
    // A aba do Studio foi aberta só para a leitura: fecha e volta para o curso.
    chrome.tabs.update(r.prevTabId, { active: true }).catch(() => {});
    if (r.tabId != null) chrome.tabs.remove(r.tabId).catch(() => {});
    stuRenderStudio(rec, r.courseId);
    if (rec.total != null && rec.videos.length < rec.total) {
      stuStatus(`⚠ A coleção tem ${rec.total} vídeos, mas só ${rec.videos.length} foram lidos. Os que faltaram vão aparecer como "não está na coleção do Studio".`, '#f97316');
    }
  }
  stuSyncUI();
}

function stuReadTimeout() {
  const r = _stuReading;
  if (!r) return;
  if (r.got) { stuReadDone(); return; }
  clearTimeout(r.settle);
  _stuReading = null;
  $('btn-stu-read').textContent = '🎬  Ler vídeos do Studio';
  stuStatus('✗ O Studio não mandou a lista de vídeos. Na aba do Studio que ficou aberta, confira se a coleção do curso aparece (se pedir login, entre): a leitura acontece sozinha quando a lista carregar. Ou clique de novo em "Ler vídeos do Studio".', '#f87171');
  stuSyncUI();
}

// ── 2. Planilha ──
async function stuOnFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    let text;
    if (/\.xlsx$/i.test(file.name)) {
      const table = await window.__svcXlsx.readSheet(await file.arrayBuffer());
      // Vira texto separado por tab — o mesmo de colar —, para dar para conferir e corrigir aqui.
      text = table.map(r => r.map(c => /[\t\n"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join('\t')).join('\n');
    } else {
      text = await file.text();
    }
    $('stu-sheet').value = text;
    stuParseSheet();
  } catch (err) {
    stuStatus(`✗ Não consegui ler ${file.name}: ${err.message}`, '#f87171');
  }
}

function stuParseSheet() {
  const { parseTable, sheetRows, groupByPage } = window.__svcVideoSlots;
  const text = $('stu-sheet').value;
  const info = $('stu-sheet-info');
  stuDropPreview();
  const { rows, problems } = text.trim() ? sheetRows(parseTable(text)) : { rows: [], problems: [] };
  _stuRows = rows;
  _stuSheetBad = problems;
  if (!text.trim()) { info.style.display = 'none'; stuSyncUI(); return; }
  const noVideo = rows.filter(r => r.problem);
  let msg = rows.length ? `${rows.length} vídeo(s) em ${groupByPage(rows).length} página(s).` : 'Nenhuma linha com página e vídeo.';
  const bad = [...problems, ...noVideo.map(r => ({ line: r.line, msg: 'falta o nome do vídeo' }))].sort((a, b) => a.line - b.line);
  if (bad.length) msg += ' ' + bad.slice(0, 3).map(p => `Linha ${p.line}: ${p.msg}.`).join(' ') + (bad.length > 3 ? ` (+${bad.length - 3})` : '');
  info.textContent = msg;
  info.style.color = bad.length || !rows.length ? '#f97316' : '#4ade80';
  info.style.display = 'block';
  stuSyncUI();
}

// ── 3. Módulos ──
async function doStuLoadModules() {
  if (_stuBusy) return;
  const btn = $('btn-stu-modules');
  _stuBusy = true;
  stuSyncUI();
  btn.innerHTML = '<span class="spinner"></span>Lendo módulos...';
  try {
    const { tabId, courseId } = await matCanvasTab();
    const mods = await vidExec(tabId, courseId, 'modules');
    stuReset();
    _stuCourseId = courseId;
    _stuModules  = mods;
    $('stu-course-label').textContent = `curso #${courseId}`;
    if (!mods.length) {
      stuStatus(`Nenhum módulo no curso #${courseId}.`, '#f97316');
    } else {
      buildModuleChecks($('stu-modules-list'), _stuModules, _stuChecked, 'stu', () => { stuDropPreview(); stuSyncUI(); });
      $('stu-module-section').style.display = 'block';
    }
  } catch (err) {
    stuStatus('✗ ' + err.message, '#f87171');
  }
  _stuBusy = false;
  btn.textContent = _stuModules.length ? '🔄  3. Reler módulos do curso' : '📚  3. Ler módulos do curso';
  stuSyncUI();
}

function stuToggleAll() {
  const withPages = _stuModules.filter(m => m.pages.length);
  const allOn = withPages.every(m => _stuChecked.has(m.id));
  _stuChecked = new Set(allOn ? [] : withPages.map(m => m.id));
  stuDropPreview();
  buildModuleChecks($('stu-modules-list'), _stuModules, _stuChecked, 'stu', () => { stuDropPreview(); stuSyncUI(); });
  stuSyncUI();
}

// Páginas dos módulos (marcados ou todos), sem repetir, com o nome do módulo.
function stuPages(onlyChecked) {
  const seen = new Set(), out = [];
  for (const m of _stuModules) {
    if (onlyChecked && !_stuChecked.has(m.id)) continue;
    for (const pg of m.pages) {
      if (seen.has(pg.url)) continue;
      seen.add(pg.url);
      out.push({ ...pg, module: m.name });
    }
  }
  return out;
}

// ── Prévia e gravação ──
async function doStuPreview() {
  if (_stuBusy) return;
  const VS = window.__svcVideoSlots;
  let tab;
  try {
    tab = await matCanvasTab();
    if (tab.courseId !== _stuCourseId) throw new Error(`A aba ativa é do curso #${tab.courseId}, mas os módulos lidos são do curso #${_stuCourseId}. Volte para a aba do curso ou clique em "Reler módulos do curso".`);
  } catch (err) { stuStatus('✗ ' + err.message, '#f87171'); return; }

  const courseId = _stuCourseId, w = S.video_width, h = S.video_height;
  const studio = await stuLoadStudio(courseId);
  stuParseSheet();
  if (!studio?.videos?.length) { stuStatus('✗ Leia os vídeos do Studio deste curso primeiro (passo 1).', '#f87171'); return; }
  if (!_stuRows.length) { stuStatus('✗ Envie ou cole a planilha (passo 2).', '#f87171'); return; }
  if (_stuSheetBad.length) { stuStatus(`✗ Linha ${_stuSheetBad[0].line} da planilha sem o nome da página. Corrija antes da prévia: não dá para saber em que página esse vídeo entra.`, '#f87171'); return; }
  if (!_stuChecked.size) { stuStatus('✗ Marque o módulo (ou os módulos) onde estão as páginas.', '#f87171'); return; }

  const checkedPages = stuPages(true), allPages = stuPages(false);
  const groups = VS.groupByPage(_stuRows);
  const gen = _stuGen;
  _stuBusy = true;
  stuSyncUI();
  stuStatus('');
  $('btn-stu-preview').innerHTML = '<span class="spinner"></span>Lendo páginas...';

  const rows = [];
  for (let i = 0; i < groups.length; i++) {
    stuProgress(`Lendo página ${i + 1} de ${groups.length}...`);
    const g = groups[i];
    const row = { name: g.name, rows: g.rows, page: null, plan: null, status: 'error', note: '' };
    rows.push(row);
    const m = VS.matchPage(g.name, checkedPages);
    if (!m.page) {
      const other = m.notFound ? VS.matchPage(g.name, allPages) : null;
      if (other?.page) {
        row.page   = other.page;
        row.status = 'skip';
        row.note   = `Está no módulo "${other.page.module}", que não está marcado — fica como está.`;
      } else {
        row.note = m.error;
      }
      continue;
    }
    row.page = m.page;
    try {
      const got  = await vidExec(tab.tabId, courseId, 'get', { url: m.page.url });
      const plan = VS.planPage({ body: got.body, rows: g.rows, videos: studio.videos, courseId, studioDomain: studio.studioDomain, w, h });
      row.plan   = plan;
      row.status = plan.html ? 'ok' : 'error';
      const notes = [];
      if (plan.html && plan.left) notes.push(`${plan.left} espaço(s) da página ficam sem vídeo: a planilha tem menos linhas.`);
      const mins = got.updatedAt ? (Date.now() - new Date(got.updatedAt).getTime()) / 60000 : Infinity;
      if (plan.html && mins < VID_RECENT_MIN) notes.push(`Editada há ${Math.max(1, Math.round(mins))} min${got.editor ? ' por ' + got.editor : ''}. Se ainda estiver aberta no editor e for salva depois, a mudança se perde.`);
      if (plan.html && notes.length) row.status = 'warn';
      row.note = notes.join(' ');
    } catch (err) {
      row.note = err.message;
    }
  }

  // Dois nomes da planilha caindo na mesma página: não dá para saber a ordem.
  const byUrl = new Map();
  for (const r of rows) if (r.page && r.status !== 'skip') byUrl.set(r.page.url, [...(byUrl.get(r.page.url) || []), r]);
  for (const list of byUrl.values()) {
    if (list.length < 2) continue;
    for (const r of list) {
      r.status = 'error';
      r.note = `Na planilha, ${list.map(x => `"${x.name}"`).join(' e ')} caem na mesma página. Use um nome só.`;
    }
  }

  _stuBusy = false;
  stuProgress('');
  $('btn-stu-preview').textContent = '👁  Ver prévia';
  if (gen === _stuGen) {
    _stuPreview = { courseId, w, h, studio, pages: rows };
    buildStuResults(rows, false);
    const n = rows.filter(stuReady).length;
    if (n) {
      $('btn-stu-apply').textContent   = `✅  Aplicar em ${n} página(s)`;
      $('btn-stu-apply').style.display = 'block';
    }
  }
  stuSyncUI();
}

const stuReady = r => (r.status === 'ok' || r.status === 'warn') && !!r.plan?.html;

function buildStuResults(rows, applied) {
  const box = $('stu-results');
  box.innerHTML = '';
  const ready  = rows.filter(r => applied ? r.status === 'ok' || r.status === 'warn' : stuReady(r));
  const videos = ready.reduce((n, r) => n + r.rows.length, 0);
  const errors = rows.filter(r => r.status === 'error').length;
  const skips  = rows.filter(r => r.status === 'skip').length;

  const head = document.createElement('div');
  head.className = 'small';
  head.style.marginBottom = '6px';
  const tail = (errors ? ` ${errors} página(s) com problema${applied ? '' : ' não serão gravadas'}.` : '') +
    (skips ? ` ${skips} fora dos módulos marcados.` : '');
  if (applied) {
    head.style.color = videos ? '#4ade80' : '#94a3b8';
    head.textContent = (videos ? `✅ ${videos} vídeo(s) inseridos em ${ready.length} página(s).` : 'Nada foi gravado.') + tail;
  } else {
    head.style.color = videos ? '#60a5fa' : '#f97316';
    head.textContent = (videos ? `Prévia — ${videos} vídeo(s) em ${ready.length} página(s).` : 'Prévia — nenhuma página pronta.') + tail + ' Nada foi gravado ainda.';
  }
  box.appendChild(head);

  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'bulk-course-row ' + (r.status === 'skip' ? 'zero' : r.status);

    const h1 = document.createElement('div');
    h1.className = 'bulk-course-row-head';
    const icon = { ok: '✅', warn: '⚠', error: '✗', skip: '—' }[r.status] || '—';
    const title = r.page ? r.page.title : r.name;
    h1.innerHTML = `<span>${icon}</span><span class="bulk-page-title" title="${clEsc(r.page?.module || '')}">${clEsc(title)}</span>` +
      `<span class="bulk-count">${r.rows.length}×</span>`;
    row.appendChild(h1);

    // Um item por linha da planilha: espaço da página → título · vídeo.
    if (r.status !== 'skip') {
      const items = r.plan ? r.plan.items : r.rows.map(x => ({ line: x.line, title: x.title, video: x.video }));
      const vl = document.createElement('div');
      vl.className = 'vid-video-list';
      vl.innerHTML = items.map((it, i) => {
        if (it.problem) return `<span class="stu-bad">✗ linha ${it.line} · ${clEsc(it.video || '—')}: ${clEsc(it.problem)}</span>`;
        if (!it.studio) return `linha ${it.line} · ${clEsc(it.video)}`;
        const where = it.headingText && it.title ? `${clEsc(it.headingText)} → "${clEsc(it.title)}"` : clEsc(it.headingText || it.slotText);
        return `${i + 1}. ${where} · 🎬 ${clEsc(it.studio.title)}`;
      }).join('<br>');
      row.appendChild(vl);
    }

    if (r.note) {
      const n = document.createElement('div');
      n.className   = 'bulk-course-note';
      n.textContent = r.note;
      row.appendChild(n);
    }
    box.appendChild(row);
  }
}

async function doStuApply() {
  if (_stuBusy) return;
  const preview = _stuPreview;
  if (!preview) { stuStatus('✗ Rode a prévia antes de aplicar.', '#f87171'); return; }
  if (S.video_width !== preview.w || S.video_height !== preview.h) {
    stuDropPreview();
    stuStatus('✗ O tamanho das Configurações mudou depois da prévia — rode a prévia de novo.', '#f87171');
    return;
  }
  const targets = preview.pages.filter(stuReady);
  if (!targets.length) { stuStatus('✗ Nenhuma página pronta para gravar.', '#f87171'); return; }
  const videos = targets.reduce((n, r) => n + r.rows.length, 0);

  const tab = await askCourseConfirm(
    `${videos} vídeo(s) do Studio entram em ${targets.length} página(s). Grava direto no Canvas.`,
    confirmRow('Tamanho', `<code>${preview.w}×${preview.h}</code>`) +
    confirmRow('Páginas', targets.map(r => clEsc(r.page.title)).join(', ')),
    preview.courseId);
  if (!tab) return;

  // Trava antes do primeiro await seguinte — senão um duplo clique grava duas vezes.
  _stuBusy = true;
  stuSyncUI();
  stuStatus('');
  $('btn-stu-apply').innerHTML = '<span class="spinner"></span>Gravando...';

  const VS = window.__svcVideoSlots;
  const { courseId, w, h, studio } = preview;
  const rows = [];
  for (let i = 0; i < targets.length; i++) {
    stuProgress(`Gravando página ${i + 1} de ${targets.length}... mantenha o painel aberto.`);
    const t   = targets[i];
    const row = { ...t, status: 'error', note: '' };
    rows.push(row);
    try {
      // Lê de novo: se alguém mexeu na página depois da prévia, para nela.
      const got  = await vidExec(tab.tabId, courseId, 'get', { url: t.page.url });
      const plan = VS.planPage({ body: got.body, rows: t.rows, videos: studio.videos, courseId, studioDomain: studio.studioDomain, w, h });
      row.plan = plan;
      if (!plan.html || plan.slotCount !== t.plan.slotCount) {
        row.note = `A página mudou depois da prévia (tinha ${t.plan.slotCount} espaço(s) de vídeo, agora tem ${plan.slotCount}). Nada gravado nela — rode a prévia de novo.`;
        continue;
      }
      const saved = await vidExec(tab.tabId, courseId, 'put', { url: t.page.url, body: plan.html });
      // Confere o que o Canvas gravou: os vídeos estão lá e só sobraram os espaços esperados.
      const body = saved.body;
      const missing = body === null ? [] : plan.items.filter(it => !body.includes(it.studio.id));
      const left    = body === null ? plan.left : VS.findSlots(body).length;
      if (missing.length || left !== plan.left) {
        row.status = 'warn';
        row.note = `O Canvas gravou a página, mas ${missing.length ? `${missing.length} vídeo(s) não aparecem nela` : `sobraram ${left} espaço(s) com colchetes`}. Confira no editor.`;
      } else {
        row.status = 'ok';
        row.note = plan.left ? `${plan.left} espaço(s) ficaram sem vídeo.` : '';
      }
    } catch (err) {
      row.note = err.message;
    }
  }

  _stuBusy = false;
  stuProgress('');
  _stuPreview = null;
  $('btn-stu-apply').style.display = 'none';
  $('btn-stu-apply').textContent   = '✅  Aplicar';
  buildStuResults(rows, true);
  stuSyncUI();
}

// ── Importar materiais complementares ────────────────────────────────
// Lê os módulos do curso, sobe os arquivos na ordem escolhida para a pasta do
// módulo em Arquivos, adiciona cada um como item no fim do módulo e lista os
// nomes em "Material Complementar › Notas de Aula". As chamadas à API rodam na
// aba do Canvas (sessão + CSRF); o binário sobe direto do painel, que tem
// host_permissions para o storage do Canvas — arquivo não passa por `args`.

let _matModules  = [];     // módulos do curso lido: [{ id, name }]
let _matCourseId = null;   // curso que gerou a lista de módulos
let _matFiles    = [];     // [{ id, file }] na ordem de importação
let _matProgress = {};     // id → { status, detail }
let _matPhase    = 'idle'; // 'idle' | 'running' | 'done'
let _matSeq      = 0;
let _matDragId   = null;

function matStatus(msg, color) {
  const el = $('mat-status');
  el.textContent = msg;
  el.style.color = color || '#94a3b8';
  el.style.display = msg ? 'block' : 'none';
}

function matFmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

async function openMaterials() {
  show('canvas-materiais');
  if (_matPhase === 'running') return;
  const courseId = await getCanvasCourseId();
  $('mat-course-label').textContent = courseId ? `curso #${courseId}` : 'nenhum curso nesta aba';
  // Mudou de curso: módulos e arquivos do anterior não valem mais.
  if (_matCourseId && courseId !== _matCourseId) matReset();
}

function matReset() {
  _matModules  = [];
  _matCourseId = null;
  _matFiles    = [];
  _matProgress = {};
  _matPhase    = 'idle';
  $('mat-module-section').style.display = 'none';
  $('mat-result').style.display = 'none';
  $('btn-mat-modules').textContent = '📚  Ler módulos do curso';
  matStatus('');
  buildMatFiles();
  matSyncUI();
}

// Depois de uma importação, recomeça mantendo só os arquivos que falharam —
// assim dá para tentar de novo sem reenviar o que já entrou no módulo.
function matNewBatch() {
  _matFiles    = _matFiles.filter(f => _matProgress[f.id]?.status === 'error');
  _matProgress = {};
  _matPhase    = 'idle';
  $('mat-result').style.display = 'none';
  buildMatFiles();
  matSyncUI();
}

// Aba ativa do Canvas, dentro de um curso — é onde as chamadas à API rodam.
async function matCanvasTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const m = (tab?.url || '').match(/\/courses\/(\d+)/);
  if (!m) throw new Error('Abra uma aba de um curso no Canvas para usar esta ferramenta.');
  return { tabId: tab.id, courseId: m[1] };
}

async function matExec(tabId, courseId, op, p) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    func: matCanvasMain,
    args: [op, courseId, p || null],
  });
  const out = res[0]?.result;
  if (out && out.__error) throw new Error(out.__error);
  return out;
}

// Roda na aba do Canvas. Uma só função serializada para todas as operações,
// para não repetir os helpers de CSRF e paginação em cada uma.
function matCanvasMain(op, courseId, p) {
  return (async () => {
    try {
      const rawCsrf = document.cookie.split(';')
        .map(c => c.trim())
        .find(c => c.startsWith('_csrf_token='));
      const csrf = rawCsrf
        ? decodeURIComponent(rawCsrf.split('=').slice(1).join('='))
        : decodeURIComponent(document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '');
      const api  = `/api/v1/courses/${courseId}`;
      const norm = s => (s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

      async function fetchAll(url) {
        const out = [];
        let next = url;
        while (next) {
          const res = await fetch(next);
          if (!res.ok) throw new Error(`HTTP ${res.status} ao ler ${url.split('?')[0]}`);
          const data = await res.json();
          if (Array.isArray(data)) out.push(...data);
          const m = (res.headers.get('Link') || '').match(/<([^>]+)>;\s*rel="next"/);
          next = m ? m[1] : null;
        }
        return out;
      }

      async function send(method, url, body) {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}${text ? ' — ' + text.slice(0, 160) : ''}`);
        return text ? JSON.parse(text) : null;
      }

      if (op === 'modules') {
        const mods = await fetchAll(`${api}/modules?per_page=100`);
        return mods.map(m => ({ id: m.id, name: m.name }));
      }

      // Posição de inserção (sempre o fim do módulo), página Material
      // Complementar do módulo e pasta de destino em Arquivos.
      if (op === 'prepare') {
        const items = await fetchAll(`${api}/modules/${p.moduleId}/items?per_page=100`);
        const matRe = /materi[a-zç]*\s+complementar/i;
        const mat   = items.find(it => it.type === 'Page' && matRe.test(it.title || ''))
                   || items.find(it => matRe.test(it.title || ''));
        const basePosition = items.reduce((max, it) => Math.max(max, it.position || 0), 0);

        // Reaproveita a pasta da unidade ("Unidade 1 - Nome") em vez de criar
        // outra só porque o nome não bate com o do módulo — sem confundir
        // Unidade 1 com Unidade 10. Senão, casa pelo nome exato do módulo.
        const folders = await fetchAll(`${api}/folders?per_page=100`);
        let folder = null;
        const unit = p.moduleName.match(/unidade\s*0*(\d+)/i)?.[1];
        if (unit) {
          const re = new RegExp(`^unidade\\s*0*${unit}(?!\\d)`, 'i');
          folder = folders.find(f => re.test((f.name || '').trim())) || null;
        }
        if (!folder) folder = folders.find(f => norm(f.name) === norm(p.moduleName)) || null;

        // Sem pasta existente, o Canvas cria pelo caminho — "/" viraria subpasta.
        const path = p.moduleName.replace(/\//g, '-').trim();
        return {
          basePosition,
          afterMaterial: !!mat,
          materialSlug:  mat?.page_url || null,
          folder:        folder ? { parent_folder_id: folder.id } : { parent_folder_path: path },
          folderLabel:   folder ? `"${folder.name}"` : `"${path}" (criada)`,
        };
      }

      // Etapa 1 do upload: o Canvas devolve a upload_url e os parâmetros assinados.
      if (op === 'ticket') {
        return await send('POST', `${api}/files`, {
          name:         p.name,
          size:         p.size,
          content_type: p.contentType,
          on_duplicate: 'overwrite',
          ...p.folder,
        });
      }

      if (op === 'addItem') {
        await send('POST', `${api}/modules/${p.moduleId}/items`, {
          module_item: {
            title:      p.title,
            type:       'File',
            content_id: p.fileId,
            position:   p.position,
            indent:     p.indent,
            completion_requirement: { type: 'must_view' },
          },
        });
        return true;
      }

      // Acrescenta os links no bloco "Notas de Aula" da página Material
      // Complementar, um por linha, sem apagar nem duplicar os que já estão lá.
      // Como na edição em escala, nunca reserializa a página: o bloco é
      // localizado por posição no HTML bruto e os links entram por fatia de
      // string — todo o resto fica byte a byte igual.
      if (op === 'notas') {
        const res = await fetch(`${api}/pages/${p.slug}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} ao ler a página Material Complementar`);
        const page = await res.json();
        const body = page.body || '';

        // Árvore de elementos com as posições de cada tag no HTML original.
        function scanElements(html) {
          const VOID  = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
          const root  = { name: '#root', attrs: {}, children: [], parent: null };
          const stack = [root];
          const re    = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
          let m;
          while ((m = re.exec(html))) {
            if (!m[2]) continue;                                   // comentário
            const name = m[2].toLowerCase();
            if (m[1]) {
              const at = stack.map(e => e.name).lastIndexOf(name);
              if (at <= 0) continue;                               // fechamento solto
              // Fecha junto os que ficaram abertos dentro dele.
              for (let k = stack.length - 1; k >= at; k--) {
                stack[k].closeStart = m.index;
                stack[k].end = k === at ? m.index + m[0].length : m.index;
              }
              stack.length = at;
              continue;
            }
            const attrs = {};
            for (const a of m[3].matchAll(/([^\s=\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
              attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
            }
            const parent = stack[stack.length - 1];
            const el = { name, attrs, children: [], parent, start: m.index, openEnd: m.index + m[0].length };
            parent.children.push(el);
            if (VOID.test(name) || /\/\s*$/.test(m[3])) {
              el.closeStart = el.end = el.openEnd;
            } else if (name === 'script' || name === 'style') {
              const close = new RegExp(`</${name}\\s*>`, 'ig');
              close.lastIndex = el.openEnd;
              const c = close.exec(html);
              el.closeStart = c ? c.index : html.length;
              el.end = c ? c.index + c[0].length : html.length;
              re.lastIndex = el.end;
            } else {
              stack.push(el);
            }
          }
          for (let k = stack.length - 1; k > 0; k--) stack[k].closeStart = stack[k].end = html.length;
          return root;
        }

        function* descendants(el) {
          for (const c of el.children) { yield c; yield* descendants(c); }
        }
        const find     = (el, pred) => { for (const d of descendants(el)) if (pred(d)) return d; return null; };
        const hasClass = (el, c) => (el.attrs.class || '').split(/\s+/).includes(c);
        const ta       = document.createElement('textarea');
        const textOf   = el => {
          ta.innerHTML = body.slice(el.openEnd, el.closeStart).replace(/<[^>]*>/g, '');
          return ta.value;
        };
        const fileIdOf = href => (href || '').match(/\/files\/(\d+)/)?.[1];

        const root = scanElements(body);
        let block = null;
        for (const el of descendants(root)) {
          if (!/^(span|strong|h3|h4|p)$/.test(el.name) || norm(textOf(el)) !== 'notas de aula') continue;
          for (let up = el; up.parent && !block; up = up.parent) if (hasClass(up, 'content-box')) block = up;
          if (block) break;
        }
        const target = block && find(block, el => hasClass(el, 'textLayer--absolute'));
        if (!target) return { notas: 'error', detail: 'bloco "Notas de Aula" não encontrado na página' };

        const esc  = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const link = f =>
          `<p><a class="instructure_file_link inline_disabled" title="${esc(f.name)}" ` +
          `href="/courses/${courseId}/files/${f.fileId}?wrap=1" target="_blank" rel="noopener" ` +
          `data-api-endpoint="${location.origin}/api/v1/courses/${courseId}/files/${f.fileId}" data-api-returntype="File">` +
          `${esc(f.name)}</a></p>`;

        const anchors = [...descendants(target)].filter(el => el.name === 'a' && 'href' in el.attrs);
        let from, to, insert;
        if (!anchors.length) {
          // Bloco só com o placeholder: troca só o conteúdo dele.
          from   = target.openEnd;
          to     = target.closeStart;
          insert = `<div id="section-slide0">${p.files.map(link).join('\n')}</div>\n<div id="section-slide1"></div>`;
        } else {
          const have  = new Set(anchors.map(a => fileIdOf(a.attrs.href)).filter(Boolean));
          const novos = p.files.filter(f => !have.has(String(f.fileId)));
          if (!novos.length) return { notas: 'ok' };
          // Entra no fim do #section-slide0 se existir; senão no fim do próprio
          // alvo, ou antes do marcador #section-slide1 quando ele está solto ali.
          const section0 = find(target, el => el.attrs.id === 'section-slide0');
          const marker   = section0 ? null : target.children.find(el => el.attrs.id === 'section-slide1');
          from = to = marker ? marker.start : (section0 || target).closeStart;
          insert = novos.map(link).join('\n');
        }
        const newBody = body.slice(0, from) + insert + body.slice(to);

        // Confere com o parser do navegador que os links caíram dentro do
        // bloco certo: se o HTML for irregular e o scanner errar, não grava.
        const doc = new DOMParser().parseFromString(newBody, 'text/html');
        let checkBlock = null;
        for (const el of doc.querySelectorAll('span, strong, h3, h4, p')) {
          if (norm(el.textContent) !== 'notas de aula') continue;
          checkBlock = el.closest('.content-box');
          if (checkBlock) break;
        }
        const checkTarget = checkBlock?.querySelector('.textLayer--absolute');
        const inside = new Set([...(checkTarget?.querySelectorAll('a[href]') || [])].map(a => fileIdOf(a.getAttribute('href'))));
        if (!p.files.every(f => inside.has(String(f.fileId)))) {
          return { notas: 'error', detail: 'não consegui localizar o bloco "Notas de Aula" com segurança — a página não foi alterada' };
        }

        await send('PUT', `${api}/pages/${p.slug}`, { wiki_page: { body: newBody } });
        return { notas: 'ok' };
      }

      return { __error: `Operação desconhecida: ${op}` };
    } catch (err) {
      return { __error: err.message };
    }
  })();
}

// Etapa 2 do upload: o binário vai do painel direto para a upload_url (storage
// do Canvas, outro domínio). O campo "file" precisa ser o último do form.
async function matUploadBinary(ticket, file) {
  const form = new FormData();
  for (const [k, v] of Object.entries(ticket.upload_params || {})) form.append(k, v);
  form.append('file', file, file.name);

  let res;
  try {
    res = await fetch(ticket.upload_url, { method: 'POST', body: form });
  } catch (err) {
    throw new Error('falha ao enviar para o storage do Canvas: ' + err.message);
  }
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  const id = data?.id || (data?.location || '').match(/\/files\/(\d+)/)?.[1];
  if (res.ok && id) return Number(id);
  throw new Error(`upload não confirmado (HTTP ${res.status})`);
}

async function doMatLoadModules() {
  const btn = $('btn-mat-modules');
  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span>Lendo módulos...';

  try {
    const { tabId, courseId } = await matCanvasTab();
    const mods = await matExec(tabId, courseId, 'modules');
    if (courseId !== _matCourseId) matReset();

    const sel  = $('mat-module');
    const prev = sel.value;
    _matCourseId = courseId;
    _matModules  = mods;
    $('mat-course-label').textContent = `curso #${courseId}`;
    sel.innerHTML = '';
    for (const m of mods) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      sel.appendChild(opt);
    }
    if (mods.some(m => String(m.id) === prev)) sel.value = prev;

    if (!mods.length) {
      matStatus(`Nenhum módulo no curso #${courseId}.`, '#f97316');
      $('mat-module-section').style.display = 'none';
    } else {
      matStatus(`${mods.length} módulo(s) no curso #${courseId}`, '#4ade80');
      $('mat-module-section').style.display = 'block';
    }
  } catch (err) {
    matStatus('✗ ' + err.message, '#f87171');
  }

  btn.disabled    = false;
  btn.textContent = _matModules.length ? '🔄  Reler módulos do curso' : '📚  Ler módulos do curso';
  buildMatFiles();
  matSyncUI();
}

function matAddFiles(e) {
  // Copia antes de limpar o input — senão o FileList esvazia junto.
  const added = [...e.target.files].map(file => ({ id: 'm' + _matSeq++, file }));
  e.target.value = '';
  if (!added.length) return;
  _matFiles.push(...added);
  buildMatFiles();
  matSyncUI();
}

// Tira o arquivo da posição `from` e o coloca em `to` (setas e arraste).
function matMove(from, to) {
  if (from === to || to < 0 || to >= _matFiles.length) return;
  const [moved] = _matFiles.splice(from, 1);
  _matFiles.splice(to, 0, moved);
  buildMatFiles();
}

function matFileBtn(label, title, onClick, disabled, extraClass) {
  const b = document.createElement('button');
  b.className   = 'mat-file-btn' + (extraClass ? ' ' + extraClass : '');
  b.textContent = label;
  b.title       = title;
  b.disabled    = disabled;
  b.addEventListener('click', onClick);
  return b;
}

const MAT_STATUS_TITLE = {
  pending: 'na fila', uploading: 'enviando arquivo', adding: 'adicionando ao módulo', ok: 'importado', error: 'erro',
};

function buildMatFiles() {
  const list    = $('mat-files');
  const editing = _matPhase === 'idle';
  list.innerHTML = '';
  list.style.display = _matFiles.length ? 'flex' : 'none';
  $('mat-order-hint').style.display = _matFiles.length && _matPhase !== 'done' ? 'block' : 'none';

  _matFiles.forEach((item, i) => {
    const prog = _matProgress[item.id];
    const row  = document.createElement('div');
    row.className = 'mat-file'
      + (editing ? ' editable' : '')
      + (prog?.status === 'ok' ? ' ok' : prog?.status === 'error' ? ' error' : '');

    if (editing) {
      const grip = document.createElement('span');
      grip.className   = 'mat-file-grip';
      grip.textContent = '⋮⋮';
      row.appendChild(grip);
    }

    const num = document.createElement('span');
    num.className   = 'mat-file-num';
    num.textContent = i + 1;
    row.appendChild(num);

    if (!editing) {
      const s  = prog?.status || 'pending';
      const st = document.createElement('span');
      st.className = 'mat-file-status';
      st.title     = MAT_STATUS_TITLE[s];
      if (s === 'uploading' || s === 'adding') st.innerHTML = '<span class="spinner"></span>';
      else if (s === 'ok')    { st.textContent = '✓'; st.style.color = '#4ade80'; }
      else if (s === 'error') { st.textContent = '✗'; st.style.color = '#f87171'; }
      else                    { st.textContent = '·'; st.style.color = '#64748b'; }
      row.appendChild(st);
    }

    const name = document.createElement('span');
    name.className   = 'mat-file-name';
    name.textContent = item.file.name;
    name.title       = item.file.name;
    row.appendChild(name);

    const info = document.createElement('span');
    if (prog?.detail) {
      info.className   = 'mat-file-detail';
      info.textContent = prog.detail;
      info.title       = prog.detail;
    } else {
      info.className   = 'mat-file-size';
      info.textContent = matFmtSize(item.file.size);
    }
    row.appendChild(info);

    if (editing) {
      row.appendChild(matFileBtn('▲', 'Subir',   () => matMove(i, i - 1), i === 0));
      row.appendChild(matFileBtn('▼', 'Descer',  () => matMove(i, i + 1), i === _matFiles.length - 1));
      row.appendChild(matFileBtn('✕', 'Remover', () => {
        _matFiles.splice(i, 1);
        buildMatFiles();
        matSyncUI();
      }, false, 'rm'));

      row.draggable = true;
      row.addEventListener('dragstart', e => {
        _matDragId = item.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.file.name);
        row.classList.add('dragging');
      });
      row.addEventListener('dragover', e => {
        if (!_matDragId || _matDragId === item.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('over'));
      row.addEventListener('drop', e => {
        e.preventDefault();
        const from = _matFiles.findIndex(f => f.id === _matDragId);
        _matDragId = null;
        if (from >= 0) matMove(from, i);
      });
      row.addEventListener('dragend', () => {
        _matDragId = null;
        row.classList.remove('dragging');
      });
    }

    list.appendChild(row);
  });
}

function matSyncUI() {
  const running = _matPhase === 'running';
  const btn     = $('btn-mat-import');
  $('btn-mat-modules').disabled   = running;
  $('mat-module').disabled        = running;
  $('btn-mat-add-files').disabled = running;

  if (running) {
    const done = Object.values(_matProgress).filter(p => p.status === 'ok' || p.status === 'error').length;
    btn.className = 'btn btn-green btn-full mt6';
    btn.disabled  = true;
    btn.innerHTML = `<span class="spinner"></span>Importando ${Math.min(done + 1, _matFiles.length)} de ${_matFiles.length}...`;
  } else if (_matPhase === 'done') {
    const failed = _matFiles.filter(f => _matProgress[f.id]?.status === 'error').length;
    btn.className   = failed ? 'btn btn-surface btn-full mt6' : 'btn btn-green btn-full mt6';
    btn.disabled    = !failed;
    btn.textContent = failed ? `↻  Tentar de novo os que falharam (${failed})` : '✓  Importação concluída';
  } else {
    btn.className   = 'btn btn-green btn-full mt6';
    btn.disabled    = !_matFiles.length || !$('mat-module').value;
    btn.textContent = `⬆  Importar materiais${_matFiles.length ? ` (${_matFiles.length})` : ''}`;
  }
}

function showMatResult(files, prep, notas) {
  const el  = $('mat-result');
  const ok  = files.filter(f => _matProgress[f.id]?.status === 'ok').length;
  const err = files.length - ok;
  el.innerHTML = '';
  const line = (text, color) => {
    const d = document.createElement('div');
    d.className   = 'mat-result-line';
    d.style.color = color;
    d.textContent = text;
    el.appendChild(d);
  };

  if (ok)  line(`✓ ${ok} arquivo(s) adicionado(s) ao módulo · pasta ${prep.folderLabel}`, '#4ade80');
  if (err) line(`✗ ${err} com erro — passe o mouse no erro para ver o detalhe.`, '#f87171');
  if (notas.notas === 'ok')        line('✓ Nomes escritos em Material Complementar › Notas de Aula', '#4ade80');
  else if (notas.notas === 'skip') line(`Notas de Aula não atualizada — ${notas.detail}`, '#f97316');
  else                             line(`✗ Erro em Notas de Aula — ${notas.detail}`, '#f87171');
  el.style.display = 'block';
}

async function doMatImport() {
  const mod = _matModules.find(m => String(m.id) === $('mat-module').value);
  if (!mod || !_matFiles.length || _matPhase !== 'idle') return;

  // Trava antes do primeiro await — senão um duplo clique importa duas vezes.
  const files  = _matFiles.slice();
  _matPhase    = 'running';
  _matProgress = Object.fromEntries(files.map(f => [f.id, { status: 'pending' }]));
  matStatus('');
  $('mat-result').style.display = 'none';
  buildMatFiles();
  matSyncUI();

  const abort = msg => {
    _matPhase    = 'idle';
    _matProgress = {};
    matStatus('✗ ' + msg, '#f87171');
    buildMatFiles();
    matSyncUI();
  };

  let tabId;
  try {
    const tab = await matCanvasTab();
    if (tab.courseId !== _matCourseId) {
      throw new Error(`A aba ativa é do curso #${tab.courseId}, mas os módulos lidos são do curso #${_matCourseId}. Clique em "Reler módulos do curso".`);
    }
    tabId = tab.tabId;
  } catch (err) {
    abort(err.message);
    return;
  }

  // Curso e aba ficam fixos: trocar de aba no meio não muda o destino.
  const courseId = _matCourseId;
  const exec     = (op, p) => matExec(tabId, courseId, op, p);

  let prep;
  try {
    prep = await exec('prepare', { moduleId: mod.id, moduleName: mod.name });
  } catch (err) {
    abort(err.message);
    return;
  }

  const set = (id, status, detail) => {
    _matProgress[id] = { status, detail };
    buildMatFiles();
    matSyncUI();
  };

  const uploaded = [];
  let position   = prep.basePosition + 1;
  for (const item of files) {
    try {
      set(item.id, 'uploading');
      const ticket = await exec('ticket', {
        name:        item.file.name,
        size:        item.file.size,
        contentType: item.file.type || 'application/octet-stream',
        folder:      prep.folder,
      });
      const fileId = await matUploadBinary(ticket, item.file);

      set(item.id, 'adding');
      const title = item.file.name.replace(/\.[^./\\]+$/, '');
      await exec('addItem', { moduleId: mod.id, fileId, title, position, indent: prep.afterMaterial ? 1 : 0 });
      uploaded.push({ name: title, fileId });
      position++;
      set(item.id, 'ok');
    } catch (err) {
      set(item.id, 'error', err.message);
    }
  }

  let notas;
  if (!uploaded.length) {
    notas = { notas: 'skip', detail: 'nenhum arquivo foi adicionado' };
  } else if (!prep.materialSlug) {
    notas = { notas: 'skip', detail: 'página "Material Complementar" não encontrada no módulo' };
  } else {
    $('btn-mat-import').innerHTML = '<span class="spinner"></span>Atualizando Notas de Aula...';
    try {
      notas = await exec('notas', { slug: prep.materialSlug, files: uploaded });
    } catch (err) {
      notas = { notas: 'error', detail: err.message };
    }
  }

  _matPhase = 'done';
  buildMatFiles();
  matSyncUI();
  showMatResult(files, prep, notas);
}

// ── Analisar disciplina ──────────────────────────────────────────────
// Diagnóstico da disciplina aberta: sincronização das tarefas com o SIS e,
// no boletim, notas vazias, zeros suspeitos e notas acima do máximo. Somente
// consulta — só faz GET na API do Canvas, pela sessão da aba. Portado da
// extensão Analisador de Disciplina (avaGraducao).

const AN_MAX_PAGES = 300;  // segurança: até 30 000 itens por listagem
let _anBusy = false;

// Roda na aba do Canvas: um GET same-origin. Em 403 de rate limit, espera e
// tenta de novo (as chamadas já são sequenciais, uma página por vez).
function analiseFetchPage(url, accept) {
  return (async () => {
    try {
      for (let attempt = 0; ; attempt++) {
        const res  = await fetch(url, { credentials: 'include', headers: { Accept: accept || 'application/json' } });
        const text = await res.text();
        if (res.status === 403 && /rate limit/i.test(text) && attempt < 2) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        return { ok: res.ok, status: res.status, text, link: res.headers.get('Link') || '' };
      }
    } catch (err) {
      return { ok: false, status: 0, text: err.message, link: '' };
    }
  })();
}

async function anGet(tabId, url, accept) {
  const res = await chrome.scripting.executeScript({ target: { tabId }, func: analiseFetchPage, args: [url, accept || ''] });
  const out = res[0]?.result;
  if (!out) throw new Error('a aba do Canvas não respondeu');
  if (!out.ok) {
    let msg = out.text || '';
    try { msg = JSON.parse(msg).errors?.[0]?.message || msg; } catch { /* não é JSON */ }
    throw new Error(`HTTP ${out.status}${msg ? ' — ' + msg.slice(0, 160) : ''}`);
  }
  return out;
}

// Todas as páginas de uma listagem, seguindo rel="next" do header Link.
// Passou do limite: erro, nunca uma lista cortada — com metade dos alunos o
// diagnóstico daria "tudo certo" sem ter olhado o resto.
async function anGetAll(tabId, url, onProgress) {
  const all = [];
  let next = url;
  for (let i = 0; next; i++) {
    if (i >= AN_MAX_PAGES) {
      const err = new Error(`A listagem passou de ${all.length} itens e foi interrompida — o diagnóstico ficaria incompleto.`);
      err.truncated = true;
      throw err;
    }
    const res = await anGet(tabId, next);
    all.push(...JSON.parse(res.text));
    if (onProgress) onProgress(all.length);
    const m = res.link.match(/<([^>]+)>;\s*rel="next"/);
    next = m ? m[1] : null;
  }
  return all;
}

// ── Análises (funções puras) ──

const anPts = a => a.points_possible ?? 0;

// Critério do sincronizador (Sincronização SGA) para a tarefa ir ao SGA:
// publicada, com SIS, pontos > 0, conta na nota final e "Exibir nota como" =
// Pontos. Com SIS e pontos, o motivo de ainda assim não ir (ou null).
function anSisBlock(a) {
  if (a.omit_from_final_grade) return 'não conta na nota final';
  if (a.grading_type && a.grading_type !== 'points') return '"Exibir nota como" não está em Pontos';
  return null;
}

// Toda tarefa publicada com pontos deveria ir para o SGA. Não publicada não
// vai, com ou sem SIS ("Atividade não publicada" na Sincronização SGA), então
// fica num grupo à parte, sem alarme. Postagem manual vai, mas a nota pode
// ficar oculta ("Verificar política de postagem de notas").
function anSisSync(assignments) {
  const active     = assignments.filter(a => a.workflow_state !== 'deleted');
  const published  = active.filter(a => a.published);
  const withPoints = published.filter(a => anPts(a) > 0);
  const withSis    = withPoints.filter(a => a.post_to_sis === true);
  const ok         = withSis.filter(a => !anSisBlock(a));
  const missing    = withPoints.filter(a => a.post_to_sis !== true);
  const sum        = list => list.reduce((n, a) => n + anPts(a), 0);
  return {
    ok,
    missing,
    blocked:       withSis.filter(a => anSisBlock(a)),
    manual:        ok.filter(a => a.post_manually),
    zeroPoints:    published.filter(a => !(anPts(a) > 0)),
    unpublished:   active.filter(a => !a.published),
    total:         active.length,
    okPoints:      sum(ok),
    missingPoints: sum(missing),
  };
}

// names: Map id → nome, da lista de alunos ativos.
const anStudentName = (names, s) => names.get(s.user_id) ?? `Aluno #${s.user_id}`;

// Agrupa por tarefa, com as de mais alunos primeiro.
function anGroupByAssignment(byId, sortStudents) {
  return [...byId.values()]
    .filter(e => e.students.length > 0)
    .map(e => ({
      name:     e.assignment.name,
      url:      e.assignment.html_url,
      students: e.students.sort(sortStudents),
    }))
    .sort((a, b) => b.students.length - a.students.length);
}

// Nas tarefas com SIS, todo aluno precisa de nota (pode ser 0, não vazia).
// Ficam de fora: reavaliação (nem todos fazem), colunas em % e sem pontuação.
function anMissingGrades(subs, assignments, names) {
  const ignored = [];
  const byId    = new Map();
  for (const a of assignments) {
    if (a.workflow_state === 'deleted' || !a.published || a.post_to_sis !== true) continue;
    const plain = a.name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const reason =
      plain.includes('reavaliacao')  ? 'reavaliação — nem todos fazem' :
      a.grading_type === 'percent'   ? 'coluna calculada em %' :
      anPts(a) <= 0                  ? 'sem pontuação máxima' : null;
    if (reason) ignored.push({ name: a.name, reason });
    else byId.set(a.id, { assignment: a, students: [] });
  }
  for (const s of subs) {
    const entry = byId.get(s.assignment_id);
    if (!entry || s.excused || s.score != null) continue;
    entry.students.push(anStudentName(names, s));
  }
  const items = anGroupByAssignment(byId, (a, b) => a.localeCompare(b, 'pt-BR'));
  return { items, ignored, checked: byId.size, total: items.reduce((n, i) => n + i.students.length, 0) };
}

// Zeros que não vieram de um lançamento manual publicado costumam ser
// ignorados pelo SIS; redigitar o 0 no boletim regulariza.
function anSuspiciousZeros(subs, assignments, names) {
  const byId = new Map(
    assignments
      .filter(a => a.workflow_state !== 'deleted' && a.published && a.post_to_sis === true
        && a.grading_type !== 'percent' && anPts(a) > 0)
      .map(a => [a.id, { assignment: a, students: [] }]));
  let zerosChecked = 0;
  for (const s of subs) {
    const entry = byId.get(s.assignment_id);
    if (!entry || s.excused || s.score !== 0) continue;
    zerosChecked++;
    const signals = [];
    if (s.late_policy_status === 'missing')      signals.push('zero automático da política de entregas faltantes');
    if (s.workflow_state !== 'graded')           signals.push('não marcada como avaliada');
    if (s.grader_id == null || s.grader_id < 0)  signals.push('sem avaliador humano (lançamento automático)');
    if (s.posted_at == null)                     signals.push('nota oculta (não publicada)');
    if (signals.length) entry.students.push({ name: anStudentName(names, s), signals });
  }
  const items = anGroupByAssignment(byId, (a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return { items, zerosChecked, total: items.reduce((n, i) => n + i.students.length, 0) };
}

function anScoreOverMax(subs, assignments, names) {
  const byId = new Map(assignments.map(a => [a.id, a]));
  const over = [];
  let checked = 0;
  for (const s of subs) {
    if (s.score == null || s.excused) continue;
    const a = byId.get(s.assignment_id);
    if (!a || a.workflow_state === 'deleted') continue;
    const max = anPts(a);
    if (max <= 0) continue;   // sem máximo real (ex.: coluna calculada em %)
    checked++;
    if (s.score > max) over.push({ student: anStudentName(names, s), name: a.name, url: a.html_url, score: s.score, max });
  }
  over.sort((x, y) => (y.score - y.max) - (x.score - x.max));
  return { over, checked };
}

// ── Tela ──

function anFmtPoints(p) {
  if (p == null) return '—';
  return Number.isInteger(p) ? String(p) : p.toFixed(2).replace('.', ',');
}

const anPlural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function anEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function anLink(text, url, className) {
  const a = anEl('a', className, text);
  a.href   = url;
  a.target = '_blank';
  a.rel    = 'noreferrer';
  a.title  = text;
  return a;
}

function anStatus(msg, color) {
  const el = $('an-status');
  el.textContent   = msg;
  el.style.color   = color || '#94a3b8';
  el.style.display = msg ? 'block' : 'none';
}

// Cada análise tem um cartão fixo: rodar de novo troca o conteúdo no lugar.
// O título abre e fecha o cartão. Os cartões desenhados numa verificação
// ficam abertos e os das outras recolhem — o que não foi redesenhado nesta
// rodada (_anRunId) é de outra verificação.
let _anRunId = 0;

function anCard(id, title, subtitle) {
  let card = document.getElementById(id);
  if (!card) {
    card = anEl('div', 'an-card');
    card.id = id;
    $('an-results').appendChild(card);
  }
  card.innerHTML = '';
  card.dataset.run = _anRunId;
  card.classList.remove('collapsed');
  document.querySelectorAll('#an-results .an-card').forEach(c => {
    if (c.dataset.run !== String(_anRunId)) c.classList.add('collapsed');
  });
  const head = anEl('div', 'an-card-title', title);
  head.title = 'Abrir / recolher';
  head.addEventListener('click', () => card.classList.toggle('collapsed'));
  card.appendChild(head);
  card.appendChild(anEl('div', 'an-card-sub', subtitle));
  return card;
}

function anSection(parent, title, count, tone, open) {
  const det = anEl('details', 'an-section');
  det.open = !!open;
  const sum = anEl('summary');
  sum.appendChild(anEl('span', 'an-section-title', title));
  sum.appendChild(anEl('span', 'an-badge ' + tone, String(count)));
  det.appendChild(sum);
  const body = anEl('div', 'an-section-body');
  det.appendChild(body);
  parent.appendChild(det);
  return body;
}

function anAssignmentRow(a, note) {
  const row = anEl('div', 'an-item');
  row.appendChild(anLink(a.name, a.html_url, 'an-item-name'));
  const due = a.due_at
    ? new Date(a.due_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : 'sem prazo';
  row.appendChild(anEl('div', 'an-item-sub',
    `${anFmtPoints(a.points_possible)} pts · ${due}${a.published ? '' : ' · não publicada'}${note ? ' · ' + note : ''}`));
  return row;
}

function anRenderSis(r) {
  const card = anCard('an-card-sis', 'Sincronização com o SIS',
    'Tarefas publicadas com pontos têm que ir para o SGA: "Sincronizar com o SIS" ligado, contando na nota final e com a nota exibida em Pontos.');
  const stats = anEl('div', 'an-stats');
  const problems = r.missing.length + r.blocked.length;
  for (const [n, label, tone] of [[r.total, 'tarefas', ''], [r.ok.length, 'vão ao SGA', 'green'], [problems, 'com problema', 'red']]) {
    const box = anEl('div', 'an-stat ' + tone);
    box.appendChild(anEl('b', '', String(n)));
    box.appendChild(anEl('span', '', label));
    stats.appendChild(box);
  }
  card.appendChild(stats);
  card.appendChild(anEl('div', 'an-msg',
    `Pontos das tarefas que vão ao SGA: ${anFmtPoints(r.okPoints)}`
    + (r.missingPoints > 0 ? ` · fora do SIS: ${anFmtPoints(r.missingPoints)} pts` : '')));
  if (!problems) {
    card.appendChild(anEl('div', 'an-msg green', '✓ Todas as tarefas publicadas com pontos vão para o SGA.'));
  }
  if (r.missing.length) {
    const body = anSection(card, 'Com pontos, sem SIS', r.missing.length, 'red', true);
    r.missing.forEach(a => body.appendChild(anAssignmentRow(a)));
  }
  if (r.blocked.length) {
    const body = anSection(card, 'Com SIS, mas não vão para o SGA', r.blocked.length, 'red', true);
    r.blocked.forEach(a => body.appendChild(anAssignmentRow(a, anSisBlock(a))));
  }
  if (r.manual.length) {
    const body = anSection(card, 'Postagem de notas manual (conferir)', r.manual.length, 'warn', true);
    r.manual.forEach(a => body.appendChild(anAssignmentRow(a, 'notas podem estar ocultas')));
  }
  const okBody = anSection(card, 'Vão para o SGA', r.ok.length, 'green');
  r.ok.forEach(a => okBody.appendChild(anAssignmentRow(a)));
  const zeroBody = anSection(card, 'Sem pontuação (SIS não se aplica)', r.zeroPoints.length, 'gray');
  r.zeroPoints.forEach(a => zeroBody.appendChild(anAssignmentRow(a)));
  if (r.unpublished.length) {
    const unpubBody = anSection(card, 'Não publicadas (não vão para o SGA)', r.unpublished.length, 'gray');
    r.unpublished.forEach(a => unpubBody.appendChild(anAssignmentRow(a)));
  }
}

// Uma seção por tarefa, com o link dela e a lista de alunos.
function anRenderByAssignment(card, items, studentRow) {
  for (const item of items) {
    const body = anSection(card, item.name, item.students.length, 'red');
    const box  = anEl('div', 'an-item');
    box.appendChild(anLink('Abrir tarefa no Canvas ↗', item.url, 'an-open'));
    item.students.forEach(st => studentRow(box, st));
    body.appendChild(box);
  }
}

function anRenderMissing(r) {
  const card = anCard('an-card-missing', 'Fechamento de diário — notas vazias',
    'Nas tarefas com SIS habilitado, todo aluno precisa ter nota (pode ser 0, não pode ficar vazia).');
  if (r.ignored.length) {
    const box = anEl('div', 'an-msg');
    box.appendChild(anEl('b', '', 'Fora da verificação:'));
    r.ignored.forEach(ig => box.appendChild(anEl('div', '', `• ${ig.name} (${ig.reason})`)));
    card.appendChild(box);
  }
  if (!r.total) {
    card.appendChild(anEl('div', 'an-msg green',
      `✓ Nenhuma nota vazia nas ${anPlural(r.checked, 'tarefa', 'tarefas')} com SIS — diário pronto para fechar.`));
    return;
  }
  card.appendChild(anEl('div', 'an-msg red',
    `⚠ ${anPlural(r.total, 'nota vazia', 'notas vazias')} em ${anPlural(r.items.length, 'tarefa', 'tarefas')} com SIS.`));
  anRenderByAssignment(card, r.items, (box, name) => box.appendChild(anEl('div', 'an-student', '• ' + name)));
}

function anRenderZeros(r) {
  const card = anCard('an-card-zeros', 'Zeros suspeitos — podem travar a sincronização',
    'Zeros aplicados automaticamente, ocultos ou não avaliados costumam ser ignorados pelo SIS. Redigitar o 0 no boletim regulariza.');
  const checked = anPlural(r.zerosChecked, 'zero verificado', 'zeros verificados');
  if (!r.total) {
    card.appendChild(anEl('div', 'an-msg green', `✓ Nenhum zero suspeito (${checked} nas tarefas com SIS).`));
    return;
  }
  card.appendChild(anEl('div', 'an-msg red',
    `⚠ ${anPlural(r.total, 'zero suspeito', 'zeros suspeitos')} em ${anPlural(r.items.length, 'tarefa', 'tarefas')} (${checked}).`));
  anRenderByAssignment(card, r.items, (box, st) => {
    box.appendChild(anEl('div', 'an-student', '• ' + st.name));
    box.appendChild(anEl('div', 'an-item-sub an-signals', st.signals.join(' · ')));
  });
}

function anRenderOverMax(r) {
  const card = anCard('an-card-over', 'Notas acima do máximo',
    'Notas do boletim maiores que a pontuação máxima da tarefa.');
  if (!r.over.length) {
    card.appendChild(anEl('div', 'an-msg green', `✓ Nenhuma nota acima do máximo (${r.checked} notas verificadas).`));
    return;
  }
  card.appendChild(anEl('div', 'an-msg red',
    `⚠ ${anPlural(r.over.length, 'nota acima', 'notas acima')} do máximo (${r.checked} verificadas).`));
  for (const item of r.over) {
    const row = anEl('div', 'an-item');
    row.appendChild(anEl('div', 'an-student', item.student));
    row.appendChild(anLink(item.name, item.url, 'an-item-name'));
    row.appendChild(anEl('div', 'an-item-sub',
      `nota ${anFmtPoints(item.score)} de no máximo ${anFmtPoints(item.max)}`));
    card.appendChild(row);
  }
}

async function openAnalise() {
  show('canvas-analise');
  if (_anBusy) return;
  const courseId = await getCanvasCourseId();
  const label    = $('an-course-label');
  label.textContent = courseId ? `curso #${courseId}` : 'nenhum curso nesta aba';
  // Mudou de disciplina: o diagnóstico exibido era da anterior.
  if (label.dataset.courseId !== (courseId || '')) {
    label.dataset.courseId = courseId || '';
    anClearResults();
    anStatus('');
  }
}

function anClearResults() {
  $('an-results').innerHTML = '';
  _fd = null;
}

const AN_BUTTONS = ['btn-an-tarefas', 'btn-an-boletim', 'btn-an-diario'];

// Roda uma verificação com a aba e o curso atuais, travando os botões.
async function anRun(btnId, work) {
  if (_anBusy) return;
  const btn   = $(btnId);
  const label = btn.textContent;
  try {
    const [tab]    = await chrome.tabs.query({ active: true, currentWindow: true });
    const courseId = (tab?.url || '').match(/\/courses\/(\d+)/)?.[1];
    if (!courseId) {
      anStatus('✗ Abra a página de uma disciplina no Canvas (endereço com /courses/…).', '#f87171');
      return;
    }
    _anBusy = true;
    _anRunId++;
    AN_BUTTONS.forEach(id => { $(id).disabled = true; });
    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner"></span>Verificando...';
    const elLabel = $('an-course-label');
    if (elLabel.dataset.courseId !== courseId) anClearResults();
    elLabel.dataset.courseId = courseId;
    elLabel.textContent      = `curso #${courseId}`;

    await work(tab.id, new URL(tab.url).origin + `/api/v1/courses/${courseId}`);
    anStatus('');
  } catch (err) {
    anStatus('✗ ' + err.message, '#f87171');
  } finally {
    _anBusy = false;
    AN_BUTTONS.forEach(id => { $(id).disabled = false; });
    btn.disabled    = false;
    btn.textContent = label;
  }
}

function doAnaliseTarefas() {
  return anRun('btn-an-tarefas', async (tabId, base) => {
    anStatus('Carregando tarefas...');
    anRenderSis(anSisSync(await anGetAll(tabId, `${base}/assignments?per_page=100`)));
  });
}

// Notas dos alunos ativos. enrollment_type=student tira o aluno teste e
// active tira os inativos — igual ao boletim da tela. Os nomes saem da lista
// de alunos; sem include[]=user, cada nota não traz o cadastro do aluno.
async function anLoadGrades(tabId, base) {
  anStatus('Carregando alunos ativos...');
  const students = await anGetAll(tabId,
    `${base}/users?enrollment_type[]=student&enrollment_state[]=active&per_page=100`);

  anStatus('Carregando notas do boletim...');
  let subs;
  try {
    subs = await anGetAll(tabId,
      `${base}/students/submissions?student_ids[]=all&enrollment_state=active&per_page=100`,
      n => anStatus(`Carregando notas do boletim... ${n} notas`));
  } catch (err) {
    if (err.truncated) throw err;
    throw new Error(`Não foi possível ler o boletim (é preciso estar como professor na disciplina). ${err.message}`);
  }
  const names = new Map(students.map(s => [s.id, s.name]));
  return { names, subs: subs.filter(s => names.has(s.user_id)) };
}

function doAnaliseBoletim() {
  return anRun('btn-an-boletim', async (tabId, base) => {
    anStatus('Carregando tarefas...');
    const assignments = await anGetAll(tabId, `${base}/assignments?per_page=100`);
    const { names, subs } = await anLoadGrades(tabId, base);
    anRenderMissing(anMissingGrades(subs, assignments, names));
    anRenderZeros(anSuspiciousZeros(subs, assignments, names));
    anRenderOverMax(anScoreOverMax(subs, assignments, names));
  });
}

// ── Fórmula do diário (SGA) ──
// Monta a fórmula que fecha o diário no SGA. Cada tarefa publicada com SIS
// vira um P na sincronização, na ordem em que o Canvas lista as tarefas. O P
// nunca é reaproveitado (tarefa apagada deixa o número vago), por isso os
// números ficam editáveis — confira na Sincronização SGA. Regras do manual da
// função reav do SGA e da equipe (PLANO-FORMULA-DIARIO.md):
//  - Sem reavaliação: soma simples, fechando em 100.
//  - Reav(Preav;Arg2): a reavaliação cobre o Arg2, que vale o mesmo que ela.
//    Reavaliação de 100 sobre tudo → pesos 1 e 1 (média); reavaliação menor
//    sobre uma avaliação ou grupo de mesmo valor → pesos 0 e 0 (substitui).
//  - Max(n;Pa;Pb;…) = as n maiores notas; no fechamento vale a soma dos n
//    maiores valores. Um Max por grupo de mesmo valor: o da substitutiva
//    (pega k−1 de k) e os que fecham o resto da sobra.

const FD_ROLES = [
  ['soma', 'Soma'],
  ['alvo', 'Coberta pela reav.'],
  ['reav', 'Reavaliação'],
  ['max',  'Grupo MAX'],
  ['fora', 'Fora da fórmula'],
];

// { base, items, state: { rows, maxN: { valor → n do Max }, maxInReav }, grades, gradesError }
let _fd = null;

const fdPlain   = s => (s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const fdRound   = n => Math.round(n * 100) / 100;
const fdEq      = (a, b) => Math.abs(a - b) < 0.005;
const fdSum     = list => fdRound(list.reduce((n, r) => n + r.value, 0));
const fdIsReav  = name => /reavalia|\breav\b/.test(fdPlain(name)) && !/substitut/.test(fdPlain(name));
const fdIsSubst = name => /substitut/.test(fdPlain(name));
const fdPts     = n => anFmtPoints(n) + (fdEq(n, 1) ? ' pt' : ' pts');
const fdKey     = v => v.toFixed(2);   // grupo de mesmo valor

// Tarefas que viram P: as que o sincronizador manda ao SGA (publicadas, com
// SIS, pontos > 0, contam na nota, nota em Pontos), na ordem do Canvas (grupo
// de tarefas, depois a posição no grupo). Sem as siglas do SGA, essa ordem é
// só um palpite: o P sai na ordem de sincronização, que o Canvas não guarda.
function fdItems(assignments, groups) {
  const gpos = new Map(groups.map(g => [g.id, g.position ?? 0]));
  return assignments
    .filter(a => a.workflow_state !== 'deleted' && a.published && a.post_to_sis === true
      && anPts(a) > 0 && !anSisBlock(a))
    .sort((a, b) => (gpos.get(a.assignment_group_id) ?? 0) - (gpos.get(b.assignment_group_id) ?? 0)
      || (a.position ?? 0) - (b.position ?? 0) || a.id - b.id)
    .map((a, i) => ({ id: a.id, p: i + 1, name: a.name, url: a.html_url, value: anPts(a) }));
}

// Quantas notas cada grupo de mesmo valor descarta (chave → descartes):
//  1. A substitutiva nunca soma: o grupo dela descarta uma por substitutiva
//     (a nota menor fica de fora). Se isso tirar mais do que sobrava, falta
//     ponto — é o professor que distribuiu de menos.
//  2. O que ainda sobra fecha com MAX em grupos de mesmo valor, na combinação
//     que descarta menos notas e, empatando, usa menos grupos (ex.: sobra 7 =
//     uma de 5 pts + duas de 1 pt). Sem combinação exata, a sobra fica para o
//     levantamento com o professor.
function fdMaxPlan(rows, excess) {
  const byValue = new Map();
  for (const r of rows) {
    const key = fdKey(r.value);
    if (!byValue.has(key)) byValue.set(key, []);
    byValue.get(key).push(r);
  }
  const groups = [...byValue].filter(([, m]) => m.length >= 2).map(([key, members]) => {
    const subst = Math.min(members.filter(r => fdIsSubst(r.name)).length, members.length - 1);
    return { key, cents: Math.round(members[0].value * 100), subst, room: members.length - 1 - subst };
  });
  const plan = new Map(groups.filter(g => g.subst).map(g => [g.key, g.subst]));

  const rest = Math.round(excess * 100) - groups.reduce((n, g) => n + g.subst * g.cents, 0);
  const usable = groups.filter(g => g.room > 0 && g.cents <= rest);
  if (rest <= 0 || !usable.length) return plan;

  // Mochila limitada em "unidades" (centavos divididos pelo mdc dos valores):
  // best[u] = o jeito de descartar exatamente u unidades com menos notas.
  const gcd  = (a, b) => (b ? gcd(b, a % b) : a);
  const unit = usable.reduce((g, x) => gcd(g, x.cents), rest);
  const goal = rest / unit;
  let best = new Array(goal + 1).fill(null);
  best[0] = { drops: 0, groups: 0, pick: [] };
  for (const g of usable) {
    const size = g.cents / unit;
    const next = best.slice();
    for (let u = 0; u < goal; u++) {
      const b = best[u];
      if (!b) continue;
      for (let d = 1; d <= g.room && u + d * size <= goal; d++) {
        const cand = { drops: b.drops + d, groups: b.groups + (g.subst ? 0 : 1), pick: [...b.pick, [g.key, d]] };
        const cur  = next[u + d * size];
        if (!cur || cand.drops < cur.drops || (cand.drops === cur.drops && cand.groups < cur.groups)) next[u + d * size] = cand;
      }
    }
    best = next;
  }
  if (best[goal]) for (const [key, d] of best[goal].pick) plan.set(key, (plan.get(key) || 0) + d);
  return plan;
}

// Grupos MAX: as atividades marcadas "Grupo MAX" de mesmo valor formam um
// Max(n;…) cada, em ordem de P. Sem n escolhido, descarta uma (k−1).
function fdMaxGroups(state) {
  const byValue = new Map();
  for (const r of state.rows) {
    if (r.role !== 'max') continue;
    const key = fdKey(r.value);
    if (!byValue.has(key)) byValue.set(key, []);
    byValue.get(key).push(r);
  }
  return [...byValue].map(([key, rows]) => {
    const members = [...rows].sort((a, b) => a.p - b.p);
    const n = Math.min(members.length, Math.max(1, state.maxN[key] ?? members.length - 1));
    return { key, value: members[0].value, members, n, val: fdRound(n * members[0].value), sum: fdSum(members) };
  }).sort((a, b) => a.members[0].p - b.members[0].p);
}

// Sugestão inicial (tudo editável depois): acha a reavaliação, fecha a sobra
// com MAX e marca o que a reavaliação cobre.
function fdSuggest(items) {
  const rows  = items.map(r => ({ ...r, role: r.value > 0 ? 'soma' : 'fora' }));
  const state = { rows, maxN: {}, maxInReav: false };

  // Reavaliação pelo nome; se houver mais de uma, a de maior valor. As outras
  // ficam fora da fórmula (com aviso), para não entrarem num MAX com as provas.
  const reavs = rows.filter(r => r.role === 'soma' && fdIsReav(r.name)).sort((a, b) => b.value - a.value);
  const reav  = reavs[0];
  if (reav) reav.role = 'reav';
  reavs.slice(1).forEach(r => { r.role = 'fora'; });

  const others = rows.filter(r => r.role === 'soma');
  for (const [key, drops] of fdMaxPlan(others, fdRound(fdSum(others) - 100))) {
    const members = others.filter(r => fdKey(r.value) === key);
    members.forEach(r => { r.role = 'max'; });
    state.maxN[key] = members.length - drops;
  }

  // A de 100 (ou a que vale o mesmo que o resto) cobre tudo; a menor cobre a
  // avaliação de mesmo valor — de preferência prova/avaliação, a última.
  if (reav) {
    if (fdEq(reav.value, 100) || fdEq(reav.value, fdBuild(state).total)) {
      rows.forEach(r => { if (r.role === 'soma') r.role = 'alvo'; });
      state.maxInReav = true;
    } else {
      const same = rows.filter(r => r.role === 'soma' && fdEq(r.value, reav.value));
      const pick = same.filter(r => /prova|avalia|global/.test(fdPlain(r.name))).pop() || same.pop();
      if (pick) pick.role = 'alvo';
    }
  }
  return state;
}

// Fórmula + a conta com a nota máxima de cada P, como o "Executar" do SGA.
function fdBuild(state) {
  const rows  = state.rows;
  const byP   = list => [...list].sort((a, b) => a.p - b.p);
  const P     = r => 'P' + r.p;
  const reav  = rows.find(r => r.role === 'reav') || null;
  const maxGroups = fdMaxGroups(state);
  // Sem reavaliação, "coberta pela reav." conta como soma comum.
  const alvos = reav ? byP(rows.filter(r => r.role === 'alvo')) : [];
  const somas = byP(rows.filter(r => r.role === 'soma' || (!reav && r.role === 'alvo')));
  const maxInReav = !!reav && maxGroups.length > 0 && state.maxInReav;

  const maxExprs = maxGroups.map(g => `Max(${g.n};${g.members.map(P).join(';')})`);
  const inside   = [...alvos.map(P), ...(maxInReav ? maxExprs : [])];
  const outside  = [...somas.map(P), ...(maxInReav ? [] : maxExprs)];
  const formula  = reav
    ? `Reav(${P(reav)};${inside.join('+')})${outside.length ? '+' + outside.join('+') : ''}`
    : outside.join('+');

  const maxVal  = fdRound(maxGroups.reduce((n, g) => n + g.val, 0));
  const covered = fdRound(fdSum(alvos) + (maxInReav ? maxVal : 0));
  const outer   = fdRound(fdSum(somas) + (maxInReav ? 0 : maxVal));
  const total   = fdRound(covered + outer);
  const diff    = fdRound(total - 100);
  const pesos   = !reav ? null : fdEq(outer, 0) ? 1 : 0;

  const warnings = [];
  const used = rows.filter(r => r.role !== 'fora').map(r => r.p);
  const dup  = [...new Set(used.filter((p, i) => used.indexOf(p) !== i))];
  if (dup.length) warnings.push(`P repetido: ${dup.map(p => 'P' + p).join(', ')} — cada atividade tem um P só.`);
  if (reav && !inside.length) {
    warnings.push(`Marque o que a reavaliação cobre ("Coberta pela reav."): atividades que somem ${anFmtPoints(reav.value)} pts.`);
  } else if (reav && !fdEq(reav.value, covered)) {
    warnings.push(`A reavaliação vale ${anFmtPoints(reav.value)} pts, mas o que ela cobre soma ${anFmtPoints(covered)} — os dois têm que valer o mesmo.`);
  }
  for (const g of maxGroups) {
    if (g.members.length === 1) warnings.push(`O grupo MAX de ${fdPts(g.value)} tem uma atividade só — não há o que descartar.`);
    else if (g.n >= g.members.length) warnings.push(`O MAX de ${fdPts(g.value)} pega todas as notas do grupo — não descarta nenhuma.`);
  }
  const otherReav = reav ? rows.filter(r => r !== reav && fdIsReav(r.name)) : [];
  if (otherReav.length) {
    warnings.push(`${otherReav.map(r => `P${r.p} (${r.name})`).join(', ')} também parece reavaliação, mas a fórmula tem uma só. `
      + 'Se ela também vale, precisa de outro Reav — combine com o professor; se é cópia, deixe "Fora da fórmula".');
  }
  const closes = fdEq(diff, 0) && (!reav || (inside.length > 0 && fdEq(reav.value, covered)));
  return { formula, reav, maxGroups, maxVal, covered, outer, total, diff, pesos, warnings, closes };
}

// Sobra sem MAX que resolva: simula tirar a sobra de cada atividade e lista
// quem perderia nota (nota acima do novo máximo). Sem prejuízo primeiro.
function fdImpact(state, diff, grades, coversAll) {
  return state.rows
    .filter(r => (r.role === 'soma' || (coversAll && r.role === 'alvo')) && r.value > diff + 0.005)
    .map(r => {
      const newMax = fdRound(r.value - diff);
      const hurt = grades.subs
        .filter(s => s.assignment_id === r.id && !s.excused && s.score != null && s.score > newMax + 0.005)
        .map(s => ({ name: anStudentName(grades.names, s), score: s.score }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt-BR'));
      return { row: r, newMax, hurt };
    })
    .sort((a, b) => a.hurt.length - b.hurt.length || b.row.value - a.row.value || a.row.p - b.row.p);
}

// Forma canônica para comparar duas fórmulas: sem espaços, maiúsculas, sem
// parênteses só de agrupar soma e com os termos em ordem — assim
// P3+reav(P17;(P2+P1)) e Reav(P17;P1+P2)+P3 são iguais. Só +, Reav e Max.
function fdCanon(formula) {
  const f = String(formula || '').toUpperCase().replace(/\s+/g, '');
  const close = (s, open) => {   // índice do ")" que fecha o "(" em open
    for (let i = open, depth = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')' && --depth === 0) return i;
    }
    return -1;
  };
  const split = (s, sep) => {    // separa no nível de fora dos parênteses
    const out = [];
    let depth = 0, from = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      else if (s[i] === sep && depth === 0) { out.push(s.slice(from, i)); from = i + 1; }
    }
    out.push(s.slice(from));
    return out;
  };
  const sum  = s => split(s, '+').filter(Boolean).flatMap(term).sort().join('+');
  const term = t => {
    if (t.startsWith('(') && close(t, 0) === t.length - 1) return split(t.slice(1, -1), '+').filter(Boolean).flatMap(term);
    const m = /^(MAX|REAV)\((.*)\)$/.exec(t);
    if (!m || close(t, m[1].length) !== t.length - 1) return [t];
    const args = split(m[2], ';').map(sum);
    if (m[1] === 'REAV') return [`REAV(${args.join(';')})`];
    const [n, ...ps] = args;
    return [`MAX(${n};${ps.sort().join(';')})`];
  };
  return sum(f);
}

// Lê um literal do Python (dict/list/tuple com aspas simples, None/True/False,
// Decimal('5.00')) ou JSON a partir de src[start] — é como a Sincronização
// SGA embute os dados no HTML.
function sgaLiteral(src, start) {
  let i = start;
  const fail = () => { throw new Error('a Sincronização SGA mandou os dados num formato inesperado'); };
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const str = q => {
    let out = '';
    i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] !== '\\') { out += src[i++]; continue; }
      const c = src[++i];
      if (c === 'u') { out += String.fromCharCode(parseInt(src.substr(i + 1, 4), 16)); i += 5; continue; }
      if (c === 'x') { out += String.fromCharCode(parseInt(src.substr(i + 1, 2), 16)); i += 3; continue; }
      out += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }[c] ?? c;
      i++;
    }
    if (src[i] !== q) fail();
    i++;
    return out;
  };
  const seq = (close, add) => {
    i++;
    ws();
    if (src[i] === close) { i++; return; }
    for (;;) {
      add();
      ws();
      const sep = src[i++];
      if (sep === close) return;
      if (sep !== ',') fail();
      ws();
      if (src[i] === close) { i++; return; }
    }
  };
  const val = () => {
    ws();
    const c = src[i];
    if (c === '{') {
      const o = {};
      seq('}', () => { const k = val(); ws(); if (src[i++] !== ':') fail(); o[k] = val(); });
      return o;
    }
    if (c === '[' || c === '(') {
      const a = [];
      seq(c === '[' ? ']' : ')', () => a.push(val()));
      return a;
    }
    if (c === '"' || c === "'") return str(c);
    const num = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(src.slice(i, i + 40));
    if (num) { i += num[0].length; return Number(num[0]); }
    const id = /^[A-Za-z_][\w.]*/.exec(src.slice(i, i + 80));
    if (!id) fail();
    i += id[0].length;
    const consts = { None: null, null: null, True: true, true: true, False: false, false: false };
    if (id[0] in consts) return consts[id[0]];
    if (/^[ubrUBR]{1,2}$/.test(id[0]) && (src[i] === "'" || src[i] === '"')) return str(src[i]);
    ws();
    if (src[i] !== '(') fail();
    const args = val();                 // Decimal('5.00') → '5.00'
    return args.length === 1 ? args[0] : args;
  };
  return val();
}

// Os dados que a página da Sincronização SGA embute para o Vue.
function sgaParse(html) {
  const grab = key => {
    const m = new RegExp(`\\b${key}\\s*:\\s*[\\[{]`).exec(html);
    return m ? sgaLiteral(html, m.index + m[0].length - 1) : undefined;
  };
  const disciplina = grab('disciplina');
  if (!disciplina || typeof disciplina !== 'object') throw new Error('a página da Sincronização SGA veio sem os dados da disciplina');
  return { disciplina, task: grab('task') || {}, assignments: grab('assignments') || [], avaliacoes: grab('avaliacoes') || [] };
}

// Liga cada tarefa à sigla do SGA: nome (o SGA corta a descrição) e valor;
// sem par pelo valor, só pelo nome, se for único. Tarefa sem sigla ganha um
// número depois do último P do SGA. Devolve as siglas que sobraram.
function sgaApplySiglas(items, avaliacoes) {
  const norm = s => fdPlain(s).replace(/\s+/g, ' ').trim();
  const list = avaliacoes.map(a => ({
    sigla: String(a.sigla_avaliacao ?? '').trim(),
    p:     parseInt(String(a.sigla_avaliacao ?? '').replace(/\D/g, ''), 10),
    name:  String(a.dsc_avaliacao ?? '').trim(),
    value: Number(a.val_avaliacao),
    lancamentos: a.lancamentos,
    canvas:  !!a.consta_canvas,
    formula: !!a.consta_formula,
  })).filter(a => a.p > 0).sort((a, b) => b.canvas - a.canvas || a.p - b.p);
  const used = new Set();
  const sameName = (it, a) => {
    const x = norm(it.name), y = norm(a.name);
    return !!y && (x === y || (y.length >= 20 && x.startsWith(y)));
  };
  for (const pass of ['nome e valor', 'nome']) {
    for (const it of items) {
      if (it.sigla) continue;
      const cands = list.filter(a => !used.has(a) && sameName(it, a) && (pass === 'nome' || fdEq(a.value, it.value)));
      if (!cands.length || (pass === 'nome' && cands.length > 1)) continue;
      used.add(cands[0]);
      it.p     = cands[0].p;
      it.sigla = cands[0].sigla;
      if (!fdEq(cands[0].value, it.value)) it.sgaValue = cands[0].value;
    }
  }
  let next = Math.max(0, ...list.map(a => a.p));
  for (const it of items) if (!it.sigla) { it.p = ++next; it.sigla = ''; }
  return list.filter(a => !used.has(a)).sort((a, b) => a.p - b.p);
}

function fdRow(id) {
  return _fd.state.rows.find(r => String(r.id) === String(id));
}

function fdSetRole(row, role) {
  if (role === 'reav') _fd.state.rows.forEach(r => { if (r.role === 'reav' && r !== row) r.role = 'soma'; });
  // Mudou um grupo MAX: ele volta ao automático (descarta uma).
  if (role === 'max' || row.role === 'max') delete _fd.state.maxN[fdKey(row.value)];
  row.role = role;
  document.querySelectorAll('#an-card-diario .fd-role').forEach(sel => { sel.value = fdRow(sel.dataset.id).role; });
  fdRenderMaxOpts();
  fdRenderOut();
}

// Opções dos MAX, uma linha por grupo de mesmo valor. Ficam fora do #fd-out
// para não perder o foco ao digitar; só são refeitas quando um grupo muda.
function fdRenderMaxOpts() {
  const opts = $('fd-max-opts');
  if (!opts) return;
  opts.innerHTML = '';
  for (const g of fdMaxGroups(_fd.state)) {
    const label = anEl('label');
    const input = anEl('input', 'fd-p');
    input.type  = 'number';
    input.min   = '1';
    input.dataset.key = g.key;
    input.addEventListener('input', () => {
      const v = parseInt(input.value, 10);
      if (v >= 1) _fd.state.maxN[g.key] = v;
      else delete _fd.state.maxN[g.key];
      fdRenderOut();
    });
    label.append(`MAX das ${g.members.length} de ${fdPts(g.value)}: pega as `, input, ' maiores');
    opts.appendChild(label);
  }
  const inLabel = anEl('label');
  inLabel.id = 'fd-max-in-wrap';
  const inBox = anEl('input');
  inBox.id   = 'fd-max-in';
  inBox.type = 'checkbox';
  inBox.addEventListener('change', () => { _fd.state.maxInReav = inBox.checked; fdRenderOut(); });
  inLabel.append(inBox, ' MAX dentro da reavaliação');
  opts.appendChild(inLabel);
}

function fdRowEl(r) {
  const row = anEl('div', 'fd-row');
  const p = anEl('input', 'fd-p');
  p.type  = 'number';
  p.min   = '1';
  p.value = r.p;
  p.title = 'Número P no SGA (confira na Sincronização SGA)';
  p.addEventListener('input', () => {
    const v = parseInt(p.value, 10);
    if (v >= 1) { r.p = v; fdRenderOut(); }
  });
  const info = anEl('div', 'fd-info');
  info.appendChild(anLink(r.name, r.url, 'an-item-name'));
  const notes = [fdPts(r.value)];
  if (r.sigla) notes.push(`${r.sigla} no SGA`);
  if (r.sgaValue != null) notes.push(`no SGA vale ${anFmtPoints(r.sgaValue)}`);
  const sub = anEl('div', 'an-item-sub', notes.join(' · '));
  if (r.sigla === '') sub.appendChild(anEl('span', 'fd-warn', ' · sem sigla no SGA'));
  info.appendChild(sub);
  const sel = anEl('select', 'fd-role');
  sel.dataset.id = r.id;
  for (const [value, label] of FD_ROLES) {
    const o = anEl('option', '', label);
    o.value = value;
    sel.appendChild(o);
  }
  sel.value = r.role;
  sel.addEventListener('change', () => fdSetRole(r, sel.value));
  row.append(p, info, sel);
  return row;
}

// Quadro do que veio da Sincronização SGA: situação do diário e de onde
// saíram os números P.
function fdRenderSga(card) {
  const box = anEl('div', 'an-msg');
  if (!_fd.sga) {
    box.classList.add('warn');
    box.textContent = `⚠ Não deu para ler a Sincronização SGA (${_fd.sgaError}). Os P seguem a ordem do Canvas e podem não bater com o SGA — confira antes de lançar.`;
    card.appendChild(box);
    return;
  }
  const d = _fd.sga.disciplina;
  const t = _fd.sga.task || {};
  box.appendChild(anEl('b', '', 'Sincronização SGA'));
  box.appendChild(anEl('div', '', [d.seq_turma, d.nom_disciplina].filter(Boolean).join(' - ')));
  box.appendChild(anEl('div', '', `Diário ${d.ind_diario_fechado ? 'fechado' : 'aberto'} · fechamento por grupo: ${d.ind_formula_grupo ? 'sim' : 'não'}`
    + (t.processed && t.done_at ? ` · última sincronização: ${t.done_at}` : '')));
  const rows = _fd.state.rows;
  if (!_fd.sga.avaliacoes.length) {
    box.appendChild(anEl('div', 'fd-warn', '⚠ O SGA não mandou as siglas: os P seguem a ordem do Canvas e podem não bater (o P sai na ordem de sincronização). Confira antes de lançar.'));
  } else {
    const found = rows.filter(r => r.sigla).length;
    box.appendChild(anEl('div', found === rows.length ? 'green' : 'fd-warn',
      found === rows.length ? `✓ P lidos do SGA para as ${rows.length} tarefas.`
        : `⚠ P lidos do SGA para ${found} de ${rows.length} tarefas — as outras estão sem sigla (sincronizou depois de criar?).`));
  }
  card.appendChild(box);
  if (_fd.leftover.length) {
    const body = anSection(card, 'Siglas do SGA sem tarefa no Canvas', _fd.leftover.length, 'gray');
    _fd.leftover.forEach(a => body.appendChild(anEl('div', 'an-item',
      `${a.sigla} · ${a.name} · ${anFmtPoints(a.value)} pts · `
      + (a.canvas ? 'consta no Canvas' : 'pendente de exclusão') + (a.formula ? ' · consta na fórmula' : ''))));
  }
}

function fdRenderCard() {
  const card = anCard('an-card-diario', 'Fórmula do diário (SGA)',
    'Tarefas que vão ao SGA. O P vem da sincronização e nunca é reaproveitado: com as siglas da Sincronização SGA, a numeração sai de lá; sem elas, segue a ordem do Canvas e pode ser corrigida no campo de cada tarefa.');
  fdRenderSga(card);
  const rows = _fd.state.rows;
  if (!rows.length) {
    card.appendChild(anEl('div', 'an-msg red', 'Nenhuma tarefa vai para o SGA (publicada, com SIS e com pontos).'));
    return;
  }
  const out = anEl('div');
  out.id = 'fd-out';
  card.appendChild(out);

  const body = anSection(card, 'Atividades (P)', rows.length, 'gray', true);
  rows.forEach(r => body.appendChild(fdRowEl(r)));

  const opts = anEl('div', 'fd-opts');
  opts.id = 'fd-max-opts';
  card.appendChild(opts);

  const redo = anEl('button', 'btn-link-sm fd-redo', '↺ Refazer a sugestão');
  redo.addEventListener('click', () => {
    _fd.state = fdSuggest(_fd.items);
    fdRenderCard();
  });
  card.appendChild(redo);
  fdRenderMaxOpts();
  fdRenderOut();
}

// O que falta conferir para a fórmula ir ao professor: P que não vieram do
// SGA (ou foram mudados à mão) e valores que o SGA ainda não tem — o
// "Executar" do SGA calcula com os valores dele, não com os do Canvas.
function fdReview() {
  const out  = [];
  const rows = _fd.state.rows.filter(r => r.role !== 'fora');
  const Ps   = list => list.map(r => 'P' + r.p).join(', ');
  if (!_fd.sga) {
    out.push('os P seguem a ordem do Canvas (não deu para ler a Sincronização SGA) — confira cada um lá.');
  } else if (!_fd.sga.avaliacoes.length) {
    out.push('o SGA não mandou as siglas: os P seguem a ordem do Canvas — confira cada um na Sincronização SGA.');
  } else {
    const noSigla = rows.filter(r => !r.sigla);
    if (noSigla.length) out.push(`${Ps(noSigla)} sem sigla no SGA (criada ou renomeada depois da sincronização) — sincronize e rode de novo.`);
    const edited = rows.filter(r => r.sigla && r.sigla.toUpperCase() !== 'P' + r.p);
    if (edited.length) out.push(`${edited.map(r => `P${r.p} (no SGA é ${r.sigla})`).join(', ')} — número mudado à mão.`);
    const lost = _fd.leftover.filter(a => a.canvas);
    if (lost.length) {
      out.push(`${lost.map(a => `${a.sigla} (${a.name})`).join(', ')} está no SGA, mas não casou com nenhuma tarefa que vai ao SGA `
        + '(renomeada, despublicada ou sem SIS?) — confira na Sincronização SGA.');
    }
  }
  const value = rows.filter(r => r.sgaValue != null);
  if (value.length) {
    out.push(`${value.map(r => `P${r.p} vale ${anFmtPoints(r.value)} no Canvas e ${anFmtPoints(r.sgaValue)} no SGA`).join('; ')}`
      + ' — sincronize antes: o SGA calcula com o valor dele.');
  }
  return out;
}

// Parte que muda a cada edição: situação, fórmula, conta, cadastro da
// reavaliação, avisos e o levantamento para o professor.
function fdRenderOut() {
  const out = $('fd-out');
  if (!out || !_fd) return;
  const b = fdBuild(_fd.state);
  out.innerHTML = '';

  const opts = $('fd-max-opts');
  opts.style.display = b.maxGroups.length ? 'flex' : 'none';
  $('fd-max-in-wrap').style.display = b.reav ? '' : 'none';
  opts.querySelectorAll('input[data-key]').forEach(input => {
    const g = b.maxGroups.find(x => x.key === input.dataset.key);
    if (g && document.activeElement !== input) input.value = g.n;
  });
  $('fd-max-in').checked = !!_fd.state.maxInReav;

  // "Pronta para o professor" só quando fecha, sem aviso e com P e valores
  // conferidos no SGA — a fórmula vai direto para o diário.
  const review = fdReview();
  if (b.closes && !review.length && !b.warnings.length) {
    out.appendChild(anEl('div', 'an-msg green', '✓ Fecha em 100 — fórmula pronta para o professor.'));
  } else if (b.closes) {
    const msg = anEl('div', 'an-msg warn');
    msg.appendChild(anEl('b', '', '⚠ Fecha em 100, mas confira antes de passar ao professor:'));
    [...review, ...(b.warnings.length ? ['os avisos mais abaixo.'] : [])]
      .forEach(t => msg.appendChild(anEl('div', '', '• ' + t)));
    out.appendChild(msg);
  } else if (b.diff > 0) {
    out.appendChild(anEl('div', 'an-msg red',
      `⚠ ${fdEq(b.diff, 1) ? 'Sobra' : 'Sobram'} ${fdPts(b.diff)}: a nota máxima fica em ${anFmtPoints(b.total)}.`));
  } else if (b.diff < 0) {
    out.appendChild(anEl('div', 'an-msg red',
      `⚠ ${fdEq(b.diff, -1) ? 'Falta' : 'Faltam'} ${fdPts(-b.diff)}: a nota máxima fica em ${anFmtPoints(b.total)}.`));
  } else {
    out.appendChild(anEl('div', 'an-msg red', '⚠ Ainda não fecha: falta acertar a reavaliação (veja o aviso abaixo).'));
  }

  const box  = anEl('div', 'fd-formula');
  box.appendChild(anEl('code', '', b.formula || '—'));
  const copy = anEl('button', 'btn-link-sm', '📋 copiar');
  // Fórmula que não fecha não vai para o professor.
  copy.disabled = !b.formula || !b.closes;
  if (!b.closes) copy.title = 'A fórmula ainda não fecha em 100';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.formula);
      copy.textContent = '✓ copiada';
    } catch {
      copy.textContent = 'não deu para copiar';
    }
    setTimeout(() => { copy.textContent = '📋 copiar'; }, 1600);
  });
  box.appendChild(copy);
  out.appendChild(box);

  if (_fd.sga) {
    const cur = String(_fd.sga.disciplina.dsc_formula ?? '').trim();
    const line = anEl('div', 'an-msg');
    if (!cur || /^n[aã]o h[aá] f[oó]rmula/i.test(cur)) {
      line.textContent = 'No SGA ainda não há fórmula cadastrada.';
    } else {
      const same = !!b.formula && fdCanon(cur) === fdCanon(b.formula);
      line.appendChild(anEl('div', '', 'Fórmula atual no SGA:'));
      line.appendChild(anEl('code', 'fd-code', cur));
      line.appendChild(anEl('div', same ? 'green' : 'fd-warn',
        same ? '✓ Igual à sugerida (mesmos termos).' : '≠ Diferente da sugerida.'));
    }
    out.appendChild(line);
  }

  const conta = anEl('div', 'an-msg');
  for (const g of b.maxGroups) {
    conta.appendChild(anEl('div', '', `Max(${g.n}; ${g.members.length} atividades) = ${anFmtPoints(g.val)} de ${anFmtPoints(g.sum)} pts`
      + (g.members.length > g.n ? ` (descarta ${g.members.length - g.n})` : '')));
  }
  if (b.reav) {
    conta.appendChild(anEl('div', '', `Coberto pela reavaliação (P${b.reav.p}, ${anFmtPoints(b.reav.value)} pts): ${anFmtPoints(b.covered)} pts`));
    conta.appendChild(anEl('div', '', `Somado por fora: ${anFmtPoints(b.outer)} pts`));
  }
  conta.appendChild(anEl('b', '', `Nota máxima: ${anFmtPoints(b.total)}`));
  out.appendChild(conta);

  const sga = anEl('div', 'an-msg');
  if (b.reav) {
    sga.appendChild(anEl('b', '', `No SGA, a reavaliação (P${b.reav.p}) fica assim:`));
    sga.appendChild(anEl('div', '', '• Tipo: Reavaliação (não "Trabalho")'));
    sga.appendChild(anEl('div', '', `• Peso Nota Parcial: ${b.pesos} · Peso Reavaliação: ${b.pesos}`
      + (b.pesos ? ' (média: a reavaliação cobre tudo)' : ' (substitui o que ela cobre)')));
    sga.appendChild(anEl('div', '', '• "Não substituir reavaliação se o total for menor": marcado'));
    sga.appendChild(anEl('div', '', '• "Reavaliação por módulo": desmarcado'));
  } else {
    sga.appendChild(anEl('div', '', 'Sem reavaliação: a fórmula é a soma das atividades (pesos 0 e 0).'));
  }
  out.appendChild(sga);

  b.warnings.forEach(w => out.appendChild(anEl('div', 'an-msg warn', '⚠ ' + w)));

  if (b.diff < 0) {
    const pts = fdPts(-b.diff);
    const body = anSection(out, 'O que o professor pode fazer', 1, 'gray', true);
    body.appendChild(anEl('div', 'an-item', `Criar uma tarefa de ${pts}, com SIS, e lançar ${pts} para todos os alunos — ninguém perde nota.`
      + (b.reav && b.pesos === 1 ? ' Depois de sincronizar, ela entra dentro do Reav (marque "Coberta pela reav.").' : '')));
  } else if (b.diff > 0) {
    fdRenderImpact(out, b);
  }
}

function fdRenderImpact(out, b) {
  const pts = fdPts(b.diff);
  out.appendChild(anEl('div', 'an-msg', `O professor pode tirar ${pts} de uma atividade. Quem tem nota acima do novo máximo perde nota — as opções sem prejuízo vêm primeiro.`));
  if (!_fd.grades) {
    if (_fd.gradesError) out.appendChild(anEl('div', 'an-msg warn', '⚠ ' + _fd.gradesError));
    const btn = anEl('button', 'btn btn-surface btn-full mt4', '📊  Ver quem perderia nota');
    btn.id = 'btn-fd-impact';
    btn.addEventListener('click', () => anRun('btn-fd-impact', async (tabId, base) => {
      if (base !== _fd.base) throw new Error('A aba mudou de disciplina — rode a "Fórmula do diário" de novo.');
      _fd.grades = await anLoadGrades(tabId, base);
      _fd.gradesError = '';
      fdRenderOut();
    }));
    out.appendChild(btn);
    return;
  }
  const list = fdImpact(_fd.state, b.diff, _fd.grades, b.pesos === 1);
  if (!list.length) {
    out.appendChild(anEl('div', 'an-msg warn', `⚠ Nenhuma atividade vale mais de ${pts} — combine com o professor como redistribuir.`));
    return;
  }
  for (const it of list) {
    const title = `P${it.row.p} · ${it.row.name}: ${anFmtPoints(it.row.value)} → ${anFmtPoints(it.newMax)} pts`;
    const body  = anSection(out, title, it.hurt.length, it.hurt.length ? 'red' : 'green');
    if (!it.hurt.length) {
      body.appendChild(anEl('div', 'an-item', `Nenhum aluno tem nota acima de ${anFmtPoints(it.newMax)} — ninguém perde nota.`));
      continue;
    }
    const box = anEl('div', 'an-item');
    box.appendChild(anLink('Abrir tarefa no Canvas ↗', it.row.url, 'an-open'));
    it.hurt.forEach(h => box.appendChild(anEl('div', 'an-student', `• ${h.name} — nota ${anFmtPoints(h.score)}`)));
    body.appendChild(box);
  }
}

// ── Sincronização SGA (ferramenta LTI ead05.virtual.pucminas.br/sga_sync) ──
// Só leitura, por trás e só no clique: pega no Canvas a página da ferramenta
// (que traz o formulário de acesso assinado), faz o mesmo POST que o iframe
// faria e lê os dados embutidos no HTML. Nunca chama /sga_sync/sync — é o
// botão "Sincronizar" da página.
const SGA_HOST = 'ead05.virtual.pucminas.br';
const SGA_TOOL_ID = 1187;   // id da ferramenta na conta, se a aba não for achada

async function sgaLoad(tabId, base) {
  const origin   = base.replace(/\/api\/v1\/courses\/\d+$/, '');
  const courseId = base.match(/\/courses\/(\d+)$/)[1];

  // A aba "Sincronização SGA" do curso diz qual ferramenta abrir.
  let toolPath = `/courses/${courseId}/external_tools/${SGA_TOOL_ID}`;
  try {
    const tabs = JSON.parse((await anGet(tabId, `${base}/tabs`)).text);
    const tab  = tabs.find(t => /sincronizac/.test(fdPlain(t.label)) && /sga/i.test(t.label || ''));
    if (tab?.html_url) toolPath = tab.html_url;
  } catch { /* sem a lista de abas: fica com o id conhecido */ }

  const page = await anGet(tabId, new URL(toolPath, origin).href, 'text/html');
  const doc  = new DOMParser().parseFromString(page.text, 'text/html');
  const form = [...doc.querySelectorAll('form[action]')].find(f => {
    try { return new URL(f.getAttribute('action'), origin).host === SGA_HOST; } catch { return false; }
  });
  if (!form) throw new Error('a página da ferramenta no Canvas veio sem o acesso à Sincronização SGA');
  const action = new URL(form.getAttribute('action'), origin);
  if (action.protocol !== 'https:' || !action.pathname.startsWith('/sga_sync/') || /\/sync\b/.test(action.pathname)) {
    throw new Error('endereço inesperado da Sincronização SGA: ' + action.pathname);
  }
  const body = new URLSearchParams();
  form.querySelectorAll('input[name]').forEach(input => body.append(input.name, input.value));

  let res  = await fetch(action.href, { method: 'POST', body, credentials: 'include' });
  let html = await res.text();
  if (!/vue_diario/.test(html)) {
    // Não caiu direto na página dos dados: abre o index com a sessão do acesso.
    const userId = body.get('custom_canvas_user_id') || '';
    res  = await fetch(`https://${SGA_HOST}/sga_sync/index?course_id=${courseId}&user_id=${encodeURIComponent(userId)}`, { credentials: 'include' });
    html = await res.text();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} na Sincronização SGA`);
  return sgaParse(html);
}

function doAnaliseDiario() {
  return anRun('btn-an-diario', async (tabId, base) => {
    anStatus('Carregando tarefas...');
    const groups      = await anGetAll(tabId, `${base}/assignment_groups?per_page=100`);
    const assignments = await anGetAll(tabId, `${base}/assignments?per_page=100`);
    const items = fdItems(assignments, groups);

    anStatus('Lendo a Sincronização SGA...');
    let sga = null, sgaError = '', leftover = [];
    try {
      sga = await sgaLoad(tabId, base);
    } catch (err) {
      sgaError = err.message;
    }
    if (sga?.avaliacoes?.length) leftover = sgaApplySiglas(items, sga.avaliacoes);

    _fd = { base, items, state: fdSuggest(items), sga, sgaError, leftover, grades: null, gradesError: '' };
    // Sobra sem MAX que resolva: já lê as notas para o levantamento.
    if (fdBuild(_fd.state).diff > 0) {
      try {
        _fd.grades = await anLoadGrades(tabId, base);
      } catch (err) {
        _fd.gradesError = err.message;
      }
    }
    fdRenderCard();
  });
}

// ── Trocar banner dos cursos ─────────────────────────────────────────
// Procura as imagens de banner em Arquivos › Layout de cada curso e sobe a
// nova imagem por cima delas, com o MESMO nome e on_duplicate "overwrite": o
// Canvas redireciona o arquivo antigo para o novo, então as páginas que já
// usam o banner passam a mostrar o novo sem edição nenhuma. O ticket de upload
// sai da aba do Canvas (sessão + CSRF) e o binário sobe do painel, como nos
// materiais complementares. Portado dos modais de banner da extensão AVA.

const BANNER_MAX_COURSES = 10;
const BANNER_FOLDER      = 'Layout';

// Começo do nome (sem extensão, sem acento, minúsculo) dos arquivos de banner.
const BANNER_PREFIXES = [
  'banner',
  'nova pos',
  'apresentacao-coordenacao',
  'biblioteca',
  'cronograma-do-curso',
  'estrutura-curso-disciplinas',
];

let _banFile     = null;   // nova imagem escolhida
let _banImageUrl = null;   // object URL da prévia da imagem
let _banScan     = null;   // [{ courseId, name, folderId, error, files: [{ id, name, size, checked }] }]
let _banProgress = {};     // `${courseId}:${fileId}` → { status, detail }
let _banRunKeys  = [];     // chaves da rodada em andamento (para o "N de M")
let _banPhase    = 'idle'; // 'idle' | 'scanning' | 'running' | 'done'

function isBannerFile(name) {
  const base = (name || '').replace(/\.[^.]+$/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
  return BANNER_PREFIXES.some(p => base.startsWith(p));
}

function banStatus(msg, color) {
  const el = $('ban-status');
  el.textContent = msg;
  el.style.color = color || '#94a3b8';
  el.style.display = msg ? 'block' : 'none';
}

function banKey(courseId, file) {
  return `${courseId}:${file.id}`;
}

// Arquivos marcados, na ordem da tela, com o curso de cada um.
function banTargets() {
  return (_banScan || []).flatMap(c => c.files.filter(f => f.checked).map(file => ({ course: c, file })));
}

// Resumo da última busca na linha de status (ou nada, se não houve busca).
function banScanSummary() {
  if (!_banScan) { banStatus(''); return; }
  const found   = _banScan.reduce((n, c) => n + c.files.length, 0);
  const courses = _banScan.filter(c => c.files.length).length;
  if (found) banStatus(`${found} arquivo(s) de banner em ${courses} curso(s). Desmarque o que não deve ser trocado.`, '#4ade80');
  else       banStatus(`Nenhum arquivo de banner encontrado em Arquivos › ${BANNER_FOLDER}.`, '#f97316');
}

async function openBanner() {
  show('canvas-banner');
  const input = $('ban-courses-input');
  if (_banPhase === 'idle' && !input.value.trim()) {
    const id = await getCanvasCourseId();
    if (id) input.value = id;
  }
  banSyncUI();
}

// Trocar os cursos invalida a busca: a lista exibida veio de outros cursos.
function banInvalidate() {
  if (!_banScan) return;
  _banScan     = null;
  _banProgress = {};
  _banPhase    = 'idle';
  $('ban-result').style.display = 'none';
  banStatus('Cursos alterados — busque os banners novamente.', '#f97316');
  buildBannerResults();
  banSyncUI();
}

function banPickImage(e) {
  // Guarda o File antes de limpar o input — o FileList esvazia junto.
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    banStatus('✗ Escolha um arquivo de imagem.', '#f87171');
    return;
  }
  _banFile = file;
  if (_banImageUrl) URL.revokeObjectURL(_banImageUrl);
  _banImageUrl = URL.createObjectURL(file);
  $('ban-preview-img').src          = _banImageUrl;
  $('ban-preview-name').textContent = file.name;
  $('ban-preview-name').title       = file.name;
  $('ban-preview-size').textContent = matFmtSize(file.size);
  $('ban-preview').style.display    = 'block';

  // Imagem nova depois de uma rodada: libera substituir de novo, com ela.
  if (_banPhase === 'done') {
    _banPhase    = 'idle';
    _banProgress = {};
    $('ban-result').style.display = 'none';
    buildBannerResults();
  }
  banScanSummary();
  banSyncUI();
}

// Aba ativa do Canvas — as chamadas usam a sessão dela, para qualquer curso.
async function banCanvasTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/\/courses\//.test(tab.url || '')) {
    throw new Error('Abra uma aba do Canvas (qualquer curso) para usar esta ferramenta.');
  }
  return tab.id;
}

async function banExec(tabId, op, p) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    func: bannerCanvasMain,
    args: [op, p],
  });
  const out = res[0]?.result;
  if (out && out.__error) throw new Error(out.__error);
  return out;
}

// Roda na aba do Canvas. `scan` lê a pasta Layout de cada curso, junto com o
// nome do curso (para conferir os códigos digitados); `ticket` pede ao Canvas
// a upload_url para sobrescrever um arquivo da pasta.
function bannerCanvasMain(op, p) {
  return (async () => {
    try {
      const rawCsrf = document.cookie.split(';')
        .map(c => c.trim())
        .find(c => c.startsWith('_csrf_token='));
      const csrf = rawCsrf
        ? decodeURIComponent(rawCsrf.split('=').slice(1).join('='))
        : decodeURIComponent(document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '');

      async function fetchAll(url) {
        const out = [];
        let next = url;
        while (next) {
          const res = await fetch(next);
          if (!res.ok) throw new Error(`HTTP ${res.status} ao listar os arquivos da pasta`);
          const data = await res.json();
          if (Array.isArray(data)) out.push(...data);
          const m = (res.headers.get('Link') || '').match(/<([^>]+)>;\s*rel="next"/);
          next = m ? m[1] : null;
        }
        return out;
      }

      if (op === 'scan') {
        return await Promise.all(p.courseIds.map(async courseId => {
          try {
            const [courseRes, folderRes] = await Promise.all([
              fetch(`/api/v1/courses/${courseId}`),
              fetch(`/api/v1/courses/${courseId}/folders/by_path/${encodeURIComponent(p.folder)}`),
            ]);
            if (!courseRes.ok) {
              return {
                courseId,
                error: courseRes.status === 404 ? 'curso não encontrado' : `sem acesso ao curso (HTTP ${courseRes.status})`,
              };
            }
            const course = await courseRes.json();
            if (!folderRes.ok) {
              return {
                courseId,
                name:  course.name,
                error: folderRes.status === 404
                  ? `pasta Arquivos › ${p.folder} não encontrada`
                  : `HTTP ${folderRes.status} ao abrir a pasta ${p.folder}`,
              };
            }
            // by_path devolve a cadeia de pastas até a pedida — ela é a última.
            const chain  = await folderRes.json();
            const folder = Array.isArray(chain) ? chain[chain.length - 1] : chain;
            const files  = await fetchAll(`/api/v1/folders/${folder.id}/files?per_page=100`);
            return {
              courseId,
              name:     course.name,
              folderId: folder.id,
              // `url` já vem com o verifier do Canvas — serve de miniatura no painel.
              files:    files.map(f => ({
                id:   f.id,
                name: f.display_name,
                size: f.size,
                url:  f.url ? new URL(f.url, location.origin).href : '',
              })),
            };
          } catch (err) {
            return { courseId, error: err.message };
          }
        }));
      }

      if (op === 'ticket') {
        const res = await fetch(`/api/v1/courses/${p.courseId}/files`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({
            name:             p.name,
            size:             p.size,
            content_type:     p.contentType,
            parent_folder_id: p.folderId,
            on_duplicate:     'overwrite',
          }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}${text ? ' — ' + text.slice(0, 160) : ''}`);
        return JSON.parse(text);
      }

      return { __error: `Operação desconhecida: ${op}` };
    } catch (err) {
      return { __error: err.message };
    }
  })();
}

const BAN_STATUS_TITLE = {
  pending: 'na fila', uploading: 'enviando', ok: 'substituído', error: 'erro', skipped: 'não marcado',
};

function buildBannerResults() {
  const box = $('ban-results');
  box.innerHTML = '';
  if (!_banScan) return;
  const editing = _banPhase === 'idle';

  for (const c of _banScan) {
    const statuses = c.files.map(f => _banProgress[banKey(c.courseId, f)]?.status);
    const card = document.createElement('div');
    card.className = 'bulk-course-row ' + (
      c.error                    ? 'error' :
      !c.files.length            ? 'zero'  :
      statuses.includes('error') ? 'warn'  : 'ok');

    // Em edição, a caixa do cabeçalho marca/desmarca todos os arquivos do curso.
    const selectable = editing && c.files.length > 0;
    const head = document.createElement(selectable ? 'label' : 'div');
    head.className = 'bulk-course-row-head';
    if (selectable) {
      const all = document.createElement('input');
      all.type          = 'checkbox';
      all.className     = 'ban-check';
      all.checked       = c.files.every(f => f.checked);
      all.indeterminate = !all.checked && c.files.some(f => f.checked);
      all.addEventListener('change', () => {
        c.files.forEach(f => { f.checked = all.checked; });
        buildBannerResults();
        banSyncUI();
      });
      head.appendChild(all);
    }
    const title = document.createElement('span');
    title.className   = 'ban-course-title';
    title.textContent = `Curso #${c.courseId}` + (c.name ? ` · ${c.name}` : '');
    title.title       = title.textContent;
    head.appendChild(title);
    if (c.files.length) {
      const count = document.createElement('span');
      count.className   = 'bulk-count';
      count.textContent = `${c.files.length} arq.`;
      head.appendChild(count);
    }
    card.appendChild(head);

    if (c.error || !c.files.length) {
      const note = document.createElement('div');
      note.className   = 'bulk-course-note';
      note.textContent = c.error ? '✗ ' + c.error : `Nenhum arquivo de banner em Arquivos › ${BANNER_FOLDER}.`;
      card.appendChild(note);
    } else {
      const list = document.createElement('div');
      list.className = 'ban-files';
      for (const f of c.files) list.appendChild(bannerFileRow(c, f, editing));
      card.appendChild(list);
    }
    box.appendChild(card);
  }
}

function bannerFileRow(course, file, editing) {
  const prog = _banProgress[banKey(course.courseId, file)];
  // Em edição a linha inteira é um <label>: clicar no nome marca/desmarca.
  const row = document.createElement(editing ? 'label' : 'div');
  row.className = 'mat-file'
    + (prog?.status === 'ok' ? ' ok' : prog?.status === 'error' ? ' error' : '');

  // Miniatura em cima, nome embaixo. Depois de substituído, mostra a imagem
  // nova (a URL antiga ainda devolveria o banner velho, do cache).
  const thumbUrl = prog?.status === 'ok' && _banImageUrl ? _banImageUrl : file.url;
  if (thumbUrl) {
    const img = document.createElement('img');
    img.className = 'ban-thumb' + (file.checked ? '' : ' ban-thumb-off');
    img.alt       = '';
    img.loading   = 'lazy';
    img.addEventListener('error', () => img.remove());
    img.src       = thumbUrl;
    row.appendChild(img);
  }

  if (editing) {
    const cb = document.createElement('input');
    cb.type      = 'checkbox';
    cb.className = 'ban-check';
    cb.checked   = file.checked;
    cb.addEventListener('change', () => {
      file.checked = cb.checked;
      buildBannerResults();
      banSyncUI();
    });
    row.appendChild(cb);
  } else {
    const s  = prog?.status || 'skipped';
    const st = document.createElement('span');
    st.className = 'mat-file-status';
    st.title     = BAN_STATUS_TITLE[s];
    if (s === 'uploading')    st.innerHTML = '<span class="spinner"></span>';
    else if (s === 'ok')      { st.textContent = '✓'; st.style.color = '#4ade80'; }
    else if (s === 'error')   { st.textContent = '✗'; st.style.color = '#f87171'; }
    else if (s === 'pending') { st.textContent = '·'; st.style.color = '#64748b'; }
    else                      { st.textContent = '–'; st.style.color = '#64748b'; }
    row.appendChild(st);
  }

  const name = document.createElement('span');
  name.className   = 'mat-file-name' + (file.checked ? '' : ' ban-off');
  name.textContent = file.name;
  name.title       = file.name;
  row.appendChild(name);

  const info = document.createElement('span');
  if (prog?.detail) {
    info.className   = 'mat-file-detail';
    info.textContent = prog.detail;
    info.title       = prog.detail;
  } else {
    info.className   = 'mat-file-size';
    info.textContent = matFmtSize(file.size || 0);
  }
  row.appendChild(info);
  return row;
}

function banSyncUI() {
  const scanning = _banPhase === 'scanning';
  const running  = _banPhase === 'running';

  $('btn-ban-pick').disabled      = running;
  $('btn-ban-pick').textContent   = _banFile ? '🔄  Trocar imagem' : '🖼  Escolher imagem';
  $('ban-courses-input').disabled = scanning || running;
  $('btn-ban-use-tab').disabled   = scanning || running;

  const scan = $('btn-ban-scan');
  scan.disabled = scanning || running;
  if (scanning) scan.innerHTML   = '<span class="spinner"></span>Buscando banners...';
  else          scan.textContent = _banScan ? '🔄  Buscar de novo' : '🔍  Buscar banners';

  const btn = $('btn-ban-apply');
  const found = (_banScan || []).some(c => c.files.length);
  btn.style.display = found ? 'block' : 'none';
  if (!found) return;

  if (running) {
    const done = _banRunKeys.filter(k => /^(ok|error)$/.test(_banProgress[k]?.status)).length;
    btn.className = 'btn btn-green btn-full mt6';
    btn.disabled  = true;
    btn.innerHTML = `<span class="spinner"></span>Substituindo ${Math.min(done + 1, _banRunKeys.length)} de ${_banRunKeys.length}...`;
  } else if (_banPhase === 'done') {
    const failed = Object.values(_banProgress).filter(p => p.status === 'error').length;
    btn.className   = failed ? 'btn btn-surface btn-full mt6' : 'btn btn-green btn-full mt6';
    btn.disabled    = !failed;
    btn.textContent = failed ? `↻  Tentar de novo os que falharam (${failed})` : '✓  Banners substituídos';
  } else {
    const targets = banTargets();
    const courses = new Set(targets.map(t => t.course.courseId)).size;
    btn.className   = 'btn btn-green btn-full mt6';
    btn.disabled    = !targets.length || !_banFile;
    btn.textContent = !_banFile       ? 'Escolha a nova imagem acima'
                    : !targets.length ? 'Nenhum arquivo marcado'
                    : `🖼  Substituir ${targets.length} arquivo(s) em ${courses} curso(s)`;
  }
}

function showBannerResult() {
  const el  = $('ban-result');
  const all = Object.values(_banProgress);
  const ok  = all.filter(p => p.status === 'ok').length;
  const err = all.filter(p => p.status === 'error').length;
  el.innerHTML = '';
  const line = (text, color) => {
    const d = document.createElement('div');
    d.className   = 'mat-result-line';
    d.style.color = color;
    d.textContent = text;
    el.appendChild(d);
  };

  if (ok)  line(`✓ ${ok} arquivo(s) substituído(s). Se a página ainda mostrar o banner antigo, recarregue com Ctrl+F5 — é o cache do navegador.`, '#4ade80');
  if (err) line(`✗ ${err} com erro — passe o mouse no erro para ver o detalhe.`, '#f87171');
  el.style.display = 'block';
}

async function doBannerScan() {
  if (_banPhase === 'scanning' || _banPhase === 'running') return;
  const ids = parseCourseIds($('ban-courses-input').value);
  if (!ids.length) { banStatus('✗ Informe ao menos um código de curso.', '#f87171'); return; }
  if (ids.length > BANNER_MAX_COURSES) {
    banStatus(`✗ Máximo de ${BANNER_MAX_COURSES} cursos — você informou ${ids.length}.`, '#f87171');
    return;
  }

  _banPhase    = 'scanning';
  _banScan     = null;
  _banProgress = {};
  $('ban-result').style.display = 'none';
  banStatus(`Lendo Arquivos › ${BANNER_FOLDER} de ${ids.length} curso(s)...`);
  buildBannerResults();
  banSyncUI();

  try {
    const tabId = await banCanvasTab();
    const scan  = await banExec(tabId, 'scan', { courseIds: ids, folder: BANNER_FOLDER });
    _banScan = scan.map(c => ({
      ...c,
      files: (c.files || []).filter(f => isBannerFile(f.name)).map(f => ({ ...f, checked: true })),
    }));
    _banPhase = 'idle';
    banScanSummary();
  } catch (err) {
    _banPhase = 'idle';
    banStatus('✗ ' + err.message, '#f87171');
  }
  buildBannerResults();
  banSyncUI();
}

async function doBannerReplace() {
  if (_banPhase === 'scanning' || _banPhase === 'running' || !_banFile) return;
  // Depois de uma rodada, o mesmo botão tenta de novo só os que falharam.
  const retry   = _banPhase === 'done';
  const targets = banTargets().filter(t =>
    !retry || _banProgress[banKey(t.course.courseId, t.file)]?.status === 'error');
  if (!targets.length) return;

  // Trava antes do primeiro await — senão um duplo clique sobe duas vezes.
  const prev  = { phase: _banPhase, progress: _banProgress };
  const image = _banFile;
  _banPhase    = 'running';
  _banProgress = retry ? { ..._banProgress } : {};
  _banRunKeys  = targets.map(t => banKey(t.course.courseId, t.file));
  for (const k of _banRunKeys) _banProgress[k] = { status: 'pending' };
  $('ban-result').style.display = 'none';
  banStatus('Substituindo — mantenha o painel aberto até terminar.');
  buildBannerResults();
  banSyncUI();

  // A aba fica fixa: trocar de aba no meio não muda a sessão usada.
  let tabId;
  try {
    tabId = await banCanvasTab();
  } catch (err) {
    _banPhase    = prev.phase;
    _banProgress = prev.progress;
    banStatus('✗ ' + err.message, '#f87171');
    buildBannerResults();
    banSyncUI();
    return;
  }

  for (const { course, file } of targets) {
    const key = banKey(course.courseId, file);
    const set = (status, detail) => {
      _banProgress[key] = { status, detail };
      buildBannerResults();
      banSyncUI();
    };
    try {
      set('uploading');
      const ticket = await banExec(tabId, 'ticket', {
        courseId:    course.courseId,
        folderId:    course.folderId,
        name:        file.name,
        size:        image.size,
        contentType: image.type || 'application/octet-stream',
      });
      // No formulário o binário também vai com o nome antigo, como na AVA.
      await matUploadBinary(ticket, new File([image], file.name, { type: image.type }));
      set('ok');
    } catch (err) {
      set('error', err.message);
    }
  }

  _banPhase = 'done';
  banStatus('');
  buildBannerResults();
  banSyncUI();
  showBannerResult();
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
    video_width:    saved.video_width    || 700,
    video_height:   saved.video_height   || 442,
    openrouter_key: saved.openrouter_key || '',
    uploading:      saved.uploading      || false,
    uploadResult:  saved.uploadResult  || null,
    savedLinks:    saved.savedLinks    || [],
    savedBlocks:   saved.savedBlocks   || [],
    sheetsEnabled:      saved.sheetsEnabled      || false,
    canvasExceptions:   saved.canvasExceptions   ?? DEFAULT_CANVAS_EXCEPTIONS,
    canvasNoVideo:      saved.canvasNoVideo      ?? DEFAULT_CANVAS_NO_VIDEO,
    courseTypeEnabled:   saved.courseTypeEnabled   ?? true,
    canvasFlowTemplates: saved.canvasFlowTemplates ?? DEFAULT_CANVAS_FLOW_TEMPLATES,
    equationShortcutEnabled: saved.equationShortcutEnabled || false,
    equationPasteEnabled:    saved.equationPasteEnabled    || false,
    h5pMarksEnabled:         saved.h5pMarksEnabled         ?? true,
    h5pFolderEnabled:        saved.h5pFolderEnabled        || false,
    h5pFolderTeam:           saved.h5pFolderTeam           || false,
    findTextEnabled:         saved.findTextEnabled         || false,
    cscEnabled:              saved.cscEnabled              || false,
    cscAcervoCaminhos:       saved.cscAcervoCaminhos       ?? __svcCsc.CAMINHOS_ACERVO_PADRAO,
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
  syncCscButton();
  $('btn-csc').addEventListener('click', () => { show('csc'); CscPanel.abrir(); });
  $('btn-back-csc').addEventListener('click', () => show('main'));
  $('btn-back-help').addEventListener('click',  () => show('main'));
  $('btn-starters').addEventListener('click', doOpenStarters);
  $('btn-links').addEventListener('click', () => { buildLinks(); show('links'); });
  $('btn-back-links').addEventListener('click', () => show('settings'));
  $('btn-all-records').addEventListener('click', () => { buildAllRecords(); show('records'); });
  $('btn-back-records').addEventListener('click', () => show('main'));
  $('btn-canvas-indent').addEventListener('click', doApplyIndent);
  $('btn-canvas-map').addEventListener('click', doElementMap);
  $('btn-canvas-blocks').addEventListener('click', () => { buildBlocks(); show('blocks'); });
  $('btn-back-blocks').addEventListener('click', () => show('canvas'));
  $('btn-canvas-revisions').addEventListener('click', () => show('canvas-revisions'));

  // ── Edição em escala ──────────────────────────────────────────────
  $('btn-canvas-bulk').addEventListener('click', async () => {
    show('canvas-bulk');
    const input = $('bulk-courses-input');
    if (!input.value.trim()) {
      const id = await getCanvasCourseId();
      if (id) input.value = id;
    }
  });
  $('btn-back-canvas-bulk').addEventListener('click', () => show('canvas'));

  $('btn-bulk-use-tab').addEventListener('click', async () => {
    const id = await getCanvasCourseId();
    if (!id) { bulkStatus('✗ Nenhum curso Canvas detectado na aba ativa.', '#f87171'); return; }
    const input    = $('bulk-courses-input');
    const existing = parseCourseIds(input.value);
    if (existing.includes(id)) return;
    if (existing.length >= BULK_MAX_COURSES) {
      bulkStatus(`✗ Limite de ${BULK_MAX_COURSES} cursos atingido.`, '#f87171');
      return;
    }
    input.value = (input.value.trim() ? input.value.trim() + '\n' : '') + id;
  });

  $('btn-bulk-list').addEventListener('click', doBulkListPages);
  $('bulk-page-filter').addEventListener('input', buildBulkPages);
  $('btn-bulk-preview').addEventListener('click', doBulkPreview);
  $('btn-bulk-apply').addEventListener('click', () => {
    doBulkApply().catch(err => bulkStatus('✗ ' + err.message, '#f87171'));
  });

  // Qualquer mudança nos parâmetros invalida a prévia — sem isso daria para
  // clicar em "Aplicar" com a tela mostrando um resultado que não corresponde
  // mais ao que está nos campos.
  const invalidateBulk = () => {
    _bulkGen++;
    if (_bulkPreview) {
      _bulkPreview = null;
      $('btn-bulk-apply').style.display = 'none';
      $('bulk-results').innerHTML = '';
    }
    // Trocar o primeiro código deixa a lista de páginas exibida obsoleta:
    // ela veio de outro curso. Zera tudo e pede uma nova listagem.
    const first = bulkCourseIds()[0] || null;
    if (_bulkListedIn && first !== _bulkListedIn) {
      bulkReset();
      bulkStatus('Curso alterado — liste as páginas novamente.', '#f97316');
    }
  };
  $('bulk-find').addEventListener('input', invalidateBulk);
  $('bulk-end').addEventListener('input', invalidateBulk);
  $('bulk-repl').addEventListener('input', invalidateBulk);
  $('bulk-toggle-case').addEventListener('change', invalidateBulk);
  $('bulk-toggle-first').addEventListener('change', invalidateBulk);
  $('bulk-toggle-inclusive').addEventListener('change', invalidateBulk);
  $('bulk-courses-input').addEventListener('input', invalidateBulk);
  $('bulk-mode').addEventListener('change', () => { bulkSyncMode(); invalidateBulk(); });

  // ── Capa de vídeo (o editor abre numa janela; o texto se digita lá) ──
  $('btn-canvas-thumb').addEventListener('click', () => chrome.windows.create({
    url: chrome.runtime.getURL('thumb.html'), type: 'popup', width: 1280, height: 800,
  }));

  // ── Vídeos em lote ────────────────────────────────────────────────
  $('btn-canvas-videos').addEventListener('click', openVideos);
  $('btn-back-canvas-videos').addEventListener('click', () => show('canvas'));
  $('btn-vid-modules').addEventListener('click', doVidLoadModules);
  $('btn-vid-toggle-all').addEventListener('click', vidToggleAll);
  $('btn-vid-preview').addEventListener('click', doVidPreview);
  $('btn-vid-apply').addEventListener('click', () => {
    doVidApply().catch(err => { _vidBusy = false; vidSyncUI(); vidStatus('✗ ' + err.message, '#f87171'); });
  });

  // ── Vídeos do Studio ──────────────────────────────────────────────
  $('btn-canvas-studio').addEventListener('click', openStudio);
  $('btn-back-canvas-studio').addEventListener('click', () => show('canvas'));
  $('btn-stu-read').addEventListener('click', doStuRead);
  $('btn-stu-example').addEventListener('click', () => chrome.downloads.download({
    url: chrome.runtime.getURL('modelos/planilha-videos-studio.xlsx'),
    filename: 'Modelo - vídeos do Studio.xlsx',
  }).catch(err => stuStatus('✗ Não consegui baixar o exemplo: ' + err.message, '#f87171')));
  $('btn-stu-file').addEventListener('click', () => $('stu-file').click());
  $('stu-file').addEventListener('change', stuOnFile);
  $('stu-sheet').addEventListener('input', stuParseSheet);
  $('btn-stu-modules').addEventListener('click', doStuLoadModules);
  $('btn-stu-toggle-all').addEventListener('click', stuToggleAll);
  $('btn-stu-preview').addEventListener('click', doStuPreview);
  $('btn-stu-apply').addEventListener('click', () => {
    doStuApply().catch(err => { _stuBusy = false; stuSyncUI(); stuStatus('✗ ' + err.message, '#f87171'); });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of Object.keys(changes)) {
      if (key.startsWith('studioVideos:')) stuOnStudio(key.slice('studioVideos:'.length), changes[key].newValue);
    }
  });

  // ── Materiais complementares ──────────────────────────────────────
  $('btn-canvas-materiais').addEventListener('click', openMaterials);
  $('btn-back-canvas-materiais').addEventListener('click', () => show('canvas'));
  $('btn-mat-modules').addEventListener('click', doMatLoadModules);
  $('mat-module').addEventListener('change', () => {
    if (_matPhase === 'done') matNewBatch();
    matSyncUI();
  });
  $('btn-mat-add-files').addEventListener('click', () => {
    if (_matPhase === 'done') matNewBatch();
    $('mat-file-input').click();
  });
  $('mat-file-input').addEventListener('change', matAddFiles);
  // Depois de importar, o mesmo botão tenta de novo só os que falharam.
  $('btn-mat-import').addEventListener('click', () => {
    if (_matPhase === 'done') matNewBatch();
    doMatImport();
  });

  // ── Analisar disciplina ───────────────────────────────────────────
  $('btn-canvas-analise').addEventListener('click', openAnalise);
  $('btn-back-canvas-analise').addEventListener('click', () => show('canvas'));
  $('btn-an-tarefas').addEventListener('click', doAnaliseTarefas);
  $('btn-an-boletim').addEventListener('click', doAnaliseBoletim);
  $('btn-an-diario').addEventListener('click', doAnaliseDiario);

  // ── Trocar banner ─────────────────────────────────────────────────
  $('btn-canvas-banner').addEventListener('click', openBanner);
  $('btn-back-canvas-banner').addEventListener('click', () => show('canvas'));
  $('btn-ban-pick').addEventListener('click', () => $('ban-file-input').click());
  $('ban-file-input').addEventListener('change', banPickImage);
  $('btn-ban-use-tab').addEventListener('click', async () => {
    const id = await getCanvasCourseId();
    if (!id) { banStatus('✗ Nenhum curso Canvas detectado na aba ativa.', '#f87171'); return; }
    const input    = $('ban-courses-input');
    const existing = parseCourseIds(input.value);
    if (existing.includes(id)) return;
    if (existing.length >= BANNER_MAX_COURSES) {
      banStatus(`✗ Limite de ${BANNER_MAX_COURSES} cursos atingido.`, '#f87171');
      return;
    }
    input.value = (input.value.trim() ? input.value.trim() + '\n' : '') + id;
    banInvalidate();  // valor trocado por código não dispara o evento "input"
  });
  $('ban-courses-input').addEventListener('input', banInvalidate);
  $('btn-ban-scan').addEventListener('click', doBannerScan);
  $('btn-ban-apply').addEventListener('click', doBannerReplace);

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
