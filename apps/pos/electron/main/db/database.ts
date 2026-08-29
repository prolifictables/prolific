import Database from 'better-sqlite3';
import { migrations, TABLES_WITH_UPDATED_AT } from './migrations';

export class PosDatabase {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
  }

  prepare(sql: string): Database.Statement {
    return this.db.prepare(sql);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): () => T {
    return this.db.transaction(fn);
  }

  migrate(): { applied: number; from: number; to: number } {
    const fromVersion = this.getSchemaVersion();
    const targetVersion = migrations.length;
    let applied = 0;

    if (fromVersion >= targetVersion) {
      return { applied: 0, from: fromVersion, to: targetVersion };
    }

    for (let v = fromVersion + 1; v <= targetVersion; v++) {
      const migration = migrations.find((m) => m.version === v);
      if (!migration) continue;

      try {
        this.transaction(() => {
          migration.up(this.db);
        })();
        this.setMetaValue('schema_version', String(v));
        applied++;
      } catch (err) {
        const error = err as Error;
        throw new Error(
          `Migration v${v} failed: ${error.message}. Rolling back.`
        );
      }
    }

    this.registerUpdatedAtTriggers();

    return { applied, from: fromVersion, to: this.getSchemaVersion() };
  }

  getSchemaVersion(): number {
    try {
      const row = this.prepare(
        "SELECT value FROM meta WHERE id = 'schema_version'"
      ).get() as { value: string } | undefined;
      if (!row || !row.value) return 0;
      return parseInt(row.value, 10) || 0;
    } catch {
      return 0;
    }
  }

  setSchemaVersion(v: number): void {
    this.setMetaValue('schema_version', String(v));
  }

  setMetaValue(id: string, value: string | null): void {
    this.prepare(`
      INSERT INTO meta (id, value, updated_at)
      VALUES (?, ?, unixepoch('now')*1000)
      ON CONFLICT(id) DO UPDATE SET
        value = excluded.value,
        updated_at = unixepoch('now')*1000
    `).run(id, value);
  }

  getMetaValue(id: string): string | null {
    const row = this.prepare('SELECT value FROM meta WHERE id = ?').get(id) as
      | { value: string | null }
      | undefined;
    return row ? row.value : null;
  }

  private registerUpdatedAtTriggers(): void {
    const dropStmts: string[] = [];
    const createStmts: string[] = [];

    for (const table of TABLES_WITH_UPDATED_AT) {
      const triggerName = `trg_${table}_updated_at`;
      dropStmts.push(`DROP TRIGGER IF EXISTS ${triggerName};`);
      createStmts.push(`
        CREATE TRIGGER IF NOT EXISTS ${triggerName}
        AFTER UPDATE ON ${table}
        FOR EACH ROW
        WHEN NEW.updated_at = OLD.updated_at OR NEW.updated_at IS NULL
        BEGIN
          UPDATE ${table}
          SET updated_at = unixepoch('now')*1000
          WHERE rowid = NEW.rowid;
        END;
      `);
    }

    this.exec(dropStmts.join('\n'));
    this.exec(createStmts.join('\n'));
  }

  run(sql: string, ...params: unknown[]): Database.RunResult {
    return this.prepare(sql).run(...params);
  }

  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  }

  all<T = unknown>(sql: string, ...params: unknown[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  }

  close(): void {
    this.db.close();
  }
}
