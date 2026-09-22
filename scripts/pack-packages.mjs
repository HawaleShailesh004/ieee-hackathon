// Packs the installed OAH package and the compiled citizen-lane IG as FHIR NPM packages (.tgz)
// so HAPI FHIR can load them as implementation guides.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(root, 'fhir-packages');
const staging = join(root, 'build', 'pack-staging');
mkdirSync(out, { recursive: true });

function pack(name, version, fill) {
  const dir = join(staging, `${name}-${version}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'package'), { recursive: true });
  fill(join(dir, 'package'));
  const file = join(out, `${name}-${version}.tgz`);
  // Relative paths only: GNU tar treats "D:\..." as a remote host.
  execFileSync('tar', ['-czf', relative(dir, file), 'package'], { cwd: dir });
  console.log(`Packed ${file}`);
}

// OAH: already assembled (with snapshots) in the local package cache by install-oah-package.sh.
pack('hl7.eu.fhir.oah', '0.1.0-ci-build', (dest) => {
  const src = join(homedir(), '.fhir', 'packages', 'hl7.eu.fhir.oah#0.1.0-ci-build', 'package');
  for (const f of readdirSync(src)) if (f.endsWith('.json')) cpSync(join(src, f), join(dest, f));
});

// Citizen lane: SUSHI output plus a package manifest.
const lane = join(root, 'citizen-lane-ig', 'fsh-generated', 'resources');
const config = readFileSync(join(root, 'citizen-lane-ig', 'sushi-config.yaml'), 'utf8');
const field = (key) => config.match(new RegExp(`^${key}:\\s*(\\S+)`, 'm'))[1];
pack(field('id'), field('version'), (dest) => {
  for (const f of readdirSync(lane)) cpSync(join(lane, f), join(dest, f));
  writeFileSync(join(dest, 'package.json'), JSON.stringify({
    name: field('id'),
    version: field('version'),
    canonical: field('canonical'),
    fhirVersions: ['4.0.1'],
    type: 'IG',
    dependencies: {
      'hl7.fhir.r4.core': '4.0.1',
      'hl7.eu.fhir.oah': '0.1.0-ci-build',
      'hl7.fhir.uv.sdc': '3.0.0',
    },
  }, null, 2));
});

// OAH example data (Locations, lab Observations, cohort Groups, ...) as one Bundle for scripts/seed.mjs,
// so a fresh clone can seed the demo without compiling the IG.
const examplesDir = join(root, 'vendor', 'oah-ig', 'fsh-generated', 'resources');
const CONFORMANCE = /^(StructureDefinition|ValueSet|CodeSystem|ConceptMap|ImplementationGuide)-/;
const examples = readdirSync(examplesDir)
  .filter((f) => f.endsWith('.json') && !CONFORMANCE.test(f))
  .sort()
  .map((f) => ({ resource: JSON.parse(readFileSync(join(examplesDir, f), 'utf8')) }));
writeFileSync(join(out, 'oah-example-data.json'), JSON.stringify({
  resourceType: 'Bundle',
  type: 'collection',
  entry: examples,
}));
console.log(`Wrote ${examples.length} OAH example resources to ${join(out, 'oah-example-data.json')}`);
