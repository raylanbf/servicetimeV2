# Testes e processo

## Sumário
1. O ciclo de uma funcionalidade
2. Investigar antes de escrever
3. O plano (`PLANO-<nome>.md`)
4. Regra pura e testes rápidos
5. Simulação: Canvas falso no Chrome de verdade
6. O que todo teste de escrita precisa provar
7. Curso de teste e primeiro uso real
8. Entrega
9. Quando a tela de um site muda

---

## 1. O ciclo de uma funcionalidade

```
Investigar ─▶ Planejar ─▶ Regra pura + testes ─▶ Simulação ─▶ Curso de teste ─▶ 1 item real ─▶ Entrega
   (tela real)  (PLANO-*.md)    (Node/DOMParser)    (Canvas falso)    (sandbox)       (produção)
```

Nenhuma etapa é pulada numa funcionalidade de nível 2 ou mais. Numa de nível 0 (só leitura), a simulação e um curso real bastam.

---

## 2. Investigar antes de escrever

**Seletor, endpoint, campo de formulário e formato de resposta só entram no código depois de vistos na tela real.** Inventados, eles passam na simulação (que foi escrita com a mesma suposição) e falham no Canvas.

Como investigar:

| Ferramenta | Para quê |
|---|---|
| Visão HTML do editor (`</>`) | como o Canvas grava um embed, uma equação, um template |
| `GET` da API no navegador (`/api/v1/courses/:id/pages/:url`) | o formato real da resposta, os campos que vêm e os que não vêm |
| Aba Network do DevTools | rotas e cabeçalhos de uma SPA (Studio) ou de um formulário (H5P.com) |
| **Gravador de ações** (extensão à parte, só da equipe de desenvolvimento) | quando a exportação HAR do DevTools falha ou a pessoa que tem acesso não é desenvolvedora: grava `fetch`/XHR, envios de formulário, cliques e o HTML da página num `.json`, com tokens e e-mails mascarados |
| **Diagnóstico provisório** dentro da extensão | um botão temporário que coleta, num texto para copiar, a árvore de frames, os elementos candidatos (tag, id, classes, `aria-label`, texto) e as respostas JSON; removido no fim da fase |

O que anotar (no plano): a árvore de frames e domínios, os seletores **por papel e texto** (não por classe com hash), as rotas com método e parâmetros, um exemplo de resposta (sem dados pessoais), o que muda entre telas (ids de contexto que não podem ser fixados) e os testes que deram errado ("busca pelo formulário volta sempre para All Content").

**Peça à pessoa que tem o acesso** o que faltar: prints, o HTML de um item feito à mão, um curso de teste. Não peça para abrir o DevTools quem não é desenvolvedor; dê um botão de diagnóstico ou o gravador.

---

## 3. O plano (`PLANO-<nome>.md`)

Um arquivo na raiz do projeto, curto, que serve de memória entre sessões de trabalho e de registro das decisões:

```markdown
# Plano — <funcionalidade>

> **Status:** <fase atual, data>. **Para retomar:** <o que fazer primeiro>.

## Andamento
- [x] Fase 1 — investigação (27/10/2026). Ver §2.1.
- [ ] Fase 2 — …

## 1. Objetivo            (o que a pessoa ganha, em uma frase; o fluxo de um clique)
## 2. O que já sabemos    (fatos vistos na tela real, com data)
## 3. O que precisa vir de quem pediu   (acessos, curso de teste, exemplos, respostas)
## 4. Fases               (cada uma com critério de "pronto")
## 5. Testes              (simulação, curso de teste, manual)
## 6. Critérios de aceite
## 7. Riscos e como lidar
## 8. Decisões            (mudar só se quem pediu mudar; cada uma com data e motivo)
```

Atualize o "Andamento" e o "O que já sabemos" ao fim de cada sessão. Decisão de quem pediu ("só busca em My Content", "a lista começa desmarcada") vai para "Decisões" com a data: é o que impede alguém de "melhorar" o comportamento depois.

