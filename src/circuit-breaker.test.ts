// circuit-breaker.test.ts · Criado por FlowCore Soluções LTDA · flowcoresolucoes.com.br/codigos · licença MIT
import { describe, expect, it } from "vitest";
import { criarCircuitBreaker, ErroCircuitoAberto, type EventoCircuito } from "./circuit-breaker";

const falhar = async () => {
  throw new Error("timeout do ERP");
};
const ok = async () => "ok";

describe("circuit-breaker", () => {
  it("começa fechado e deixa passar", async () => {
    const cb = criarCircuitBreaker();
    expect(cb.estado).toBe("fechado");
    expect(await cb.executar(ok)).toBe("ok");
  });

  it("abre após N falhas seguidas e rejeita rápido", async () => {
    let t = 0;
    const cb = criarCircuitBreaker({ limiteFalhas: 3, tempoResetMs: 10_000, now: () => t, nome: "erp" });
    for (let i = 0; i < 3; i++) await expect(cb.executar(falhar)).rejects.toThrow("timeout do ERP");
    expect(cb.estado).toBe("aberto");
    t = 4_000;
    const erro = await cb.executar(ok).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroCircuitoAberto);
    expect(erro.retryEmMs).toBe(6_000);
    expect(erro.message).toContain('"erp"');
    expect(cb.contadores).toEqual({ sucessos: 0, falhas: 3, rejeitados: 1 });
  });

  it("sucesso no meio zera a contagem de falhas seguidas", async () => {
    const cb = criarCircuitBreaker({ limiteFalhas: 3 });
    await cb.executar(falhar).catch(() => {});
    await cb.executar(falhar).catch(() => {});
    await cb.executar(ok);
    await cb.executar(falhar).catch(() => {});
    await cb.executar(falhar).catch(() => {});
    expect(cb.estado).toBe("fechado");
  });

  it("vai pra meio-aberto após o reset e fecha com sucesso", async () => {
    let t = 0;
    const cb = criarCircuitBreaker({ limiteFalhas: 1, tempoResetMs: 1000, now: () => t });
    await cb.executar(falhar).catch(() => {});
    t = 1000;
    expect(cb.estado).toBe("meio-aberto");
    expect(await cb.executar(ok)).toBe("ok");
    expect(cb.estado).toBe("fechado");
  });

  it("falha no meio-aberto reabre e reinicia o tempo", async () => {
    let t = 0;
    const cb = criarCircuitBreaker({ limiteFalhas: 1, tempoResetMs: 1000, now: () => t });
    await cb.executar(falhar).catch(() => {});
    t = 1500;
    await cb.executar(falhar).catch(() => {});
    expect(cb.estado).toBe("aberto");
    t = 2400;
    expect(cb.estado).toBe("aberto");
    t = 2500;
    expect(cb.estado).toBe("meio-aberto");
  });

  it("limita chamadas de teste simultâneas e exige N sucessos", async () => {
    let t = 0;
    const cb = criarCircuitBreaker({ limiteFalhas: 1, tempoResetMs: 100, sucessosParaFechar: 2, now: () => t });
    await cb.executar(falhar).catch(() => {});
    t = 100;
    let liberar!: () => void;
    const lenta = cb.executar(() => new Promise<string>((r) => (liberar = () => r("lenta"))));
    await expect(cb.executar(ok)).rejects.toBeInstanceOf(ErroCircuitoAberto);
    liberar();
    await lenta;
    expect(cb.estado).toBe("meio-aberto");
    await cb.executar(ok);
    expect(cb.estado).toBe("fechado");
  });

  it("emite eventos de mudança, sucesso, falha e rejeição", async () => {
    let t = 0;
    const cb = criarCircuitBreaker({ limiteFalhas: 1, tempoResetMs: 50, now: () => t });
    const eventos: EventoCircuito[] = [];
    const cancelar = cb.on((e) => eventos.push(e));
    cb.on(() => {
      throw new Error("ouvinte quebrado");
    });
    await cb.executar(falhar).catch(() => {});
    await cb.executar(ok).catch(() => {});
    t = 50;
    await cb.executar(ok);
    expect(eventos.map((e) => (e.tipo === "mudanca" ? `${e.de}->${e.para}` : e.tipo))).toEqual([
      "falha",
      "fechado->aberto",
      "rejeitado",
      "aberto->meio-aberto",
      "sucesso",
      "meio-aberto->fechado",
    ]);
    cancelar();
    await cb.executar(ok);
    expect(eventos).toHaveLength(6);
  });

  it("ignora erros que não contam como falha", async () => {
    const cb = criarCircuitBreaker({ limiteFalhas: 1, contaComoFalha: (e) => !(e instanceof RangeError) });
    await expect(
      cb.executar(async () => {
        throw new RangeError("CPF inválido");
      }),
    ).rejects.toThrow("CPF inválido");
    expect(cb.estado).toBe("fechado");
  });

  it("permite abrir e resetar manualmente e valida opções", async () => {
    const cb = criarCircuitBreaker();
    cb.abrir();
    expect(cb.estado).toBe("aberto");
    cb.resetar();
    expect(await cb.executar(ok)).toBe("ok");
    expect(() => criarCircuitBreaker({ limiteFalhas: 0 })).toThrow("limiteFalhas");
  });
});
