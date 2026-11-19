# Segurança

## Sumário
1. Modelo de ameaça
2. Segredos e dados sensíveis
3. Mensagens entre as partes
4. Entrada não confiável e HTML
5. Dados de alunos (LGPD) e serviços externos
6. Permissões do manifest
7. Sites de terceiros
8. Distribuição para a equipe
9. Checklist de revisão de segurança

---

## 1. Modelo de ameaça

A extensão age **com os poderes de quem está logado** no Canvas, no Studio e no H5P.com. O risco maior não é um invasor sofisticado; é a extensão fazer, sozinha ou por engano, algo que a pessoa não pediu.

| Ameaça | Exemplo | Defesa |
|---|---|---|
| **Erro de código em escala** | laço grava 40 páginas erradas | protocolo de escrita (`escrita-segura.md`), teste num item só, regra pura testada |
| **Clique sem querer, aba trocada** | aplica no curso B a prévia do curso A | confirmação pelo número do curso + `write()` que recusa curso não confirmado |
| **Página maliciosa ou comprometida** | script do Canvas (ou de um conteúdo embutido) posta uma mensagem para a ponte da extensão | ponte não confia no que chega; nenhuma escrita sem confirmação na interface da extensão |
| **Vazamento de segredo** | JWT do Studio, token do H5P ou e-mail de aluno parar num log, no storage ou num relatório | não ler, não guardar, não registrar (§2) |
| **Vazamento de dados de alunos** | nota ou nome enviado a um serviço externo | dados de alunos não saem da máquina (§5) |
| **Permissão ampla demais** | `<all_urls>` + bug = estrago em qualquer site | permissões mínimas na versão distribuída (§6) |
| **Extensão adulterada** | alguém troca um arquivo do pacote passado de mão em mão | distribuir de um lugar só, com versão (§8) |

---

## 2. Segredos e dados sensíveis

**Regra:** a extensão não guarda segredo. Ela usa a sessão do navegador (`sessao-csrf-api.md` §1).

**Não leia, não registre (`console.log`), não grave e não envie:**

- o token CSRF (lido na hora de cada escrita, usado e descartado);
- o `lti_params` do Studio (JWT com e-mail, ids e a chave OAuth da ferramenta), exceto o `lti_course_id`, em memória;
- os cabeçalhos de autenticação da SPA do Studio (vivem só no frame);
- `pandata_tokens`, `author.email` e afins nas respostas do Studio;
- o `_token` dos formulários do H5P.com (usado no envio e descartado);
- cookies (a extensão não precisa da permissão `cookies` quando chama o Canvas da própria aba).

**Ferramentas de diagnóstico e de gravação de rede** mascaram tokens, e-mails e campos secretos antes de salvar. Mantêm intactos os ids longos (19 dígitos), que são necessários e não são segredo.

**Quando uma função exige chave de terceiro** (ex.: um serviço de IA que converte imagem de fórmula em LaTeX):

- a chave é **da pessoa**, digitada nas configurações, guardada em `chrome.storage.local` (nunca em `storage.sync`, nunca no código, nunca no repositório);
- o campo é do tipo senha e a chave nunca aparece em mensagens nem em logs;
- a função nasce desligada e diz claramente o que é enviado para fora (ex.: "a imagem da fórmula vai para o serviço X");
- conteúdo com dado de aluno nunca vai para esse serviço (§5).

**Webhook de planilha** (Google Apps Script publicado como "App da Web" com acesso "Qualquer pessoa"): a URL funciona como senha. Quem a tem escreve na planilha. Não a publique, não a registre em log e não mande dados de alunos para ela.

---

## 3. Mensagens entre as partes

```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;                       // só da própria extensão
  if (sender.tab) {                                                  // veio de content script
    let host = '';
    try { host = new URL(sender.tab.url || sender.url).hostname; } catch {}
    if (!HOSTS_PERMITIDOS.some(re => re.test(host))) return;
  }
  if (!msg || typeof msg.type !== 'string' || !(msg.type in ACOES)) return;
  ACOES[msg.type](msg, sender).then(sendResponse, e => sendResponse({ status: 'error', message: e.message }));
  return true;                                                       // resposta assíncrona
});
```

- **Lista fechada de ações** (`ACOES`), cada uma validando os próprios campos (tipos, ids só com algarismos, tamanhos).
- **`window.postMessage` (ponte MAIN ↔ ISOLATED):** aceite só `e.source === window` com a marca da extensão. Mesmo assim, **qualquer script da página pode postar a mesma mensagem**. A ponte só pode fazer coisas inofensivas (gravar um pedido de busca, ler um resultado) ou que ainda passem por confirmação na interface da extensão. Uma mensagem vinda da página nunca dispara escrita no Canvas.
- **Pedidos guardados no storage** para atravessar frames (ex.: a busca no popup do H5P) levam id e horário e valem por pouco tempo (2 minutos). O script do outro frame confere a idade e apaga o pedido depois de usar.
- **`externally_connectable`** (mensagens de sites ou de outras extensões): só se houver motivo, com a lista exata de quem pode falar.

---

## 4. Entrada não confiável e HTML

- **Texto de usuário, nome de curso, título de página, nome de quiz e resposta de API entram na tela como texto:** `textContent`, nunca `innerHTML`. Um título com `<img onerror>` executaria código no painel da extensão, que tem acesso a todas as permissões dela.
- **Quando precisar montar HTML** (o corpo de uma página, o atributo de um iframe), escape `& < > "`:

  ```js
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  ```

