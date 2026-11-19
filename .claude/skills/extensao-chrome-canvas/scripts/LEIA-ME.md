# Testes dos modelos

Os dois modelos de `assets/` têm teste. Rode de novo **sempre que mexer num modelo** (ou ao copiá-lo para um projeto e adaptá-lo).

| Teste | O que cobre | Precisa de |
|---|---|---|
| `testar-canvas-api.js` | `canvasMain`: prefixo `while(1);`, paginação pelo `Link`, módulo sem `items`, 403 "Rate Limit Exceeded" e 429 (espera, repete, desiste depois de 4), `Retry-After`, 403 de permissão sem repetir, pausas pelo `X-Rate-Limit-Remaining`, as quatro travas do `write()` (sem confirmação, outro curso, somente leitura, aba fora do curso), PUT só com o corpo e CSRF decodificado, erro de rede numa escrita sem repetir, 422 de CSRF legível, teto da listagem e função autocontida (serializada e reavaliada) — 19 casos | só o Node (18 ou mais) |
| `testar-confirmar-curso.js` | `confirmarCurso`: itens como texto, número escondido, letras, número errado, aba trocada depois da prévia, aba fora do Canvas, número certo, Esc, clique fora, Cancelar e nome do curso — 9 casos | Node + `playwright-core` + Google Chrome instalado |

## Como rodar

```bash
cd scripts
node testar-canvas-api.js          # não precisa instalar nada

npm install                        # uma vez: baixa só o playwright-core (o Chrome é o do sistema)
npm run testar-confirmar
npm test                           # os dois
```

O teste da janela procura o Chrome nos caminhos comuns do Windows, do macOS e do Linux. Se ele estiver em outro lugar, informe:

```bash
CHROME_PATH="D:/Programas/Chrome/chrome.exe" npm run testar-confirmar      # Git Bash, macOS, Linux
$env:CHROME_PATH = "D:\Programas\Chrome\chrome.exe"; npm run testar-confirmar   # PowerShell
```

A saída lista `ok` ou `FALHA` por caso e termina com `N/N casos OK — TUDO OK`. O código de saída é 0 quando tudo passa (bom para usar antes de um commit).

## Ao acrescentar uma operação ao `canvasMain`

Acrescente um caso no `testar-canvas-api.js`: o Canvas falso é uma fila de respostas (`script.push(req => resp(status, corpo, cabeçalhos))`), e `calls` guarda cada pedido feito, com método, URL, cabeçalhos e corpo. Para uma escrita, confira pelo menos: o método e a rota, o corpo exato, o CSRF e que, sem `confirmado`, nenhum pedido sai.
