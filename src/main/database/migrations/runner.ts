import { getDb } from '../index';
import fs from 'fs';
import path from 'path';

export interface Migration {
  id: string;
  description: string;
  up: (db: ReturnType<typeof getDb>) => void;
  down?: (db: ReturnType<typeof getDb>) => void;
}

const MIGRATIONS_TABLE = 'schema_migrations';

function ensureMigrationsTable(db: ReturnType<typeof getDb>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function getAppliedMigrations(db: ReturnType<typeof getDb>): Set<string> {
  ensureMigrationsTable(db);
  const rows = db.prepare(`SELECT id FROM ${MIGRATIONS_TABLE}`).all() as Array<{ id: string }>;
  return new Set(rows.map(r => r.id));
}

function recordMigration(db: ReturnType<typeof getDb>, id: string, description: string): void {
  ensureMigrationsTable(db);
  db.prepare(
    `INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (id, description) VALUES (?, ?)`
  ).run(id, description);
}

function loadMigrationsFromDirectory(migrationsDir: string): Migration[] {
  if (!fs.existsSync(migrationsDir)) return [];

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.ts') || f.endsWith('.js'))
    .sort();

  const migrations: Migration[] = [];
  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    try {
      const mod = require(filePath);
      if (mod.default && typeof mod.default === 'object' && 'id' in mod.default && 'up' in mod.default) {
        migrations.push(mod.default as Migration);
      }
    } catch (err) {
      console.warn(`[migrations] Failed to load ${file}:`, err);
    }
  }
  return migrations;
}

export function runMigrations(migrations: Migration[], migrationsDir?: string): void {
  const db = getDb();
  ensureMigrationsTable(db);

  const applied = getAppliedMigrations(db);

  let allMigrations = [...migrations];

  if (migrationsDir) {
    allMigrations = [...allMigrations, ...loadMigrationsFromDirectory(migrationsDir)];
  }

  allMigrations.sort((a, b) => a.id.localeCompare(b.id));

  const pending = allMigrations.filter(m => !applied.has(m.id));
  if (pending.length === 0) return;

  console.log(`[migrations] Running ${pending.length} pending migration(s)...`);

  for (const migration of pending) {
    console.log(`[migrations] Applying: ${migration.id} - ${migration.description}`);
    try {
      const tx = db.transaction(() => {
        migration.up(db);
        recordMigration(db, migration.id, migration.description);
      });
      tx();
    } catch (err: any) {
      console.error(`[migrations] Failed to apply ${migration.id}:`, err?.message);
      throw err;
    }
  }

  console.log(`[migrations] All migrations applied successfully.`);
}

export function rollbackMigration(migration: Migration): void {
  if (!migration.down) {
    throw new Error(`Migration ${migration.id} has no down function`);
  }
  const db = getDb();
  const tx = db.transaction(() => {
    migration.down!(db);
    db.prepare(`DELETE FROM ${MIGRATIONS_TABLE} WHERE id = ?`).run(migration.id);
  });
  tx();
}
