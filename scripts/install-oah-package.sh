#!/usr/bin/env bash
# Installs the locally SUSHI-compiled OAH IG into the FHIR package cache as
# hl7.eu.fhir.oah#0.1.0-ci-build, because build.fhir.org no longer serves it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/vendor/oah-ig/fsh-generated/resources"
DEST="$HOME/.fhir/packages/hl7.eu.fhir.oah#0.1.0-ci-build/package"
rm -rf "$(dirname "$DEST")"
mkdir -p "$DEST/example"
SNAP="$ROOT/build/snap"   # StructureDefinitions with snapshots (see README: "Rebuilding the OAH package")
for f in "$SRC"/*.json; do
  name="$(basename "$f")"
  case "$name" in
    StructureDefinition-*)
      snap="$SNAP/$name.snapshot.json"
      [ -f "$snap" ] || { echo "Missing snapshot $snap; generate snapshots first" >&2; exit 1; }
      cp "$snap" "$DEST/$name" ;;
    ValueSet-*|CodeSystem-*|ConceptMap-*|ImplementationGuide-*) cp "$f" "$DEST/" ;;
    *) cp "$f" "$DEST/example/" ;;
  esac
done
cat > "$DEST/package.json" <<JSON
{
  "name": "hl7.eu.fhir.oah",
  "version": "0.1.0-ci-build",
  "canonical": "http://hl7.eu/fhir/ig/oah",
  "fhirVersions": ["4.0.1"],
  "type": "IG",
  "dependencies": { "hl7.fhir.r4.core": "4.0.1", "hl7.fhir.uv.xver-r5.r4": "0.1.0" }
}
JSON
echo "Installed $(ls "$DEST" | wc -l) conformance files, $(ls "$DEST/example" | wc -l) examples -> $DEST"
