# Protocolo de escrita segura

## Sumário
1. Por que existe
2. Visão geral do fluxo
3. As travas, uma a uma (com código)
4. Escrita no editor (nível 1)
5. Escrita fora do Canvas (nível 4)
6. O que não se faz sem pedido explícito
7. Mensagens e relatório
8. Esqueleto completo de uma funcionalidade

---

## 1. Por que existe

As disciplinas têm alunos ativos, e várias pessoas da equipe editam as mesmas páginas. Os erros que este protocolo evita aconteceram ou quase aconteceram:

- **aba trocada:** a prévia foi feita no curso A, a pessoa mudou para o curso B e clicou "Aplicar";
- **clique duplo:** o lote gravou duas vezes;
- **edição concorrente:** alguém estava com a página aberta no editor, salvou depois do lote e apagou a mudança sem perceber;
- **sanitização:** o Canvas aceitou o PUT, mas descartou o atributo que a extensão mandou, e a tela dizia "sucesso";
- **reserialização:** o `DOMParser` → `innerHTML` trocou `&ccedil;` por `ç`, reordenou atributos e quebrou o template;
- **cópia que sobrescreve:** a importação do Canvas alterou pesos de grupos de tarefas no destino.

---

## 2. Visão geral do fluxo

```
Ler (GET) ──▶ Prévia (nada gravado) ──▶ Escolha explícita ──▶ Confirmação pelo nº do curso
                                                                        │
            Relatório por item ◀── Conferir ◀── Gravar o mínimo ◀── Reler cada item
```

---

## 3. As travas, uma a uma

### 3.1 Prévia sem gravar nada

A prévia roda **a mesma regra** que a gravação vai usar, só que sem o PUT. Para cada item: o que muda (antes → depois), "já está certo" ou "fica de fora" com o motivo. O cabeçalho diz "Prévia: N páginas vão mudar. Nada foi gravado ainda."

Separe a regra (função pura: `html → { edits, status, motivo }`) da tela. A mesma função serve à prévia, à gravação e aos testes.

### 3.2 Escolha explícita

- Lista com caixas de marcar (módulos, páginas, cursos), e "marcar todos"/"desmarcar todos".
- **Em operações arriscadas a lista começa desmarcada**: a unidade é escolhida de propósito. (Pedido de uma pessoa da equipe "por segurança", e a regra ficou.)
- Sempre dá para gravar **um item só**: é assim que se testa no curso real.
- Página que aparece em dois módulos entra uma vez só.

### 3.3 Prévia vencida não grava

Qualquer mudança no que gerou a prévia a invalida: a seleção, as configurações (ex.: o tamanho dos vídeos), o curso da aba. Um **contador de geração** descarta prévias antigas que terminam de carregar depois:

```js
let _gen = 0, _previa = null;
function descartarPrevia() { _gen++; _previa = null; esconderBotaoAplicar(); }

async function fazerPrevia() {
  descartarPrevia();
  const gen = _gen;
  const linhas = await lerTudo();                // pode demorar
  if (gen !== _gen) return;                      // algo mudou no meio: descarta
  _previa = { courseId, config: { ...config }, linhas };
  mostrar(linhas);
}

// No aplicar:
if (!_previa) return status('Rode a prévia antes de aplicar.');
if (configMudou(_previa.config)) { descartarPrevia(); return status('As configurações mudaram depois da prévia — rode a prévia de novo.'); }
```

### 3.4 Confirmação pelo número do curso

A pessoa **digita** o número do curso. A gravação só acontece se:

1. o texto tem só algarismos;
2. é igual ao curso da **aba ativa agora** (lido no clique, não quando a janela abriu);
3. o curso da aba é o mesmo **da prévia**.

Se algo não bater, aparece um aviso e a janela continua aberta: "O número digitado (282083) não é o do curso da aba aberta. Confira a aba e o número — nada foi alterado." Esc, Cancelar e clique fora cancelam.

Por que digitar, e não só clicar "OK": o clique vira reflexo. Digitar obriga a olhar a aba, e o número não aparece na janela (ele está no endereço, `/courses/<número>`). Mostre o **nome** do curso para ajudar a conferir.

Modelo pronto: `assets/confirmar-curso.js`. O número confirmado vai junto para a função injetada (`p.confirmado`), e o `write()` recusa se ele não for o curso alvo. É uma segunda trava, caso a interface seja contornada por um bug.

**Vários cursos numa operação** (cópia para até 10 cursos, troca de banner): a prévia mostra cada curso com o **nome** lido da API ao lado do número digitado, e a confirmação lista todos. A origem de uma cópia vai em `p.somenteLeitura`.

