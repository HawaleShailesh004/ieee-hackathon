#!/usr/bin/env bash
# Validates FHIR resources against the OAH IG + citizen-lane IG with the official HL7 validator.
# Usage: scripts/validate.sh <file>...   (defaults to build/spike/[0-9]*.json)
# Runs with -tx n/a: codes in OAH and citizen-lane CodeSystems are checked locally;
# codes needing an external terminology server (e.g. SNOMED CT) are not.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JAVA="${JAVA:-$(ls -d "$ROOT"/tools/jdk-17*/bin/java)}"  # override with JAVA=java
[ $# -eq 0 ] && set -- "$ROOT"/build/spike/[0-9]*.json

# OAH Location examples, so references such as Location/Loc-Almyros resolve during validation.
LOCS="$ROOT/build/oah-locations"
mkdir -p "$LOCS"
cp "$ROOT"/vendor/oah-ig/fsh-generated/resources/Location-*.json "$LOCS/"

"$JAVA" -Dfile.encoding=UTF-8 -jar "$ROOT/tools/validator_cli.jar" "$@" \
  -version 4.0.1 \
  -tx n/a \
  -ig hl7.fhir.uv.sdc#3.0.0 \
  -ig hl7.eu.fhir.oah#0.1.0-ci-build \
  -ig "$ROOT/citizen-lane-ig/fsh-generated/resources" \
  -ig "$LOCS" \
  -output "${VALIDATION_OUT:-$ROOT/build/validation.json}" \
  2>&1 | grep -v -E 'WARNING: Default file encoding|file.encoding=UTF-8'
