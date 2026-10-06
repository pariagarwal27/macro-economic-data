export async function readD1(
  database: D1Database,
  query: { sql: string; args?: (string | number | null)[] },
) {
  const result = await database.prepare(query.sql).bind(...(query.args ?? [])).all();
  return { rows: result.results };
}
