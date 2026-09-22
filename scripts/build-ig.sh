#!/usr/bin/env bash
# Builds both FHIR packages from source:
#   fhir-packages/hl7.eu.fhir.oah-0.1.0-ci-build.tgz   (OAH IG, pinned submodule, with snapshots)
#   fhir-packages/oah.citizen-lane-0.1.0.tgz            (our citizen-lane extension)
# The OAH IG is compiled locally because its CI build on build.fhir.org is no longer published.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JAVA="${JAVA:-$(ls -d "$ROOT"/tools/jdk-17*/bin/java)}"  # override with JAVA=java
VALIDATOR="$ROOT/tools/validator_cli.jar"
mkdir -p "$ROOT/build"
OUT="$ROOT/fhir-packages"
mkdir -p "$OUT"

echo "== 1/5 Compile OAH IG (SUSHI)"
npx -y fsh-sushi@3 "$ROOT/vendor/oah-ig" > "$ROOT/build/sushi-oah.log" 2>&1 || { tail -30 "$ROOT/build/sushi-oah.log"; exit 1; }

echo "== 2/5 Generate OAH snapshots (HL7 validator, offline terminology)"
rm -rf "$ROOT/build/snap" && mkdir -p "$ROOT/build/snap"
cp "$ROOT"/vendor/oah-ig/fsh-generated/resources/StructureDefinition-*.json "$ROOT/build/snap/"
# Bare filenames on purpose: the validator splits paths containing spaces.
(cd "$ROOT/build/snap" && "$JAVA" -Dfile.encoding=UTF-8 -jar "$VALIDATOR" snapshot StructureDefinition-*.json \
  -version 4.0.1 -ig hl7.fhir.uv.xver-r5.r4#0.1.0 -ig "$ROOT/build/snap" -tx n/a \
  -outputSuffix snapshot.json > "$ROOT/build/snap.log" 2>&1) || { tail -30 "$ROOT/build/snap.log"; exit 1; }

echo "== 3/5 Install OAH package into the local FHIR package cache"
bash "$ROOT/scripts/install-oah-package.sh"

echo "== 4/5 Compile citizen-lane IG (SUSHI)"
npx -y fsh-sushi@3 "$ROOT/citizen-lane-ig" > "$ROOT/build/sushi-lane.log" 2>&1 || { tail -30 "$ROOT/build/sushi-lane.log"; exit 1; }
grep -q "0 Errors" "$ROOT/build/sushi-lane.log" || { tail -30 "$ROOT/build/sushi-lane.log"; exit 1; }

echo "== 5/5 Pack FHIR packages"
node "$ROOT/scripts/pack-packages.mjs" "$OUT"
