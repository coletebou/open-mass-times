// Validate a data file (see DataFileSchema) and load it into the database.
//
//   npm run db:seed:sample
//   node src/cli/seed.ts path/to/file.json
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { openDatabase } from '../db/database.ts';
import { loadDataFile } from '../db/repository.ts';
import { DataFileSchema } from '../domain/model.ts';

const file = process.argv[2];
if (!file) {
  console.error('usage: node src/cli/seed.ts <data-file.json>');
  process.exit(2);
}
const parsed = DataFileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
if (!parsed.success) {
  console.error(`${file} is not a valid data file:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}
const db = openDatabase();
const counts = loadDataFile(db, parsed.data);
console.log(`Loaded ${file}:`, counts);
db.close();
