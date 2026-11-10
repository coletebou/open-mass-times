// Create the database if needed and apply pending migrations.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_DATABASE_PATH, migrate } from '../db/database.ts';

const path = process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);
db.exec('PRAGMA foreign_keys = ON');
const applied = migrate(db);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
db.close();
