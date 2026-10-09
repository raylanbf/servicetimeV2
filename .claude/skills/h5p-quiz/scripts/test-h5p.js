// Regressão da regra "Redimensionar H5P" (largura 100%): injeta o h5pResizeMain
// real em textarea, CodeMirror 6/5 e TinyMCE 5/6/7 e confere o HTML resultante.
// Rodar com o playwright-core instalado numa pasta qualquer (ex.: o scratchpad):
//   NODE_PATH=<pasta>/node_modules node .claude/skills/h5p-quiz/scripts/test-h5p.js
// Usa o Chrome do sistema (CHROME_PATH) e CDNs (cdnjs, esm.sh) — precisa de rede.
const { chromium } = require('playwright-core');
const path = require('path');
const SRC  = require('./extract-h5p');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT    = process.env.OUT_DIR || require('os').tmpdir();

// [nome, entrada, saída esperada (null = não muda)]
const CASES = [
  ['H5P via LTI (Interactive Content – H5P)',
    '<iframe class="lti-embed" style="width: 700px; height: 400px;" title="Atividade de Fixação" src="https://pucminas.instructure.com/courses/282082/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fpucminas.h5p.com%2Fcontent%2F1292345678901234567&amp;resource_link_lookup_uuid=0f1e2d3c" width="700" height="400" allowfullscreen="allowfullscreen" allow="geolocation *; microphone *" data-lti-launch="true"></iframe>',
    '<iframe class="lti-embed" style="width: 100%; height: 400px;" title="Atividade de Fixação" src="https://pucminas.instructure.com/courses/282082/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fpucminas.h5p.com%2Fcontent%2F1292345678901234567&amp;resource_link_lookup_uuid=0f1e2d3c" width="100%" height="400" allowfullscreen="allowfullscreen" allow="geolocation *; microphone *" data-lti-launch="true"></iframe>'],
  ['Vídeo do Studio (lti-embed, não é H5P)',
    '<iframe class="lti-embed" style="width: 720px; height: 405px;" title="Videoaula" src="https://pucminas.instructure.com/courses/282082/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fpucminas.instructuremedia.com%2Flti%2Flaunch%3Fcustom_arc_media_id%3Dabc" width="720" height="405" allowfullscreen="allowfullscreen"></iframe>',
    null],
  ['YouTube',
    '<iframe width="560" height="315" src="https://www.youtube.com/embed/xyz" allowfullscreen="allowfullscreen"></iframe>',
    null],
  ['H5P embed direto, sem style',
    '<iframe src="https://pucminas.h5p.com/content/123/embed" width="1088" height="637" frameborder="0" allowfullscreen="allowfullscreen"></iframe>',
    '<iframe src="https://pucminas.h5p.com/content/123/embed" width="100%" height="637" frameborder="0" allowfullscreen="allowfullscreen" style="width: 100%;"></iframe>'],
  ['H5P com max-width (fica)',
    '<iframe src="https://x.h5p.com/content/9" style="max-width: 700px; width: 700px; height: 500px"></iframe>',
    '<iframe src="https://x.h5p.com/content/9" style="max-width: 700px; width: 100%; height: 500px"></iframe>'],
  ['H5P já em 100%',
    '<iframe src="https://x.h5p.com/content/10" style="width: 100%; height: 400px;" width="100%"></iframe>',
    null],
  ['Maiúsculas, aspas simples, width sem aspas',
    "<IFRAME SRC='https://h5p.org/h5p/embed/617' STYLE='height:300px' WIDTH=700></IFRAME>",
    "<IFRAME SRC='https://h5p.org/h5p/embed/617' style='height:300px; width: 100%;' width=\"100%\"></IFRAME>"],
  ['">" dentro do título',
    '<iframe title="Quiz > Parte 1" src="https://x.h5p.com/content/11" width="700"></iframe>',
    '<iframe title="Quiz > Parte 1" src="https://x.h5p.com/content/11" width="100%" style="width: 100%;"></iframe>'],
];

