import { createClient, type Client } from "@libsql/client";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";
import path from "path";
import fs from "fs";
import { readD1 } from "./d1-read";

const configuredUrl = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
const dataDir = path.join(process.cwd(), "data");

const localPath = path.join(dataDir, "macro.db");

const url = configuredUrl ?? `file:${localPath.replace(/\\/g, "/")}`;

let client: Client | null = null;

export function getClient(): Client {
  if (!client) {
    if (!configuredUrl && !fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    client = authToken
      ? createClient({ url, authToken })
      : createClient({ url });

    if (url.startsWith("file:")) {
      void client.execute("PRAGMA busy_timeout = 8000");
      void client.execute("PRAGMA journal_mode = WAL");
    }
  }

  return client;
}

export type AppDb = ReturnType<typeof drizzleLibsql>;

export function getD1Database(): D1Database | null {
  try {
    return getCloudflareContext().env.DB ?? null;
  } catch {
    return null;
  }
}

export async function executeRead(query: { sql: string; args?: (string | number | null)[] }) {
  const database = getD1Database();
  if (database) return readD1(database, query);
  return getClient().execute(query);
}

export async function executeSql(query: string | { sql: string; args?: (string | number | null)[] }) {
  const statement = typeof query === "string" ? { sql: query } : query;
  const database = getD1Database();
  if (!database) return getClient().execute(statement);
  const result = await database.prepare(statement.sql).bind(...(statement.args ?? [])).all();
  return { rows: result.results, rowsAffected: result.meta.changes };
}

export function getDb(): AppDb {
  try {
    const { env } = getCloudflareContext();

    if (env.DB) {
      return drizzleD1(env.DB, { schema }) as unknown as AppDb;
    }
  } catch {
    // Outside the Cloudflare/OpenNext runtime, use the local SQLite/libSQL database.
  }

  return drizzleLibsql(getClient(), { schema });
}