- **HTML de outro site** (formulários do H5P.com) só é interpretado no documento offscreen, depois de tirar `script`, `iframe`, `img`, `link`, `style` e afins, e nunca é inserido numa página da extensão.
- **URLs vindas de respostas** são conferidas antes de usar: origem esperada (`new URL(x).origin === ORIGEM`) e caminho esperado. Um formulário que aponta para outro lugar não é enviado.
- **Sem `eval`, `new Function` ou código remoto.** O MV3 já proíbe código remoto; mantenha tudo no pacote.
- **Arquivos escolhidos pela pessoa** (`.xlsx`, `.h5p`, `.zip`) são lidos com limite de tamanho, formato conferido e erros por arquivo ("não é um .h5p válido"), nunca executados.

---

## 5. Dados de alunos (LGPD) e serviços externos

- **Leia o mínimo.** Relatório de notas faltando precisa de ids e notas; nome só se a tela mostrar, e-mail nunca.
- **Não persista** dados de alunos. Se precisar entre telas, use memória ou `chrome.storage.session` (descartado ao fechar o Chrome) e apague ao terminar.
- **Não envie para fora da máquina** (planilha, webhook, serviço de IA, analytics) sem necessidade **e** sem aprovação institucional. Exportar um arquivo local que a própria pessoa baixa é diferente de enviar a um servidor.
- **Serviços externos e de IA** dependem de aprovação da instituição, mesmo para conteúdo sem dados pessoais. Documente o que vai, para onde e por quê.
- **Telemetria:** nenhuma. A extensão não manda uso, erros nem dados para o desenvolvedor.
- **Política de privacidade** (obrigatória na Web Store e boa prática interna): o que a extensão lê, o que guarda (e onde, e por quanto tempo), o que envia (nada, idealmente) e por que cada permissão existe.

---

## 6. Permissões do manifest

| Permissão | Quando |
|---|---|
| `storage`, `scripting`, `tabs`, `sidePanel` | base de uma extensão de painel |
| `host_permissions` do Canvas, Studio e H5P da instituição | domínios exatos (`https://*.instructure.com/*`, `https://<instituicao>.h5p.com/*`) |
| `optional_host_permissions` | domínios usados só por uma função; pedidos na hora do clique, e o resto funciona se a pessoa negar |
| `offscreen`, `downloads`, `contextMenus`, `clipboardRead`/`clipboardWrite`, `alarms` | só se usadas |
| `cookies` | normalmente desnecessária (as chamadas saem da aba) |
| `<all_urls>` | só em ferramenta interna, por decisão consciente; nunca numa versão distribuída fora da equipe |

Cada permissão a mais aumenta o estrago de um bug e o rigor da revisão na Web Store. Revise o manifest a cada entrega e retire o que deixou de ser usado.

`content_scripts.matches` também é permissão: restrinja a `/courses/*` (ou à tela exata) em vez de `*://*/*`. Script que precisa rodar em qualquer site (um botão do editor genérico) deve ser inofensivo onde não encontra o que procura.

---

## 7. Sites de terceiros

- **Automação só no clique**, em ritmo humano, sem abrir abas ou janelas que a pessoa não pediu.
- **Não desligue proteções** (CSP, X-Frame-Options, SameSite) nem reescreva cabeçalhos com `declarativeNetRequest` para burlar o site.
- **Não falsifique** `Origin`, `Referer` ou `User-Agent`. O pedido do service worker sai com `Origin: chrome-extension://…`, e tudo bem: é o que ele é.
- **Respeite os termos do serviço e o plano contratado** (contas de autor, limites). Se o site oferece API, prefira a API.
- **Onde não se pode apagar** (pastas compartilhadas de produção), confira antes de enviar e mantenha um destino de teste (`h5p.md` §4).

---

## 8. Distribuição para a equipe

- **Uma origem só:** o repositório da equipe (ou a Web Store, como "Não listada" ou privada para o domínio da instituição). Nada de pacotes passados por chat.
- **`version` sobe a cada entrega**, e a equipe confere a versão em `chrome://extensions`.
- **Ferramentas de desenvolvimento ficam fora do pacote:** gravadores de rede, botões de diagnóstico, páginas de teste, chaves de depuração.
- **Recursos arriscados nascem desligados** numa chave das configurações (`chrome.storage.local`, padrão `false`), que vale na hora, sem recarregar.
- **Atualização:** "Carregar sem compactação" exige que cada pessoa atualize a pasta e clique em recarregar; diga isso no aviso da versão nova.

---

## 9. Checklist de revisão de segurança

- [ ] Nenhum token, JWT, cookie, cabeçalho de autenticação, e-mail ou dado de aluno em `console.log`, storage, relatório ou mensagem.
- [ ] Chave de terceiro (se houver) só em `storage.local`, campo de senha, função desligada por padrão, aviso do que é enviado.
- [ ] `onMessage` confere `sender.id` e a origem; ações numa lista fechada; campos validados.
- [ ] Ponte `postMessage` confere `e.source === window` e a marca, e não dispara escrita sozinha.
- [ ] Todo texto de fora entra por `textContent`; HTML montado com escape.
- [ ] URLs e formulários vindos de respostas têm a origem e o caminho conferidos antes do envio.
- [ ] Sem `eval`, `new Function`, `innerHTML` com dado externo, código remoto.
- [ ] `host_permissions` e `matches` só com os domínios necessários; nada de `<all_urls>` na versão distribuída.
- [ ] Dados de alunos não saem da máquina; serviços externos aprovados e documentados.
- [ ] Nenhuma proteção de site desligada; nenhum cabeçalho falsificado.
- [ ] Ferramentas de diagnóstico fora do pacote; recursos arriscados desligados por padrão.
