// Regressão do "Redimensionar vídeos da página": injeta o videoResizeMain real
// (com o editor-access.js e o video-size.js, como o background faz) em
// textarea, CodeMirror 6 e TinyMCE 6 e confere o HTML resultante.
// Rodar com o playwright-core instalado numa pasta qualquer (ex.: o scratchpad):
//   NODE_PATH=<pasta>/node_modules node .claude/skills/h5p-quiz/scripts/test-video.js
// Usa o Chrome do sistema (CHROME_PATH) e CDNs (cdnjs, esm.sh) — precisa de rede.
const { chromium } = require('playwright-core');
const vm   = require('vm');
const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '../../../..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// videoResizeMain do background.js real (chrome.* vira no-op).
const noop = new Proxy(function () {}, { get: (t, p) => (p === 'then' ? undefined : noop), apply: () => noop });
const ctx  = { chrome: noop, self: noop, fetch: noop, console, URL, Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval, importScripts: () => {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
if (typeof ctx.videoResizeMain !== 'function') throw new Error('videoResizeMain não encontrada no background.js');
const MAIN   = ctx.videoResizeMain.toString();
const ACCESS = fs.readFileSync(path.join(ROOT, 'editor-access.js'), 'utf8');
const RULE   = fs.readFileSync(path.join(ROOT, 'video-size.js'), 'utf8');
const W = 620, H = 398;

// ── Casos da regra: [nome, entrada, saída esperada (null = não muda)] ──
const CASES = [
  ['Studio (exemplo real da página)',
    '<iframe class="lti-embed" style="width: 700px; height: 442px; display: inline-block;" title="06 - Compliance de Fachada" src="https://pucminas.instructure.com/courses/282082/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fpucminas.instructuremedia.com%2Flti%2Flaunch%3Fcustom_arc_media_id%3Ddbbe4aaf" width="720" height="405" loading="lazy" allowfullscreen="allowfullscreen" data-studio-resizable="true" data-studio-tray-enabled="true"></iframe>',
    '<iframe class="lti-embed" style="width: 620px; height: 398px; display: inline-block;" title="06 - Compliance de Fachada" src="https://pucminas.instructure.com/courses/282082/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fpucminas.instructuremedia.com%2Flti%2Flaunch%3Fcustom_arc_media_id%3Ddbbe4aaf" width="620" height="398" loading="lazy" allowfullscreen="allowfullscreen" data-studio-resizable="true" data-studio-tray-enabled="true"></iframe>'],
  ['Genially responsivo (exemplo real) — não é vídeo',
    '<iframe style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" title="Genially sem título" src="https://view.genially.com/6ab6cfd7298a7235587bd19a" width="1030" height="675" loading="lazy" allowfullscreen="allowfullscreen" frameborder="0" scrolling="yes"></iframe>',
    null],
  ['Quiz H5P (LTI) — não é vídeo',
    '<iframe class="lti-embed" style="width: 100%; height: 600px;" title="" src="https://pucminas.instructure.com/courses/282082/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fpucminasvirtual.h5p.com%2Fcontent%2F1292990192653300058" width="779" height="600" allowfullscreen="allowfullscreen"></iframe>',
    null],
  ['H5P direto com allowfullscreen — não é vídeo',
    '<iframe src="https://pucminas.h5p.com/content/123/embed" width="1088" height="637" frameborder="0" allowfullscreen="allowfullscreen"></iframe>',
    null],
  ['Genially fixo (sem style) — não é vídeo',
    '<iframe src="https://view.genially.com/abc" width="800" height="450" allowfullscreen="allowfullscreen"></iframe>',
    null],
  ['YouTube colado',
    '<iframe width="560" height="315" src="https://www.youtube.com/embed/abc" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; picture-in-picture" allowfullscreen></iframe>',
    '<iframe width="620" height="398" src="https://www.youtube.com/embed/abc" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; picture-in-picture" allowfullscreen></iframe>'],
  ['YouTube sem allowfullscreen (só allow)',
    '<iframe width="560" height="315" src="https://www.youtube-nocookie.com/embed/abc" allow="fullscreen"></iframe>',
    '<iframe width="620" height="398" src="https://www.youtube-nocookie.com/embed/abc" allow="fullscreen"></iframe>'],
  ['Vimeo com aspas simples e sem aspas',
    "<iframe src='https://player.vimeo.com/video/1' width=640 height='360' allowfullscreen></iframe>",
    "<iframe src='https://player.vimeo.com/video/1' width=\"620\" height=\"398\" allowfullscreen></iframe>"],
  ['Mídia enviada ao Canvas (só style)',
    '<iframe style="width: 320px; height: 240px; display: inline-block;" title="v" data-media-type="video" src="/media_attachments_iframe/1?type=video" allowfullscreen="allowfullscreen" data-media-id="1"></iframe>',
    '<iframe style="width: 620px; height: 398px; display: inline-block;" title="v" data-media-type="video" src="/media_attachments_iframe/1?type=video" allowfullscreen="allowfullscreen" data-media-id="1"></iframe>'],
  ['YouTube responsivo (width="100%") fica',
    '<iframe width="100%" height="315" src="https://www.youtube.com/embed/r" allowfullscreen></iframe>',
    null],
  ['data-width, min-width e line-height não são confundidos',
    '<iframe data-width="300" style="min-width: 200px; width: 560px; line-height: 20px; height: 315px" src="https://www.youtube.com/embed/x" allowfullscreen></iframe>',
    '<iframe data-width="300" style="min-width: 200px; width: 620px; line-height: 20px; height: 398px" src="https://www.youtube.com/embed/x" allowfullscreen></iframe>'],
  ['Formulário do Google — não é vídeo',
    '<iframe src="https://docs.google.com/forms/d/e/x/viewform?embedded=true" width="640" height="800" frameborder="0"></iframe>',
    null],
];
const VIDEOS = CASES.filter(c => c[2]).length;   // 6 vídeos que mudam

const join   = parts => parts.map(p => `<p style="text-align: center;">${p}</p>`).join('\n');
const BEFORE = '<div id="conteudo" class="content-box">\n<!-- <iframe src="https://www.youtube.com/embed/comentario" width="1" height="1"></iframe> -->\n' + join(CASES.map(c => c[1])) + '\n</div>';
const AFTER  = '<div id="conteudo" class="content-box">\n<!-- <iframe src="https://www.youtube.com/embed/comentario" width="1" height="1"></iframe> -->\n' + join(CASES.map(c => c[2] ?? c[1])) + '\n</div>';

let failures = 0;
function check(cond, msg) {
  console.log((cond ? '  ✔ ' : '  ✘ ') + msg);
  if (!cond) failures++;
}
function diff(out, exp) {
  const a = out.split('\n'), b = exp.split('\n');
  a.forEach((l, i) => { if (l !== b[i]) console.log('     obtido  :', l, '\n     esperado:', b[i]); });
}

const run   = async page => {
  await page.addScriptTag({ content: ACCESS });
  await page.addScriptTag({ content: RULE });
  return page.evaluate(`(${MAIN})(${W}, ${H})`);
};
const toast = page => page.evaluate(() => document.getElementById('__svc-toast__')?.textContent || '');

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const newPage = async () => {
    const p = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    p.on('pageerror', e => { console.log('[pageerror]', e.message); failures++; });
    return p;
  };

  // ── A página do relato: Genially + Studio + quiz H5P → 1 vídeo ──────
  console.log('Página real (Genially, Studio e quiz H5P)');
  {
    const page = await newPage();
    const html = join([CASES[1][1], CASES[0][1], CASES[2][1]]);
    await page.setContent('<textarea style="width:900px;height:300px"></textarea>');
    await page.evaluate(([h]) => { document.querySelector('textarea').value = h; }, [html]);
    await run(page);
    check(await page.inputValue('textarea') === join([CASES[1][1], CASES[0][2], CASES[2][1]]), 'só o Studio muda');
    check(await toast(page) === '✓ 1 vídeo redimensionado para 620×398.', 'aviso: ' + await toast(page));
    await page.close();
  }

  // ── Editor HTML como <textarea> ─────────────────────────────────────
  console.log('Editor HTML (textarea)');
  {
    const page = await newPage();
    await page.setContent('<textarea id="ta" style="width:900px;height:300px"></textarea><textarea id="oculta" style="display:none"></textarea>');
    await page.evaluate(([html]) => {
      document.getElementById('ta').value = html;
      document.getElementById('oculta').value = html;
      window.__events = [];
      ['input', 'change'].forEach(t => document.getElementById('ta').addEventListener(t, () => window.__events.push(t)));
    }, [BEFORE]);
    await run(page);
    const out = await page.inputValue('#ta');
    check(out === AFTER, 'só os vídeos mudam, byte a byte');
    if (out !== AFTER) diff(out, AFTER);
    check(await page.inputValue('#oculta') === BEFORE, 'textarea oculta (a que fica atrás do editor visual) não é tocada');
    check((await page.evaluate(() => window.__events)).join(',') === 'input,change', 'dispara input e change');
    check(await toast(page) === `✓ ${VIDEOS} vídeos redimensionados para 620×398.`, 'aviso: ' + await toast(page));
    await run(page);
    check(await toast(page) === `✓ Os ${VIDEOS} vídeos já estão em 620×398.`, 'segunda vez: ' + await toast(page));
    await page.close();
  }

  // ── CodeMirror 6 ────────────────────────────────────────────────────
  console.log('Editor HTML (CodeMirror 6)');
  {
    const page = await newPage();
    await page.setContent('<div id="host" style="width:900px"></div>');
    await page.evaluate(([html]) => { window.__doc = html; }, [BEFORE]);
    await page.addScriptTag({ type: 'module', content: `
      import { EditorView, basicSetup } from 'https://esm.sh/codemirror@6.0.1';
      window.__view = new EditorView({ doc: window.__doc, parent: document.getElementById('host'), extensions: [basicSetup] });
    ` });
    await page.waitForFunction(() => window.__view, null, { timeout: 30000 });
    await run(page);
    check(await page.evaluate(() => window.__view.state.doc.toString()) === AFTER, 'documento do CodeMirror ajustado');
    await page.click('.cm-content');
    await page.keyboard.press('Control+z');
    check(await page.evaluate(() => window.__view.state.doc.toString()) === BEFORE, 'um Ctrl+Z desfaz tudo');
    await page.close();
  }

  // ── Editor visual (TinyMCE 6, com a textarea escondida atrás, como no Canvas) ──
  console.log('Editor visual (TinyMCE 6.8.3)');
  {
    const page = await newPage();
    await page.setContent('<!DOCTYPE html><textarea id="rce"></textarea>');
    await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/tinymce/6.8.3/tinymce.min.js' });
    await page.evaluate(([html]) => new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('TinyMCE não iniciou em 20s')), 20000);
      tinymce.init({
        selector: '#rce', plugins: 'media', height: 500, license_key: 'gpl', promotion: false,
        extended_valid_elements: 'iframe[*]',
        init_instance_callback: ed => { ed.setContent(html); ed.undoManager.clear(); ed.undoManager.add(); ed.setDirty(false); resolve(); },
      });
    }), [BEFORE]);
    const before = await page.evaluate(() => tinymce.activeEditor.getContent());
    await run(page);
    const res = await page.evaluate(() => {
      const ed  = tinymce.activeEditor;
      const doc = new DOMParser().parseFromString(ed.getContent(), 'text/html');
      return {
        dirty: ed.isDirty(),
        frames: [...doc.querySelectorAll('iframe')].map(f => ({ w: f.getAttribute('width'), h: f.getAttribute('height'), sw: f.style.width, sh: f.style.height })),
      };
    });
    const f = res.frames;
    check(f.length === CASES.length, `${f.length} iframes depois de salvar`);
    check(f[0].w === '620' && f[0].h === '398' && f[0].sw === '620px' && f[0].sh === '398px', 'Studio em 620×398 — ' + JSON.stringify(f[0]));
    check(f[1].w === '1030' && f[1].sw === '100%', 'Genially intacto — ' + JSON.stringify(f[1]));
    check(f[2].w === '779' && f[2].sw === '100%', 'quiz H5P intacto — ' + JSON.stringify(f[2]));
    check(f[3].w === '1088', 'H5P direto intacto — ' + JSON.stringify(f[3]));
    check(f[5].w === '620' && f[5].h === '398', 'YouTube em 620×398 — ' + JSON.stringify(f[5]));
    check(f[8].sw === '620px' && f[8].sh === '398px', 'mídia do Canvas em 620×398 — ' + JSON.stringify(f[8]));
    check(res.dirty, 'editor marcado como alterado (o Canvas avisa se sair sem salvar)');
    check(await toast(page) === `✓ ${VIDEOS} vídeos redimensionados para 620×398.`, 'aviso: ' + await toast(page));
    await page.evaluate(() => tinymce.activeEditor.undoManager.undo());
    check(await page.evaluate(() => tinymce.activeEditor.getContent()) === before, 'um Ctrl+Z volta ao conteúdo anterior');
    await page.close();
  }

  // ── Sem editor / sem vídeo ──────────────────────────────────────────
  console.log('Sem editor aberto');
  {
    const page = await newPage();
    await page.setContent('<p>Página em modo de leitura</p><textarea style="display:none"></textarea>');
    await run(page);
    check(await toast(page) === '⚠ Abra a página no editor do Canvas antes de redimensionar os vídeos.', 'aviso: ' + await toast(page));
    await page.close();
  }
  console.log('Editor só com Genially e H5P');
  {
    const page = await newPage();
    await page.setContent('<textarea style="width:600px;height:200px"></textarea>');
    const html = CASES[1][1] + CASES[2][1] + CASES[3][1];
    await page.evaluate(([h]) => { document.querySelector('textarea').value = h; }, [html]);
    await run(page);
    check(await page.inputValue('textarea') === html, 'nada muda');
    check(await toast(page) === '⚠ Nenhum vídeo encontrado no editor.', 'aviso: ' + await toast(page));
    await page.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FALHA(S)` : '\nTUDO OK');
  process.exit(failures ? 1 : 0);
})();
