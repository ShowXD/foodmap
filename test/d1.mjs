// Minimal D1-compatible wrapper over node:sqlite so tests run the real SQL from schema.sql.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const plain = (row) => (row ? { ...row } : null);

export function createTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return {
    sqlite,
    // Like D1: all statements in one transaction, rolled back together if any fails.
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let args = [];
      const bound = {
        bind(...values) {
          args = values;
          return bound;
        },
        async first() {
          return plain(statement.get(...args));
        },
        async all() {
          return { results: statement.all(...args).map(plain) };
        },
        async run() {
          const { changes, lastInsertRowid } = statement.run(...args);
          return { meta: { changes, last_row_id: Number(lastInsertRowid) } };
        },
      };
      return bound;
    },
  };
}