---

## 4. Regra pura e testes rápidos

**Separe a regra da tela.** A regra é uma função sem DOM da interface e sem `chrome.*`: recebe o HTML e os parâmetros, devolve `{ edits, status, motivo }` (ou o corpo novo). A mesma função serve à prévia, à gravação, à conferência e aos testes.

Testes da regra (Node com um `DOMParser`, ou uma página carregada no Chrome sem tela):

- **casos reais primeiro:** HTML copiado de páginas de verdade (sem dados pessoais) vira fixture;
- **variações que quebram:** entidades × caracteres (`&ccedil;` × `ç`), aspas simples × duplas, atributos fora de ordem, ids repetidos, comentários HTML com o alvo dentro, 0 e 2 alvos, conteúdo inesperado no lugar alvo;
- **byte a byte:** `aplicar(html, edits)` fora do trecho alvo é **igual** ao original (compare as fatias antes e depois do trecho);
- **idempotência:** aplicar duas vezes dá o mesmo que aplicar uma; na segunda, `edits` vem vazio;
- **lógica de outros sites com `fetch` injetado:** funções como `list(fetchFn, …)` e `createQuiz(fetchFn, parseForm, …)` rodam contra o HTML gravado da tela real, sem enviar nada. Foi assim que se ensaiou a criação numa pasta de produção antes de ela acontecer.

**Função injetada autocontida:** carregue a função com `eval('(' + fn.toString() + ')')` num contexto limpo (sem as variáveis do arquivo) e rode. Se ela usa algo de fora, o erro aparece aqui, e não na aba do Canvas. O teste do modelo `assets/canvas-api.js` faz isso (`scripts/testar-canvas-api.js`).

---

## 5. Simulação: Canvas falso no Chrome de verdade

Para o fluxo inteiro (painel, confirmação, laço, relatório), abra a extensão de verdade num Chrome controlado por `playwright-core` (usa o Chrome instalado; não baixa navegador) e substitua o Canvas por um falso.

**O Canvas falso** (`window.fetch` trocado antes do código da extensão):

```js
const db = { 111: { name: 'Cálculo I — Origem', pages: { … }, modules: [ … ] }, 222: { … } };
const log = [];                                   // toda escrita que chega ao "Canvas"
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), 'https://canvas.exemplo.edu');
  const method = (init.method || 'GET').toUpperCase();
  if (method !== 'GET') log.push({ method, path: url.pathname, body: init.body && JSON.parse(init.body) });
  // rotas /api/v1/courses/:id/... respondendo a partir do db, com:
  //  • paginação pequena (2 por página) e Link absoluto, como o Canvas;
  //  • 401 para curso desconhecido; 404 para página que não existe;
  //  • o corpo gravado devolvido no PUT (para a conferência);
};
```

**Falhas para injetar:**

| Falha | O que o código precisa fazer |
|---|---|
| 403 "Rate Limit Exceeded" no 1º pedido | esperar e repetir |
| 403/429 sempre | parar depois de N tentativas, com mensagem e relatório parcial |
| `X-Rate-Limit-Remaining: 40` | pausar |
| rede cai **depois** do POST ter entrado | não duplicar ao tentar de novo (confere antes de criar) |
| sanitização (o PUT devolve o corpo sem um atributo) | marcar ⚠ na conferência |
| página editada há 5 minutos | aviso de edição recente na prévia |
| aba troca de curso entre a prévia e o aplicar | recusar, "nada foi alterado" |

**`chrome.*` simulado** quando a página é aberta fora da extensão: `chrome.tabs.query` devolvendo uma aba do curso, `chrome.scripting.executeScript` chamando a função direto, `chrome.storage` em memória (compartilhado entre frames simulados).