### 3.5 Trava contra clique duplo

Ligue a trava **logo depois da confirmação, antes do primeiro `await` seguinte**. Senão, um segundo clique entra enquanto o primeiro espera e grava duas vezes.

```js
const tab = await confirmar();      // janela
if (!tab) return;
_ocupado = true;                    // ← antes de qualquer outro await
sincronizarBotoes();                // botões desabilitados
try { /* grava */ } finally { _ocupado = false; sincronizarBotoes(); }
```

### 3.6 Releitura na hora de gravar

Entre a prévia e o clique passam minutos. Para **cada** item, leia de novo logo antes de gravar e recalcule a mudança sobre o conteúdo atual:

```js
const atual = await execCanvas(tabId, 'lerPagina', { courseId, url });
const r = regra(atual.body);                        // a mesma função da prévia
if (r.erro)          { linha.status = 'error'; linha.nota = r.erro + ' (mudou desde a prévia)'; continue; }
if (!r.edits.length) { linha.status = 'zero'; linha.nota = 'Já estava certo — nada gravado.'; continue; }
const salvo = await execCanvas(tabId, 'gravarPagina', { courseId, confirmado, url, body: aplicar(atual.body, r.edits) });
```

A ordem importa: `r.erro` vem **antes** de `!r.edits.length`. Uma regra que não conseguiu localizar o alvo devolve `edits` vazio **e** `erro`; checando `edits` primeiro, o item sairia no relatório como "já estava certo", quando na verdade ficou de fora por não ser seguro mexer.

### 3.7 Aviso de edição recente

Se a página foi salva há menos de 30 minutos, alguém pode estar com ela aberta no editor. Quando essa pessoa salvar, a versão dela (sem a mudança da extensão) sobrescreve tudo. A prévia avisa:

```js
const min = atual.atualizadaEm ? (Date.now() - new Date(atual.atualizadaEm)) / 60000 : Infinity;
if (vaiMudar && min < 30) {
  linha.status = 'warn';
  linha.nota = `Editada há ${Math.max(1, Math.round(min))} min${atual.editor ? ' por ' + atual.editor : ''}. ` +
               'Se ainda estiver aberta no editor e for salva depois, a mudança se perde nela.';
}
```

### 3.8 Gravação mínima, sem reserializar

**Mande só o campo que muda.** `PUT /pages/:url` com `{ wiki_page: { body } }`, sem título nem `published`. Na criação, só os campos necessários.

**No HTML, mude só o trecho alvo, por fatia de texto.** Nunca faça `DOMParser` → mexe → `body.innerHTML`. A reserialização troca entidades (`&ccedil;` → `ç`), aspas, ordem e formato de atributos, fecha tags, mexe em espaços e, nos templates, estraga o que dependia disso. O padrão que funcionou:

1. Use o `DOMParser` **só para entender** (achar o alvo, contar, validar).
2. Localize o alvo no **texto original** (por exemplo, a k-ésima `<div>` do texto é a k-ésima do DOM, conferindo `id`, `class` e `style`).
3. Monte `edits = [{ from, to, insert }]` e aplique do fim para o começo:

   ```js
   const aplicar = (texto, edits) =>
     [...edits].sort((a, b) => b.from - a.from)
       .reduce((s, e) => s.slice(0, e.from) + e.insert + s.slice(e.to), texto);
   ```

4. **Confira a conta** antes de gravar: o trecho do texto tem os mesmos elementos que o DOM achou (ex.: o mesmo número de `<iframe>`). Se não bater: "Não consegui localizar o alvo no HTML com segurança — nada muda nesta página."

**Texto digitado pela pessoa entra como texto:** escape `&`, `<` e `>` antes de pôr no HTML. Um `<` digitado viraria tag e mudaria a estrutura.

**Na dúvida, não mexa.** Se o lugar alvo tem conteúdo inesperado (a caixa do quiz tem texto, imagem ou tabela além do H5P), o item fica de fora com o motivo: "tem outro conteúdo além do H5P — confira à mão". Se há 0 ou 2+ candidatos para um nome, mostre os candidatos e não escolha.

### 3.9 Conferência depois de gravar

O `PUT` de página devolve o corpo como o Canvas guardou (já sanitizado). Rode a regra de novo sobre ele: se ainda houver o que mudar, o Canvas descartou algo.

```js
const restante = salvo.body === null ? 0 : regra(salvo.body).edits.length;
linha.status = restante ? 'warn' : 'ok';
if (restante) linha.nota = `O Canvas gravou a página, mas ${restante} item(ns) não ficaram como esperado. Confira no editor.`;
```

