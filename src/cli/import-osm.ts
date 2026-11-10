// Import Catholic church locations from OpenStreetMap for one area.
//
//   npm run import:osm -- --bbox 35.10,-80.95,35.35,-80.70 --country US --timezone America/New_York
//
// --bbox is south,west,north,east in degrees. Keep areas small (a metro area
// or a diocese): the public Overpass API is a shared, volunteer-run service.
// See https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances

import { parseArgs } from 'node:util';
import { openDatabase } from '../db/database.ts';
import { fetchOverpass, importOsmElements, OVERPASS_URL, type BBox } from '../importers/osm.ts';
import { CountryCodeSchema, TimeZoneSchema } from '../domain/model.ts';

const MAX_AREA_SQ_DEG = 4;

const { values } = parseArgs({
  options: {
    bbox: { type: 'string' },
    country: { type: 'string' },
    timezone: { type: 'string' },
    endpoint: { type: 'string', default: OVERPASS_URL },
    help: { type: 'boolean', short: 'h' },
  },
});

function usage(message?: string): never {
  if (message) console.error(`error: ${message}\n`);
  console.error(
    'usage: npm run import:osm -- --bbox <south,west,north,east> --country <CC> --timezone <IANA zone>\n' +
      'example: npm run import:osm -- --bbox 35.10,-80.95,35.35,-80.70 --country US --timezone America/New_York',
  );
  process.exit(message ? 2 : 0);
}

if (values.help) usage();
if (!values.bbox || !values.country || !values.timezone) usage('--bbox, --country and --timezone are required');

const parts = values.bbox.split(',').map(Number);
if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) usage('--bbox must be four numbers');
const [south, west, north, east] = parts as [number, number, number, number];
if (south >= north || west >= east) usage('--bbox must be south,west,north,east with south < north and west < east');
if ((north - south) * (east - west) > MAX_AREA_SQ_DEG) {
  usage(`--bbox is larger than ${MAX_AREA_SQ_DEG} square degrees; split it into smaller areas`);
}
const country = CountryCodeSchema.safeParse(values.country.toUpperCase());
if (!country.success) usage('--country must be an ISO 3166-1 alpha-2 code such as US');
const timezone = TimeZoneSchema.safeParse(values.timezone);
if (!timezone.success) usage('--timezone must be an IANA time zone such as America/New_York');

const bbox: BBox = { south, west, north, east };
console.log(`Querying Overpass (${values.endpoint}) for ${values.bbox} ...`);
const elements = await fetchOverpass(bbox, values.endpoint);
const db = openDatabase();
const stats = importOsmElements(db, elements, {
  countryCode: country.data,
  timezone: timezone.data,
  retrievedAt: new Date().toISOString(),
});
console.log('Done:', stats);
console.log('Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).');
db.close();