**Telas de outros sites** (popup do H5P.com, frame do Studio): monte a tela falsa a partir do HTML gravado da real e sirva-a num endereço do domínio verdadeiro com `page.route('https://*.h5p.com/**', …)`, para que os filtros por `hostname` e os `matches` dos content scripts valham. Simule também o comportamento (a página que recarrega a cada busca).

**Editor:** página local com `<!DOCTYPE html>`, TinyMCE do cdnjs (5, 6 e 7), CodeMirror 6 e 5 e `textarea` (`editor-rce.md` §12).

**Verificações** com `expect`/`assert` e capturas de tela salvas numa pasta temporária, para quem revisa ver as telas sem rodar.

Como rodar fica num README da pasta de testes (`npm install && npm test`, caminho do Chrome).

---

## 6. O que todo teste de escrita precisa provar

- [ ] **Nada é gravado na prévia** (o `log` está vazio depois dela).
- [ ] **Número errado, aba de outro curso, Cancelar, Esc** → nada gravado e mensagem certa.
- [ ] **Prévia vencida** (mudou a seleção ou a configuração) → não grava.
- [ ] **Clique duplo** → uma gravação só.
- [ ] **Origem somente leitura** → nenhuma escrita nela (filtre o `log` pelo curso).
- [ ] **Só o campo necessário** vai no corpo (`wiki_page: { body }`, sem `title` nem `published`).
- [ ] **O resto do HTML fica byte a byte igual**, inclusive outros embeds do mesmo tipo.
- [ ] **Idempotência:** rodar de novo não grava nada ("já estava") e não duplica criações.
- [ ] **Um pedido por vez:** registre início e fim de cada `fetch` e confira que nunca há dois em andamento.
- [ ] **Limite de requisições:** espera, repete e, se persistir, para com relatório parcial.
- [ ] **Conferência:** corpo devolvido diferente do esperado → ⚠.
- [ ] **Relatório** com ✅ / — / ⚠ / ✗ por item e "nada foi alterado" quando for o caso.

---

## 7. Curso de teste e primeiro uso real

1. **Curso de teste (sandbox)**, nunca um curso com alunos, com páginas no modelo real (copie duas ou três páginas de verdade). Rode a funcionalidade inteira.
2. **Confira como aluno** ("Ver como aluno" / "Student View"): o embed abre? o quiz responde? o vídeo toca?
3. **Confira o histórico da página** (versão anterior intacta, diferença só no trecho alvo).
4. **No curso real, um item só** (a lista desmarcada serve para isso). Confira de novo. Só então o lote.
5. **Anote no plano** o que foi testado no real, com data e curso de teste, e o que ainda só passou na simulação. Essa distinção aparece na entrega.

---

## 8. Entrega

- **Suba a `version` do manifest** e registre o que mudou (README, manual da equipe).
- **Commits pequenos:** um por funcionalidade e um "Sobe versão para X.Y".
- **A mensagem de entrega diz:** o que mudou para quem usa; **como foi testado** (simulação, curso de teste ou Canvas real, sem arredondar: "passou na simulação; falta o teste real" é uma resposta válida); o que ficou de fora e por quê; o que depende de quem pediu.
- **Recurso arriscado entra desligado** numa chave das configurações, e a entrega diz onde ligar.
- **Avise a equipe** da versão nova e de como atualizar (recarregar a extensão, F5 nas abas do Canvas abertas).

---

## 9. Quando a tela de um site muda

Telas do Canvas, do Studio e do H5P.com mudam sem aviso. Para que isso custe pouco:

- **Seletores e rotas num lugar só**, no topo do arquivo, com um comentário dizendo onde e quando foram vistos.
- **Falhe com uma mensagem que diz o passo:** "não achei o formulário de criação do H5P.com (a tela pode ter mudado)". Nunca siga adiante com um palpite.
- **Mantenha o caminho do diagnóstico:** o botão provisório pode ser recriado a partir do plano, e o gravador de ações continua fora da extensão.
- **Rode a regressão** depois de qualquer ajuste. Os testes guardam o conhecimento de cada caso estranho já visto.
