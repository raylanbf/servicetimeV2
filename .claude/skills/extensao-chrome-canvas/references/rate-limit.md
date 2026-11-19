# Limite de requisições do Canvas (rate limit)

## Sumário
1. Como o Canvas limita
2. Por que o paralelismo é o vilão
3. A política (o que o código faz)
4. Quando é seguro repetir
5. Leia menos: cache e escopo
6. Lotes grandes e vários cursos
7. Sistemas externos
8. Como testar

---

## 1. Como o Canvas limita

O Canvas usa um **balde furado** (leaky bucket) por usuário. Vale para pedidos com token e também pela sessão, porque o balde é da pessoa.

- Cada pedido **custa** unidades, proporcionais ao trabalho que deu ao servidor (tempo de processamento e de banco). Uma listagem pesada custa mais que ler uma página.
- Enquanto um pedido está em andamento, ele também paga um **adiantamento** fixo, devolvido quando termina.
- O balde **se recompõe** a uma taxa constante.
- Quando a quota acaba, o Canvas responde **403** com o corpo **"403 Forbidden (Rate Limit Exceeded)"**. Alguns ambientes (proxies, outros serviços) respondem **429**. Trate os dois.

Cabeçalhos em cada resposta:

| Cabeçalho | O que diz |
|---|---|
| `X-Rate-Limit-Remaining` | quanto sobrou no balde depois deste pedido |
| `X-Request-Cost` | quanto este pedido custou |

**Ordem de grandeza** (padrões do Canvas de código aberto; cada instância pode configurar outros): quota de algumas centenas de unidades (na casa de 600 a 700), recomposição de cerca de 10 unidades por segundo e adiantamento de cerca de 50 por pedido em andamento. Use os números para entender o comportamento e confie no cabeçalho para decidir.

---

## 2. Por que o paralelismo é o vilão

Com o adiantamento de ~50, **dez pedidos simultâneos travam ~500 unidades na hora**, antes de qualquer um terminar. Um `Promise.all` sobre as 40 páginas de um curso derruba o balde num instante, e daí em diante **todos** os pedidos daquela pessoa, inclusive os da interface do Canvas em outras abas, voltam 403 por um tempo.

Em sequência, cada pedido termina antes do próximo, o adiantamento é devolvido e o balde quase não desce. Por isso a regra número 1 é: **um pedido por vez**.

```js
// ✗ derruba o balde
await Promise.all(paginas.map(p => lerPagina(p.url)));

// ✓ um por vez, com progresso
for (let i = 0; i < paginas.length; i++) {
  progresso(`Lendo página ${i + 1} de ${paginas.length}…`);
  linhas.push(await lerPagina(paginas[i].url));
}
```

---

## 3. A política (o que o código faz)

Implementada em `assets/canvas-api.js` › `request()`:

| Situação | Ação |
|---|---|
| Toda resposta | ler `X-Rate-Limit-Remaining` |
| restante ≥ 300 | segue sem pausa (leitura) |
| 150 ≤ restante < 300 | pausa de 0,6 s |
| 50 ≤ restante < 150 | pausa de 2 s |
| restante < 50 | pausa de 5 s (recompõe ~50 unidades) |
| escrita (POST/PUT/DELETE) | pausa mínima de 0,4 s, mesmo com o balde cheio |
| cabeçalho ausente | sem pausa extra na leitura; mínima na escrita |
| 403 "Rate Limit Exceeded" ou 429 | esperar `Retry-After` (até 60 s) ou 2 s, 4 s, 8 s, 16 s, com uma variação aleatória de até 0,5 s; repetir |
| ainda limitado depois de 4 novas tentativas | **parar**, dizer o que já foi feito e o que falta, sugerir tentar em alguns minutos |
| 5xx numa leitura | repetir até 2 vezes (2 s, 4 s) |

A variação aleatória evita que duas abas, ou duas pessoas na mesma conta, voltem a bater juntas.

**Não "tente para sempre".** Um laço infinito de novas tentativas prende o painel, mantém o balde vazio e esconde o problema. Depois do limite, pare e relate.

---

## 4. Quando é seguro repetir

| Caso | Repetir? | Por quê |
|---|---|---|
| 403 "Rate Limit Exceeded" / 429, em leitura ou escrita | **sim** | o Canvas recusou antes de processar; nada foi feito |
| GET sem resposta (erro de rede) ou 5xx | sim | leitura não muda nada |
| PUT/POST sem resposta (erro de rede, aba recarregou) | **não às cegas** | pode ter entrado; releia e confira antes |
| PUT do corpo inteiro de uma página, já conferido | sim | gravar o mesmo corpo de novo dá o mesmo resultado |
| POST que cria (tarefa, módulo, item) | só se a operação conferir antes se já existe | senão, duplica |
| 403 de permissão, 404, 422 | não | repetir não muda a resposta |

---

## 5. Leia menos: cache e escopo

Cada leitura que não acontece é balde poupado.

- **Leia uma vez por execução e reaproveite.** Um checklist com seis verificações refazia, em cada uma, a leitura de todos os módulos e itens, e estourava o limite. Corrigido com um cache por execução:

  ```js
  let _modulos = null;
  const modulos = async () => _modulos || (_modulos = await getAll(`${api}/modules?include[]=items&per_page=100`));
  ```

- **`per_page=100`** em toda listagem: 10 pedidos viram 1.
- **Escopo pequeno:** leia só os módulos marcados, não o curso inteiro. Isso também é segurança.
- **Use o que a listagem já trouxe.** `include[]=items` traz os itens com os módulos. Só busque à parte o que faltou.
- **Não faça polling do Canvas.** Nada de `setInterval` consultando a API "para ver se mudou". Reaja ao clique da pessoa ou a `chrome.storage.onChanged`.

---

## 6. Lotes grandes e vários cursos

- **Cursos um depois do outro**, nunca em paralelo.
- **Progresso visível:** "Gravando página 7 de 40… mantenha o painel aberto."
- **Parada limpa:** se o limite persistir no meio do lote, pare e mostre o relatório parcial (✅ feitos, ✗ não feitos). Como as operações são idempotentes, rodar de novo continua de onde parou, e o que já estava feito aparece como "já estava".
- **Prévia e gravação separadas:** a prévia lê tudo, e a gravação lê de novo só o que vai mudar (releitura obrigatória, ver `escrita-segura.md`). Isso dobra as leituras dos itens alterados, e o custo vale a pena.
- **Teto por execução**, se fizer sentido (ex.: 10 cursos por vez na troca de banner), para limitar o estrago de um erro e o tempo com o painel aberto.

---

## 7. Sistemas externos

O H5P.com e outros sites sem API oficial não informam o limite. Use **ritmo humano**: um passo por vez e **1,5 s entre criações**. Pare na primeira resposta estranha (página de login, 419, formulário com erro) em vez de insistir. O pedido deve parecer, e ser, o de uma pessoa usando a tela: sem rajadas e só quando alguém clicou.

---

## 8. Como testar

No Canvas falso da simulação (ver `testes-e-processo.md`):

- responda **403 "403 Forbidden (Rate Limit Exceeded)"** no primeiro pedido e confira que houve espera e nova tentativa;
- responda 403/429 sempre e confira que o código **para** com mensagem clara, depois de um número finito de tentativas;
- devolva `X-Rate-Limit-Remaining: 40` e confira a pausa;
- registre o horário de cada pedido e confira que **nunca há dois em andamento ao mesmo tempo**;
- quebre a rede num PUT e confira que ele **não** é repetido às cegas.

`scripts/testar-canvas-api.js` faz quase tudo isso para o modelo.