Para criações, leia a lista depois de criar e confirme que o item novo está lá. Se não estiver, diga "recebeu o pedido, mas o item não apareceu na lista — confira antes de tentar de novo" (clicar de novo poderia duplicar).

### 3.10 Idempotência

Toda operação pode ser executada de novo sem duplicar nada:

- **criar** → antes, procure pelo nome normalizado (sem diferença de maiúsculas, espaços ou tipo de traço) e, se existir, use o existente ("já existia");
- **trocar** → se o conteúdo já é o desejado, não grave ("já estava");
- **inserir** → se o item já está no lugar, nada muda.

Assim, um lote interrompido (limite de requisições, aba fechada) pode rodar de novo e continua de onde parou. O `execCanvas` do modelo só repete a injeção sozinho porque as operações são idempotentes.

### 3.11 Porta única de escrita

Dentro da função injetada, **nenhum** `fetch` de escrita fora de `write()`. Ele recusa:

| Situação | Mensagem |
|---|---|
| `p.confirmado` diferente do curso alvo | "o curso X não foi confirmado pelo número — nada foi gravado" |
| curso em `p.somenteLeitura` (a origem de uma cópia) | "o curso X é somente leitura nesta operação" |
| a aba saiu do curso (`location.pathname`) | "a aba saiu do curso X — nada foi gravado" |
| `DELETE` sem `p.permitirApagar` | "apagar não faz parte desta operação" |

Numa revisão de código, procure `method: 'PUT'|'POST'|'DELETE'` fora do `write()`: cada ocorrência é um furo.

### 3.12 Chave nas configurações para recursos arriscados

Botões que criam coisas em massa, ou em produção, **nascem desligados** numa chave das configurações (`chrome.storage.local`, padrão `false`), que vale na hora, sem recarregar. Quem não usa a função não corre o risco de clicar sem querer.

---

## 4. Escrita no editor (nível 1)

Quando a ação acontece **no editor aberto** (inserir um quiz, justificar, redimensionar vídeos):

- **Não salve a página.** Quem usa confere o resultado e clica em Salvar. Várias pessoas editam as mesmas páginas, e salvar sozinho atropelaria alguém.
- **Um passo de Ctrl+Z:** `ed.undoManager.add()` + `ed.undoManager.transact(() => …)` (ver `editor-rce.md`).
- **Pergunte antes de substituir:** "Quer importar o H5P para a página?", com o nome do que entra e, se for o caso, o aviso de que o atual será trocado. **O foco começa no "Não"**; Esc e clique fora cancelam. Valide tudo antes de perguntar, para não perguntar quando não há o que fazer.
- **Editor HTML aberto:** mexa só nele (o visual fica escondido e desatualizado), ou peça para voltar ao visual se a ação precisar dele.

---

## 5. Escrita fora do Canvas (nível 4)

- **Destino de teste separado do de produção**, escolhido numa chave das configurações, com o teste como padrão. No H5P.com: pasta privada no "My Content" (teste) × pasta da equipe (produção).
- **Onde não se pode apagar, confira três vezes antes de enviar:** que a página aberta é mesmo o destino (pelo título), que a lista dele foi lida e que o formulário aponta para lá. Se algo não bater, nada é enviado.
- **Nomes parecidos:** se já existe "UDA - Cálculo" e a pessoa vai criar "Cálculo", segure o "Criar" até ela escolher "Usar esta" ou "Criar outra mesmo assim". Não mude o nome sozinho (os prefixos variam).
- **Um passo por vez, com pausa** (1,5 s entre criações), e conferência na lista depois.

---

## 6. O que não se faz sem pedido explícito

| Ação | Por quê |
|---|---|
| Apagar qualquer coisa | sem volta; alunos podem ter entregas ligadas |
| Publicar ou despublicar | muda o que o aluno vê na hora; `PUT` de módulo com `published: true` publica todos os itens |
| Notas, matrículas, datas, configurações do curso | impacto direto no aluno e no SIS |
| Content migration / cópia de curso em curso com alunos | casa por id e nome e sobrescreve (ver `regras-do-canvas.md`) |
| `PUT` em módulo existente | pode publicar itens; muda a experiência de quem já está no módulo |
| Requisito de conclusão em módulo existente | muda o progresso de quem já concluiu |
| Gravar na pasta de produção de um sistema externo | geralmente não dá para desfazer |

Mesmo com o pedido, essas ações seguem o protocolo inteiro, e a confirmação diz claramente o que não tem volta.

---

## 7. Mensagens e relatório

