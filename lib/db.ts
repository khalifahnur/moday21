import postgres from "postgres";
import { env } from "./env";

// One shared connection pool per server instance.
// prepare: false keeps it compatible with Supabase's connection pooler.
const globalForDb = globalThis as unknown as { __monday21Sql?: postgres.Sql };

export function db(): postgres.Sql {
  if (!globalForDb.__monday21Sql) {
    globalForDb.__monday21Sql = postgres(env().DATABASE_URL, {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return globalForDb.__monday21Sql;
}
