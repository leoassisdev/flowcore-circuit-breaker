// circuit-breaker.ts · Criado por FlowCore Soluções LTDA · flowcoresolucoes.com.br/codigos · licença MIT
// Disjuntor (circuit breaker) pra integração instável: depois de N falhas
// seguidas para de chamar o serviço (falha rápido, sem empilhar timeout),
// espera o tempo de reset e testa com poucas chamadas (meio-aberto) antes de
// voltar ao normal. Estados fechado/aberto/meio-aberto, relógio injetável e
// eventos pra log e métrica.
// Roda em Node 18+, Cloudflare Workers, Deno, Bun e no navegador.
// Zero dependências.
//
// Referência: Michael Nygard, "Release It!" (padrão Circuit Breaker) e
// Martin Fowler, "CircuitBreaker" (martinfowler.com/bliki/CircuitBreaker.html).

export const CRIADO_POR = "Criado por FlowCore Soluções LTDA";

export type EstadoCircuito = "fechado" | "aberto" | "meio-aberto";

export type EventoCircuito =
  | { tipo: "mudanca"; de: EstadoCircuito; para: EstadoCircuito }
  | { tipo: "sucesso"; estado: EstadoCircuito }
  | { tipo: "falha"; estado: EstadoCircuito; erro: unknown }
  | { tipo: "rejeitado"; retryEmMs: number };

export type OpcoesCircuito = {
  /** Falhas seguidas que abrem o circuito. Padrão 5. */
  limiteFalhas?: number;
  /** Tempo aberto antes de testar de novo, em ms. Padrão 30000. */
  tempoResetMs?: number;
  /** Sucessos no meio-aberto pra fechar. Padrão 1. */
  sucessosParaFechar?: number;
  /** Chamadas de teste simultâneas permitidas no meio-aberto. Padrão 1. */
  testesSimultaneos?: number;
  /** Quais erros contam como falha (ex.: ignorar 4xx de validação). Padrão: todos. */
  contaComoFalha?: (erro: unknown) => boolean;
  /** Nome pra logs. */
  nome?: string;
  now?: () => number;
};

export class ErroCircuitoAberto extends Error {
  constructor(
    readonly nomeCircuito: string,
    readonly retryEmMs: number,
  ) {
    super(`Circuito "${nomeCircuito}" aberto: serviço indisponível, tente em ${Math.ceil(retryEmMs / 1000)}s`);
    this.name = "ErroCircuitoAberto";
  }
}

export class CircuitBreaker {
  private _estado: EstadoCircuito = "fechado";
  private falhasSeguidas = 0;
  private sucessosMeioAberto = 0;
  private testesEmAndamento = 0;
  private abertoEm = 0;
  private ouvintes = new Set<(e: EventoCircuito) => void>();
  private readonly o: Required<Omit<OpcoesCircuito, "contaComoFalha">> & Pick<OpcoesCircuito, "contaComoFalha">;
  readonly contadores = { sucessos: 0, falhas: 0, rejeitados: 0 };

  constructor(opcoes: OpcoesCircuito = {}) {
    this.o = {
      limiteFalhas: opcoes.limiteFalhas ?? 5,
      tempoResetMs: opcoes.tempoResetMs ?? 30_000,
      sucessosParaFechar: opcoes.sucessosParaFechar ?? 1,
      testesSimultaneos: opcoes.testesSimultaneos ?? 1,
      contaComoFalha: opcoes.contaComoFalha,
      nome: opcoes.nome ?? "padrao",
      now: opcoes.now ?? Date.now,
    };
    for (const k of ["limiteFalhas", "tempoResetMs", "sucessosParaFechar", "testesSimultaneos"] as const) {
      if (!(this.o[k] > 0)) throw new Error(`${k} precisa ser maior que zero`);
    }
  }

  /** Estado atual (passa de aberto pra meio-aberto sozinho quando o tempo de reset vence). */
  get estado(): EstadoCircuito {
    if (this._estado === "aberto" && this.o.now() - this.abertoEm >= this.o.tempoResetMs) this.mudar("meio-aberto");
    return this._estado;
  }

  /** Assina eventos. Retorna função pra cancelar. */
  on(ouvinte: (e: EventoCircuito) => void): () => void {
    this.ouvintes.add(ouvinte);
    return () => this.ouvintes.delete(ouvinte);
  }

  private emitir(e: EventoCircuito) {
    for (const o of this.ouvintes) {
      try {
        o(e);
      } catch {
        // ouvinte com erro não pode derrubar a chamada protegida
      }
    }
  }

  private mudar(para: EstadoCircuito) {
    const de = this._estado;
    if (de === para) return;
    this._estado = para;
    if (para === "aberto") this.abertoEm = this.o.now();
    if (para === "meio-aberto") this.sucessosMeioAberto = 0;
    if (para === "fechado") this.falhasSeguidas = 0;
    this.emitir({ tipo: "mudanca", de, para });
  }

  /** Executa fn protegida pelo disjuntor. Lança ErroCircuitoAberto se estiver aberto. */
  async executar<T>(fn: () => Promise<T>): Promise<T> {
    const estado = this.estado;
    if (estado === "aberto" || (estado === "meio-aberto" && this.testesEmAndamento >= this.o.testesSimultaneos)) {
      const retryEmMs = estado === "aberto" ? Math.max(0, this.o.tempoResetMs - (this.o.now() - this.abertoEm)) : 0;
      this.contadores.rejeitados++;
      this.emitir({ tipo: "rejeitado", retryEmMs });
      throw new ErroCircuitoAberto(this.o.nome, retryEmMs);
    }

    const teste = estado === "meio-aberto";
    if (teste) this.testesEmAndamento++;
    try {
      const r = await fn();
      this.registrarSucesso();
      return r;
    } catch (erro) {
      if (!this.o.contaComoFalha || this.o.contaComoFalha(erro)) this.registrarFalha(erro);
      else this.registrarSucesso();
      throw erro;
    } finally {
      if (teste) this.testesEmAndamento--;
    }
  }

  private registrarSucesso() {
    this.contadores.sucessos++;
    this.emitir({ tipo: "sucesso", estado: this._estado });
    if (this._estado === "meio-aberto") {
      if (++this.sucessosMeioAberto >= this.o.sucessosParaFechar) this.mudar("fechado");
    } else {
      this.falhasSeguidas = 0;
    }
  }

  private registrarFalha(erro: unknown) {
    this.contadores.falhas++;
    this.emitir({ tipo: "falha", estado: this._estado, erro });
    if (this._estado === "meio-aberto") return this.mudar("aberto");
    if (this._estado === "fechado" && ++this.falhasSeguidas >= this.o.limiteFalhas) this.mudar("aberto");
  }

  /** Força o fechamento (ex.: após deploy do fornecedor). */
  resetar() {
    this.mudar("fechado");
  }

  /** Força a abertura (ex.: manutenção programada do parceiro). */
  abrir() {
    if (this._estado === "aberto") this.abertoEm = this.o.now();
    this.mudar("aberto");
  }
}

export const criarCircuitBreaker = (opcoes: OpcoesCircuito = {}) => new CircuitBreaker(opcoes);