const join   = parts => parts.map(p => `<p style="text-align: center;">${p}</p>`).join('\n');
const BEFORE = '<div id="conteudo" class="content-box"><h4>Atividade</h4>\n' + join(CASES.map(c => c[1])) + '\n</div>';
const AFTER  = '<div id="conteudo" class="content-box"><h4>Atividade</h4>\n' + join(CASES.map(c => c[2] ?? c[1])) + '\n</div>';

let failures = 0;
function check(cond, msg) {
  console.log((cond ? '  ✔ ' : '  ✘ ') + msg);
  if (!cond) failures++;
}

const run   = page => page.evaluate(`(${SRC})()`);
const toast = page => page.evaluate(() => document.getElementById('__svc-toast__')?.textContent || '');

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const newPage = async () => {
    const p = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    p.on('pageerror', e => { console.log('[pageerror]', e.message); failures++; });
    return p;
  };

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
    check(out === AFTER, 'só os iframes do H5P mudam, byte a byte');
    if (out !== AFTER) {
      const a = out.split('\n'), b = AFTER.split('\n');
      a.forEach((l, i) => { if (l !== b[i]) console.log('     obtido  :', l, '\n     esperado:', b[i]); });
    }
    check(await page.inputValue('#oculta') === BEFORE, 'textarea oculta (a do TinyMCE) não é tocada');
    check((await page.evaluate(() => window.__events)).join(',') === 'input,change', 'dispara input e change');
    check(await toast(page) === '✓ 5 H5P ajustado(s) para 100% de largura.', 'aviso: ' + await toast(page));
    await run(page);
    check(await toast(page) === '✓ Os 6 H5P já estão com 100% de largura.', 'segunda vez: ' + await toast(page));
    await page.close();
  }

  // ── CodeMirror 6 (editor HTML do Canvas) ────────────────────────────
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
    check(await toast(page) === '✓ 5 H5P ajustado(s) para 100% de largura.', 'aviso: ' + await toast(page));
    await page.click('.cm-content');
    await page.keyboard.press('Control+z');
    check(await page.evaluate(() => window.__view.state.doc.toString()) === BEFORE, 'um Ctrl+Z desfaz tudo');
    await page.close();
  }

  // ── CodeMirror 5 ────────────────────────────────────────────────────
  console.log('Editor HTML (CodeMirror 5)');
  {
    const page = await newPage();
    await page.setContent('<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css"><div id="host"></div>');
    await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js' });
    await page.evaluate(([html]) => { window.__cm = CodeMirror(document.getElementById('host'), { value: html }); }, [BEFORE]);
    await run(page);
    check(await page.evaluate(() => window.__cm.getValue()) === AFTER, 'conteúdo do CodeMirror 5 ajustado');
    await page.evaluate(() => window.__cm.undo());
    check(await page.evaluate(() => window.__cm.getValue()) === BEFORE, 'undo desfaz numa operação só');
    await page.close();
  }

  // ── Editor visual (TinyMCE com plugin media, como no Canvas) ────────
  for (const ver of ['5.10.9', '6.8.3', '7.6.0']) {
    console.log(`Editor visual (TinyMCE ${ver})`);
    const page = await newPage();
    await page.setContent('<!DOCTYPE html><textarea id="rce"></textarea>');
    await page.addScriptTag({ url: `https://cdnjs.cloudflare.com/ajax/libs/tinymce/${ver}/tinymce.min.js` });
    await page.evaluate(([html]) => new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('TinyMCE não iniciou em 20s')), 20000);
      tinymce.init({
        selector: '#rce', plugins: 'media', height: 500, license_key: 'gpl', promotion: false,
        extended_valid_elements: 'iframe[*]',
        init_instance_callback: ed => { ed.setContent(html); ed.undoManager.clear(); ed.setDirty(false); resolve(); },
      });
    }), [BEFORE]);
    const previews = await page.evaluate(() => tinymce.activeEditor.getBody().querySelectorAll('.mce-preview-object').length);
    check(previews === CASES.length, `iframes viram preview objects do plugin media (${previews})`);
    const before = await page.evaluate(() => tinymce.activeEditor.getContent());

    await run(page);
    const res = await page.evaluate(() => {
      const ed  = tinymce.activeEditor;
      const doc = new DOMParser().parseFromString(ed.getContent(), 'text/html');
      return {
        dirty: ed.isDirty(),
        frames: [...doc.querySelectorAll('iframe')].map(f => ({
          src: f.getAttribute('src'), width: f.getAttribute('width'), height: f.getAttribute('height'),
          sw: f.style.width, sh: f.style.height, smax: f.style.maxWidth,
        })),
      };
    });
    const f = res.frames;
    check(f.length === CASES.length, `${f.length} iframes depois de salvar`);
    check(f[0].sw === '100%' && f[0].width === '100%' && f[0].sh === '400px' && f[0].height === '400', 'H5P LTI: 100% de largura, altura mantida — ' + JSON.stringify(f[0]));
    check(f[1].sw === '720px' && f[1].width === '720', 'Studio intacto — ' + JSON.stringify(f[1]));
    check(f[2].width === '560' && !f[2].sw, 'YouTube intacto — ' + JSON.stringify(f[2]));
    check(f[3].sw === '100%' && f[3].width === '100%' && f[3].height === '637', 'H5P embed direto — ' + JSON.stringify(f[3]));
    check(f[4].sw === '100%' && f[4].smax === '700px' && f[4].sh === '500px', 'H5P com max-width — ' + JSON.stringify(f[4]));
    check(f[5].sw === '100%' && f[5].width === '100%', 'H5P já em 100% — ' + JSON.stringify(f[5]));
    check(res.dirty, 'editor marcado como alterado (o Canvas avisa se sair sem salvar)');
    check(await toast(page) === '✓ 5 H5P ajustado(s) para 100% de largura.', 'aviso: ' + await toast(page));
    await page.screenshot({ path: path.join(OUT, `h5p-tinymce-${ver}.png`) });

    await page.evaluate(() => tinymce.activeEditor.undoManager.undo());
    check(await page.evaluate(() => tinymce.activeEditor.getContent()) === before, 'um Ctrl+Z volta ao conteúdo anterior (pilha vazia antes)');

    // Como no Canvas: estado inicial na pilha + uma edição do usuário.
    const before2 = await page.evaluate(() => {
      const ed = tinymce.activeEditor;
      ed.undoManager.clear();
      ed.undoManager.add();
      ed.insertContent('<p>Texto digitado depois</p>');
      return ed.getContent();
    });
    await run(page);
    const after2 = await page.evaluate(() => tinymce.activeEditor.getContent());
    check(after2 !== before2 && after2.includes('Texto digitado depois'), 'ajusta mantendo a edição do usuário');
    await page.evaluate(() => tinymce.activeEditor.undoManager.undo());
    check(await page.evaluate(() => tinymce.activeEditor.getContent()) === before2, 'um único Ctrl+Z desfaz só o ajuste (pilha com histórico)');
    await page.evaluate(() => tinymce.activeEditor.undoManager.redo());
    check(await page.evaluate(() => tinymce.activeEditor.getContent()) === after2, 'Ctrl+Y refaz o ajuste');
    await page.close();
  }

  // ── Sem editor ──────────────────────────────────────────────────────
  console.log('Sem editor aberto');
  {
    const page = await newPage();
    await page.setContent('<p>Página em modo de leitura</p>');
    await run(page);
    check(await toast(page) === '⚠ Abra a página no editor do Canvas antes de redimensionar o H5P.', 'aviso: ' + await toast(page));
    await page.close();
  }

  console.log('Editor sem H5P');
  {
    const page = await newPage();
    await page.setContent('<textarea style="width:600px;height:200px"></textarea>');
    await page.evaluate(([html]) => { document.querySelector('textarea').value = html; }, [CASES[1][1] + CASES[2][1]]);
    await run(page);
    check(await toast(page) === '⚠ Nenhum H5P encontrado no editor.', 'aviso: ' + await toast(page));
    await page.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FALHA(S)` : '\nTUDO OK');
  process.exit(failures ? 1 : 0);
})();
