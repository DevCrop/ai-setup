// One collection round: results of every Source by id, plus the paths the checks and fixes need (never env or secrets).
export class Snapshot {
  constructor({ generatedAt, sources, ctx = {} }) {
    this.generatedAt = generatedAt;
    this.sources = sources;
    this.ctx = { repo: ctx.repo ?? null, homes: ctx.homes ?? {}, autoUpdate: ctx.autoUpdate ?? null };
  }

  get(id) { return this.sources?.[id] ?? null; }
}
