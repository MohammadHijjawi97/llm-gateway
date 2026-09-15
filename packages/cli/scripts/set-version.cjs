#!/usr/bin/env node
/**
 * Stamps one version onto BOTH packages/cli/package.json and src/version.ts.
 *
 * The CLI's version tracks the Manifest release it ships with, so there is no
 * separate changeset target for it (`@mnfst/gateway-cli` stays in the
 * `.changeset/config.json` ignore list). The release workflow calls this with
 * the version from packages/manifest/package.json before building and packing.
 *
 * Three files carry the version and must move together, or the next test run
 * turns red: index.spec.ts pins src/version.ts to package.json, and
 * skill-content.spec.ts pins the generated SKILL_VERSION to package.json too.
 * (`npm run gen` also rewrites the generated file, but it needs manifest-shared
 * built; this script deliberately does not, so it can run in the version PR.)
 *
 * Usage:
 *   node scripts/set-version.cjs            # read packages/manifest/package.json
 *   node scripts/set-version.cjs 6.24.0     # explicit
 */
const fs = require('fs');
const path = require('path');

const CLI_DIR = path.join(__dirname, '..');
const PKG_PATH = path.join(CLI_DIR, 'package.json');
const VERSION_TS_PATH = path.join(CLI_DIR, 'src', 'version.ts');
const SKILL_GEN_PATH = path.join(CLI_DIR, 'src', 'skill-content.gen.ts');
const MANIFEST_PKG_PATH = path.join(CLI_DIR, '..', 'manifest', 'package.json');

// Same shape changesets produces: no pre-release or build metadata is expected
// here, and accepting one silently would publish an npm tag nobody asked for.
const SEMVER = /^\d+\.\d+\.\d+$/;

function resolveVersion(argv) {
  const explicit = argv[0];
  if (explicit) return explicit;
  const manifestPkg = JSON.parse(fs.readFileSync(MANIFEST_PKG_PATH, 'utf8'));
  return manifestPkg.version;
}

function stampPackageJson(version) {
  const raw = fs.readFileSync(PKG_PATH, 'utf8');
  const pkg = JSON.parse(raw);
  pkg.version = version;
  // Trailing newline keeps the file byte-identical to what Prettier writes.
  fs.writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
}

function stampVersionTs(version) {
  const raw = fs.readFileSync(VERSION_TS_PATH, 'utf8');
  const pattern = /^export const VERSION = '[^']*';$/m;
  if (!pattern.test(raw)) {
    throw new Error(
      `Could not find the VERSION declaration in ${VERSION_TS_PATH}. ` +
        'Update set-version.cjs if the declaration was reformatted.',
    );
  }
  fs.writeFileSync(VERSION_TS_PATH, raw.replace(pattern, `export const VERSION = '${version}';`));
}

function stampSkillVersion(version) {
  const raw = fs.readFileSync(SKILL_GEN_PATH, 'utf8');
  const pattern = /^export const SKILL_VERSION = '[^']*';$/m;
  if (!pattern.test(raw)) {
    throw new Error(
      `Could not find the SKILL_VERSION declaration in ${SKILL_GEN_PATH}. ` +
        'Update set-version.cjs if generate-skill-content.cjs changed its output.',
    );
  }
  fs.writeFileSync(
    SKILL_GEN_PATH,
    raw.replace(pattern, `export const SKILL_VERSION = '${version}';`),
  );
}

function main(argv) {
  const version = resolveVersion(argv);
  if (!SEMVER.test(version)) {
    throw new Error(`Refusing to stamp a non-semver version: ${JSON.stringify(version)}`);
  }
  stampPackageJson(version);
  stampVersionTs(version);
  stampSkillVersion(version);
  console.log(
    `Stamped @mnfst/gateway-cli ${version} onto package.json, src/version.ts and src/skill-content.gen.ts`,
  );
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }
}

module.exports = { resolveVersion, stampPackageJson, stampVersionTs, stampSkillVersion, main };
