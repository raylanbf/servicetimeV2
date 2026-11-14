# Gravador de Ações

Extensão pequena e separada do Service Timer. Ela grava o que um site faz enquanto você o usa e salva tudo num `.json`. Serve para descobrir como automatizar uma ação de um site que não tem API documentada, como criar pasta no H5P.com, listar vídeos do Studio ou salvar algo no Canvas.

Foi criada em 13/11/2026 para descobrir como o H5P.com cria pastas: um `POST /content` com `title`, `parent` e `type=1`.

## Instalar (uma vez)

1. Abra `chrome://extensions` e ligue o **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e escolha **esta pasta** (`ferramentas/gravador-acoes`).
3. Fixe o ícone da extensão na barra, se quiser.

## Gravar uma ação

1. Abra o site, logado.
2. Clique no ícone do Gravador e em **● Gravar neste site**. A aba recarrega, e um quadro escuro aparece no canto inferior esquerdo.
3. Faça a ação normalmente, do jeito que faria à mão.
4. No quadro escuro, clique em **Salvar arquivo**. Ele baixa `gravacao-<site>-<data>.json` em **Downloads**.
5. Clique no ícone do Gravador e em **■ Parar de gravar neste site**.

Botões do quadro:
- **Foto da página:** guarda o HTML da página como está naquele momento. Útil com uma janela aberta.
- **Limpar:** apaga o que já foi gravado e recomeça.

A gravação continua ao trocar de página na mesma aba. Ela só vale para o site escolhido e some ao fechar o Chrome.

## O que entra no arquivo

| Tipo | Conteúdo |
|---|---|
| `request` | Pedidos `fetch` e `XHR`: método, endereço, corpo enviado, status e resposta (texto/JSON/HTML, até 30 mil caracteres). |
| `submit` | Formulários enviados: endereço, método, `enctype` e campos. |
| `click` | Elemento clicado, com atributos, os dois pais e os campos da janela ou do formulário em volta. |
| `popup` | Menus e janelas no momento em que ficam visíveis, com o HTML e os campos. |
| `navegou` / `navegou-spa` | Trocas de página, inclusive as de app de página única. |
| `pages` | Fotos da página (ao carregar e pelo botão): HTML, `meta`, scripts, formulários e as variáveis globais próprias do site. |

## Privacidade

- **Cookies** não são lidos.
- **Cabeçalhos:** só os nomes entram, mais o valor de `content-type`, `accept` e `x-requested-with`.
- **Senhas e arquivos** nunca são lidos.
- **Trocados por um marcador:**
  - e-mails viram `[email]`;
  - JWT vira `[jwt]`;
  - tokens longos viram `[token]`;
  - campos com *token, password, secret, auth, session* ou *cookie* no nome viram `[oculto]`, inclusive no HTML, no JSON e na URL.
- **IDs numéricos grandes** (como os de 19 dígitos do H5P.com) ficam intactos.

Mesmo assim, o arquivo pode ter nomes de pessoas, cursos e conteúdos que estavam na tela. Trate-o como interno.

## Limites

- **Só a aba principal é gravada**, não os iframes. Para gravar dentro de um iframe de outro site, como o popup do H5P no Canvas, abra o endereço dele numa aba própria.
- **Formulário que troca de página:** o envio é gravado como `submit`, mas a resposta não, porque é a página nova. A foto da página nova mostra o resultado.
- **WebSocket** não é gravado.

## Arquivos

- `manifest.json` — permissões: `scripting` e `tabs`, mais acesso a todos os sites. Nada roda sem você ligar a gravação.
- `popup.html` / `popup.js` — liga e desliga a gravação por site, registrando o `gravador.js` só para aquele site.
- `gravador.js` — o gravador, que roda na página no mundo MAIN.
