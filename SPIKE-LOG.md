# Spike log: one citizen assessment, end to end

Goal: prove that one citizen stream assessment can be mapped, validated against the real
OneAquaHealth (OAH) FHIR profiles, and exchanged between two systems with its history intact,
before building any UI.

## Go/no-go checks

| # | Check | Status (22 Sep) |
|---|---|---|
| 1 | Compile the OAH IG from source | PASS. SUSHI 0 errors / 0 warnings; 385 Observations, 19 Locations, 45 Groups, 17 Libraries |
| 2 | HL7 validator runs against OAH + citizen-lane profiles | PASS. Validator 6.10.4 on a portable JDK 17; OAH snapshots generated locally (`build/snap`) |
| 3 | One Questionnaire answer set becomes valid Observations + Provenance | PASS. 1 QuestionnaireResponse, 5 Observations, 2 Provenance: 0 errors. 4 negative controls each fail for the intended reason (`build/spike-negative`) |
| 4 | Two local FHIR servers; export from A, import into B with history intact | PASS (22 Sep). Two HAPI 8.12 servers run from the starter WAR (no Docker). 5 Observations, review states and 13 Provenance records survive the exchange (`lane/src/exchange-spike.mjs`) |
| 5 | Official citizen assessment protocol | Not obtained; form uses a reconstructed field set |

## Findings

- **The organizers' hosted infrastructure is unreliable.** On 18 Sep the sandbox
  (`sandbox.hl7europe.eu/oneaquahealth/fhir`) answered with 385 Observations, 0 Questionnaire and
  0 Provenance. On 22 Sep it timed out, and the CI-published IG (`build.fhir.org/ig/hl7-eu/oah/`)
  returned 404. We therefore build the IG from source (`vendor/oah-ig`) and run everything locally.
  The locally compiled IG contains the same 385 Observations and 19 Locations.
- **`ObservationIndicatorsOah` fixes `status = final`.** An unreviewed citizen report cannot use
  `preliminary`, so the review state is carried in `meta.tag` (current state) and a Provenance chain
  (history).
- **The IG already defines citizen-friendly codes that no example uses**: `#foam` (foam/colour/smell),
  riparian vegetation (`#trees`, `#bushes`, `#herbaceous` with 0-20% ... 81-100% bands),
  `#macrophytes` with absent/present/extensive, `#invasiveOrganisms` with non-native-species values.
  The Questionnaire uses only these codes.
- **Lab data is `category = laboratory`.** Citizen observations get `category = citizen-science`
  (our code system), so the two stay separable with a plain FHIR search.
- **`performer` is required but unconstrained.** Citizens are recorded as a pseudonymous
  `performer.identifier` with no resolvable reference, so no personal data leaves the device.

## Reproducing checks 1-3

```bash
npx fsh-sushi@3 vendor/oah-ig                 # compile the OAH IG
# generate OAH snapshots into build/snap (validator `snapshot` command with -tx n/a), then:
bash scripts/install-oah-package.sh           # install as hl7.eu.fhir.oah#0.1.0-ci-build
npx fsh-sushi@3 citizen-lane-ig               # compile our extension IG
node lane/src/spike.mjs                       # extract one assessment -> build/spike, build/spike-negative
bash scripts/validate.sh build/spike/[0-9]*.json build/spike-negative/*.json
python scripts/summarize-validation.py
```

Tooling notes:
- The validator hangs when it tries to reach the remote terminology server; run it with `-tx n/a`.
  Codes in the OAH and citizen-lane CodeSystems are still checked locally; UCUM and SNOMED codes are not.
- The validator rejects `example.org` identifier systems. Contributor IDs therefore use
  `system = urn:ietf:rfc:3986` with an opaque `urn:uuid:` value.
- The first validator run downloads ~4,500 FHIR example resources (about 10 minutes); later runs take ~3 minutes.

## Caveats to state in the submission

- Review states are proposed workflow states, not validated confidence levels.
- The Questionnaire field set is reconstructed from the public citizen-science page and the IG's
  own codes, pending the official app protocol.
- The citizen-lane artifacts are a hackathon proposal, not official OAH or HL7 Europe artifacts.

## Check 4 findings

- **HAPI skips `draft` resources when installing a package.** Both IGs are drafts, so
  `validate_resource_status_for_package_upload: false` is required, or no profile is installed.
- **HAPI's search cache silently dropped review history.** An identical Provenance search within 60 s was
  answered from cache, so the exchange sent history without the review step. The client now sends
  `Cache-Control: no-cache`, the servers set `reuse_cached_search_results_millis: 0`, and verification checks
  that a decided report carries its review step.
- **References must resolve on the receiving server.** The exchange also sends each Location's `partOf`
  parents, and the lab records (with their device) that an automated check cited as evidence.
