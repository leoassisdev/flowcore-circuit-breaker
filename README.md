# Circuit Breaker

> Disjuntor com estados fechado, aberto e meio-aberto: para de chamar o serviço que está caindo e testa a volta sozinho. Seu sistema continua de pé quando o fornecedor sai do ar.

**Ver ao vivo, com preview e manual:** https://flowcoresolucoes.com.br/codigos/circuit-breaker

Criado por **FlowCore Soluções LTDA**.

## Arquivos

- [`src/circuit-breaker.ts`](src/circuit-breaker.ts)
- [`src/circuit-breaker.test.ts`](src/circuit-breaker.test.ts)

## Como instalar

1. **Funciona onde você já roda** Node 18+, Cloudflare Workers, Deno, Bun, Vercel e Netlify Functions. Zero dependência: só fetch e Web Crypto, que já vêm no runtime.
2. **Crie src/lib/circuit-breaker.ts** Copie o conteúdo de `src/circuit-breaker.ts` e `src/circuit-breaker.test.ts` deste repositório.
3. **Use**

   ```bash
   const erp = criarCircuitBreaker({ nome: "erp", limiteFalhas: 5, tempoResetMs: 30_000 });
   erp.on((e) => e.tipo === "mudanca" && console.warn("ERP:", e.de, "->", e.para));
   try {
     return await erp.executar(() => buscarPrecoNoErp(sku));
   } catch (e) { if (e instanceof ErroCircuitoAberto) return precoEmCache(sku); throw e; }
   ```

4. **Rode o teste junto** O arquivo de teste (`src/circuit-breaker.test.ts`) cobre 9 cenários. Copie para src/lib/ ao lado e rode:

   ```bash
   npm install -D vitest
   npx vitest run src/lib
   ```


## Testes

`src/circuit-breaker.test.ts` cobre 9 cenários.

```bash
npm install
npm test
```

## Licença

MIT. Pode usar em projeto pessoal ou comercial, de graça. A única condição é manter a linha **“Criado por FlowCore Soluções LTDA”** (ou o crédito de adaptação) onde ela está.

---

Precisa disso integrado no seu sistema? A [FlowCore](https://flowcoresolucoes.com.br) desenvolve sob medida.
