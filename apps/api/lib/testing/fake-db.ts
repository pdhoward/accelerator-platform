/**
 * Test-only: a small in-memory stand-in for `./supabase` (`db()` and `rows()`),
 * enough for the API's query shapes: filters (eq, neq, in, is, gte), order,
 * limit, insert/update/delete with `.select().single()`, and the column
 * defaults the real tables fill in. Use from a test with:
 *
 *   vi.mock("./supabase", async () => (await import("./testing/fake-db")).fakeSupabase);
 */

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export const fakeDb = { tables: {} as Record<string, Row[]>, seq: 0, storage: {} as Record<string, Buffer> };

/** Reset between tests, optionally seeding tables. */
export function resetFakeDb(tables: Record<string, Row[]> = {}) {
  fakeDb.tables = tables;
  fakeDb.seq = 100;
  fakeDb.storage = {};
}

/** A table's rows (created on first use). */
export const table = (name: string) => (fakeDb.tables[name] ??= []);

const DEFAULTS: Record<string, Row> = { acc_jobs: { status: "queued" }, acc_work_steps: { status: "todo" } };

function query(name: string) {
  const filters: Filter[] = [];
  let op: { kind: "select" } | { kind: "update"; value: Row } | { kind: "insert"; value: Row | Row[] } | { kind: "delete" } = { kind: "select" };
  let max = Infinity;
  let sort: { col: string; asc: boolean } | null = null;
  const matching = () => table(name).filter((r) => filters.every((f) => f(r)));
  const run = (): Row[] => {
    if (op.kind === "insert") {
      const added = (Array.isArray(op.value) ? op.value : [op.value]).map((v) => ({
        id: `${name}-${++fakeDb.seq}`,
        created_at: new Date(Date.now() + fakeDb.seq).toISOString(),
        ...DEFAULTS[name],
        ...v,
      }));
      table(name).push(...added);
      return added;
    }
    if (op.kind === "update") {
      const hit = matching();
      for (const r of hit) Object.assign(r, op.value);
      return hit;
    }
    if (op.kind === "delete") {
      fakeDb.tables[name] = table(name).filter((r) => !filters.every((f) => f(r)));
      return [];
    }
    let out = matching();
    if (sort) {
      const { col, asc } = sort;
      out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
    return out.slice(0, max);
  };
  const q = {
    table: name,
    run,
    select: () => q,
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
    is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
    gte: (c: string, v: unknown) => (filters.push((r) => r[c] == null || String(r[c]) >= String(v)), q),
    lt: (c: string, v: unknown) => (filters.push((r) => r[c] != null && String(r[c]) < String(v)), q),
    not: (c: string, op: string, v: unknown) => (filters.push((r) => (op === "is" && v === null ? r[c] != null : r[c] !== v)), q),
    order: (col: string, o?: { ascending?: boolean }) => ((sort = { col, asc: o?.ascending !== false }), q),
    limit: (n: number) => ((max = n), q),
    single: () => q,
    update: (value: Row) => ((op = { kind: "update", value }), q),
    insert: (value: Row | Row[]) => ((op = { kind: "insert", value }), q),
    delete: () => ((op = { kind: "delete" }), q),
    upsert: () => q,
    then: (resolve: (v: unknown) => unknown) => {
      const data = run();
      const single = op.kind === "insert" && !Array.isArray((op as { value: unknown }).value);
      return resolve({ data: single ? data[0] : data, error: null, count: data.length });
    },
  };
  return q;
}

/** Object storage: one bucket's files by path. */
const storage = {
  from: (bucket: string) => ({
    upload: async (path: string, body: Buffer) => ((fakeDb.storage[`${bucket}/${path}`] = Buffer.from(body)), { data: { path }, error: null }),
    remove: async (paths: string[]) => {
      for (const p of paths) delete fakeDb.storage[`${bucket}/${p}`];
      return { data: paths, error: null };
    },
  }),
};

export const fakeSupabase = {
  db: () => ({ from: query, storage }),
  rows: async (q: { run: () => Row[] }) => q.run(),
};
