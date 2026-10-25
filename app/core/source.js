// A data source. collect() never throws: a failure becomes status "missing" with a fixed note.
export class Source {
  id = '';
  label = '';

  constructor() { if (new.target === Source) throw new TypeError('Source is abstract'); }

  async collect(_ctx) { throw new Error('not implemented'); }
}

export async function guardSource(fn) {
  try { return await fn(); } catch (e) { return { status: 'missing', note: `Collector failed (${e?.code || e?.name || 'error'}).`, data: null }; }
}
