import { createClient, type Client } from "@libsql/client";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

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

// The application uses its local SQLite/libSQL database.
export async function executeRead(query: { sql: string; args?: (string | number | null)[] }) {
  return getClient().execute(query);
}

export async function executeSql(query: string | { sql: string; args?: (string | number | null)[] }) {
  const statement = typeof query === "string" ? { sql: query } : query;
  return getClient().execute(statement);
}

export function getDb(): AppDb {
  return drizzleLibsql(getClient(), { schema });
}