- **Durante:** "Gravando página 3 de 12… mantenha o painel aberto."
- **Por item:** ✅ gravado · — já estava · ⚠ gravado, mas confira (motivo) · ✗ não gravado (motivo).
- **Resumo:** "✅ 34 vídeos gravados em 12 páginas. 3 páginas sem nada a mudar. 1 com erro."
- **Quando nada muda, diga:** "Nenhuma página foi alterada."
- **Erro:** o que estava sendo feito e o que fazer agora ("Entre no H5P.com neste Chrome e tente de novo", com o link).
- Sucesso pode sumir sozinho; aviso e erro ficam na tela até a pessoa fechar.

---

## 8. Esqueleto completo de uma funcionalidade

```js
// Painel. canvasMain, execCanvas e abaDoCurso: assets/canvas-api.js
// confirmarCurso: assets/confirmar-curso.js
let _ocupado = false, _gen = 0, _previa = null;

async function previa(selecionadas) {
  if (_ocupado) return;
  let aba;
  try { aba = await abaDoCurso(); }
  catch (e) { return status(e.message); }                      // "Abra uma aba de um curso no Canvas…"
  const { tabId, courseId } = aba;
  _gen++; _previa = null;
  const gen = _gen;
  _ocupado = true; sincronizar();
  const linhas = [];
  try {
    for (let i = 0; i < selecionadas.length; i++) {            // um por vez
      progresso(`Lendo ${i + 1} de ${selecionadas.length}…`);
      const pg = selecionadas[i];
      try {
        const atual = await execCanvas(tabId, 'lerPagina', { courseId, url: pg.url });
        linhas.push({ ...pg, ...classificar(regra(atual.body), atual) });   // inclui aviso de edição recente
      } catch (e) { linhas.push({ ...pg, status: 'error', nota: e.message }); }
    }
  } finally { _ocupado = false; progresso(''); sincronizar(); }
  if (gen !== _gen) return;                                    // prévia vencida
  _previa = { courseId, linhas };
  mostrarPrevia(linhas, 'Nada foi gravado ainda.');
}

async function aplicar() {
  if (_ocupado || !_previa) return;
  const alvo = _previa.linhas.filter(l => l.status === 'ok' || l.status === 'warn');
  if (!alvo.length) return status('Nada para gravar.');
  const confirmado = await confirmarCurso({
    titulo: `Gravar em ${alvo.length} página(s)?`,
    resumo: 'Grava direto no Canvas.',
    itens: alvo.map(l => l.titulo),
    cursoDaPrevia: _previa.courseId,
    cursoAtual: async () => (await abaDoCurso().catch(() => null))?.courseId || null,
  });
  if (!confirmado) return;
  _ocupado = true; sincronizar();                              // trava antes do próximo await
  const courseId = _previa.courseId;
  const resultado = [];
  try {
    const { tabId } = await abaDoCurso();                      // falhou → catch abaixo, nada gravado
    for (let i = 0; i < alvo.length; i++) {
      progresso(`Gravando ${i + 1} de ${alvo.length}… mantenha o painel aberto.`);
      const l = alvo[i];
      try {
        const atual = await execCanvas(tabId, 'lerPagina', { courseId, url: l.url });   // relê
        const r = regra(atual.body);
        if (r.erro) { resultado.push({ ...l, status: 'error', nota: r.erro + ' (mudou desde a prévia)' }); continue; }
        if (!r.edits.length) { resultado.push({ ...l, status: 'zero', nota: 'Já estava certo.' }); continue; }
        const salvo = await execCanvas(tabId, 'gravarPagina',
          { courseId, confirmado, url: l.url, body: aplicarEdits(atual.body, r.edits) });
        const resta = salvo.body === null ? 0 : regra(salvo.body).edits.length;              // confere
        resultado.push({ ...l, status: resta ? 'warn' : 'ok', nota: resta ? 'O Canvas não guardou tudo — confira.' : '' });
      } catch (e) { resultado.push({ ...l, status: 'error', nota: e.message }); }
    }
  } catch (e) {
    // abaDoCurso() falhou (a aba saiu do Canvas, foi fechada): nenhum item foi tocado.
    return status(`${e.message} Nada foi alterado.`);
  } finally { _ocupado = false; _previa = null; progresso(''); sincronizar(); }
  mostrarRelatorio(resultado);
}
```

Repare nos dois `catch`: o de dentro do laço registra o erro **daquele item** e segue para o próximo; o de fora pega o que impede o lote inteiro de começar (a aba do curso sumiu) e diz que nada foi alterado. Sem ele, a exceção escaparia do `finally` sem nenhuma mensagem na tela.
