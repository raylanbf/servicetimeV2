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

  $('record-detail-body').innerHTML = html;
  $('record-detail-body').querySelectorAll('.detail-link-clickable').forEach(el => {
    el.addEventListener('click', () => chrome.tabs.create({ url: el.dataset.url }));
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
  const url = tabs[0].url;

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
    accMs:         entry.accMs,
    currentRecord: { ...entry.record, pausas, foiSuspenso: true },
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

  $('btn-save-settings').onclick = async () => {
    const name = $('settings-name').value.trim();
    if (!name) return;
    const w          = parseInt($('settings-video-w').value, 10) || 620;
    const h          = parseInt($('settings-video-h').value, 10) || 398;
    const key        = $('settings-openrouter').value.trim();
    const exceptions = $('settings-canvas-exceptions').value
      .split('\n').map(s => s.trim()).filter(Boolean);
    await persist({
      usuario: name, webhook_url: $('settings-url').value.trim(),
      video_width: w, video_height: h, openrouter_key: key,
      canvasExceptions: exceptions,
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
  $('canvas-tools-box').style.display = courseId ? 'block' : 'none';
  if (courseId) $('canvas-course-label').textContent = `curso #${courseId}`;
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

        const csrf = document.querySelector('meta[name="csrf-token"]')
          ?.getAttribute('content') || '';

        const modules = await fetchAll(
          `/api/v1/courses/${courseId}/modules?per_page=100`
        );

        let adjusted = 0, total = 0;

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
              await fetch(
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
              adjusted++;
            }
            total++;
          }
        }
        return { adjusted, total, modules: modules.length };
      },
      args: [courseId, exceptions],
    });

    const r = results[0]?.result;
    if (r) {
      statusEl.textContent  = `✅ ${r.adjusted} item(s) ajustado(s) em ${r.modules} módulo(s) · ${r.total} total`;
      statusEl.style.color  = '#4ade80';
    }
  } catch (err) {
    statusEl.textContent = '✗ Erro: ' + err.message;
    statusEl.style.color = '#f87171';
  }

  btn.disabled   = false;
  btn.textContent = '🔧  Aplicar recuo nos módulos';
  statusEl.style.display = 'block';
}

// ── Histórico de edições Canvas ──────────────────────────────────────
async function doFetchRevisions() {
  const courseId = await getCanvasCourseId();
  if (!courseId) return;

  show('canvas-revisions');
  const statusEl = $('canvas-revisions-status');
  const listEl   = $('canvas-revisions-list');
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
            const revs = await fetchAll(`/api/v1/courses/${courseId}/pages/${page.url}/revisions?per_page=100`);
            for (const rev of revs) {
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

    statusEl.textContent = `${entries.length} edição(ões) em ${total} página(s)`;

    entries.forEach(e => {
      const d         = new Date(e.updated_at);
      const formatted = `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      const div       = document.createElement('div');
      div.className   = 'revision-item';
      div.innerHTML   =
        `<div class="revision-page">${e.page_title}${e.latest ? '<span class="revision-latest">atual</span>' : ''}</div>
         <div class="revision-editor">👤 ${e.editor}</div>
         <div class="revision-date">${formatted}</div>`;
      listEl.appendChild(div);
    });

  } catch (err) {
    statusEl.style.color = '#f87171';
    statusEl.textContent = '✗ Erro: ' + err.message;
  }
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
    suspended:     saved.suspended     || [],
    video_width:    saved.video_width    || 620,
    video_height:   saved.video_height   || 398,
    openrouter_key: saved.openrouter_key || '',
    uploading:      saved.uploading      || false,
    uploadResult:  saved.uploadResult  || null,
    savedLinks:    saved.savedLinks    || [],
    sheetsEnabled:      saved.sheetsEnabled      || false,
    canvasExceptions:   saved.canvasExceptions   ?? DEFAULT_CANVAS_EXCEPTIONS,
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
  $('btn-back-help').addEventListener('click',  () => show('main'));
  $('btn-starters').addEventListener('click', doOpenStarters);
  $('btn-links').addEventListener('click', () => { buildLinks(); show('links'); });
  $('btn-back-links').addEventListener('click', () => show('settings'));
  $('btn-all-records').addEventListener('click', () => { buildAllRecords(); show('records'); });
  $('btn-back-records').addEventListener('click', () => show('main'));
  $('btn-canvas-indent').addEventListener('click', doApplyIndent);
  $('btn-canvas-revisions').addEventListener('click', doFetchRevisions);
  $('btn-back-canvas-revisions').addEventListener('click', () => show('main'));
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

  syncMain();
  syncCanvasTools();
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
