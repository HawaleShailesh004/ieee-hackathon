# Streams to Systems: a citizen lane for the OneAquaHealth FHIR IG

A citizen reports foam and a warm reading at a stream. The report reaches the regional health authority as
standards-conformant evidence that is clearly marked as a citizen report. It shows how it was checked and who
reviewed it, and it sits next to 12 years of lab data from the same stream.

Built for the OneAquaHealth IEEE Hackathon 2026, Track 7. This is a hackathon proposal, not an official
OneAquaHealth or HL7 Europe artifact.

## The problem

Citizen science could multiply the monitoring coverage of small streams, but authorities rarely use it:
the data arrives in ad-hoc formats with no record of how it was checked. The
[OneAquaHealth FHIR IG](https://github.com/hl7-eu/oah) has profiles and 12 years of real lab data for sites
such as the Almyros stream in Crete, but no way to record a citizen observation or its review.

## What it does

1. **Citizen (phone).** A plain-language form, driven by a FHIR Questionnaire, asks only about things a
   person can see: foam, bank vegetation, water plants, invasive species, and temperature if they have a
   thermometer. Optionally, an AI model suggests answers from a free-text note. The citizen confirms each
   suggestion, and that confirmation is recorded. No name or account is needed; contributors are
   pseudonymous `urn:uuid` identifiers.
2. **Automatic check.** Answers become OAH-profiled Observations. Each one is validated with `$validate` on a
   real FHIR server before it is stored. Plausibility rules compare it with the site's lab history (for
   example, 31.5 °C against Almyros readings of 16.1 and 16.2 °C). These rules flag reports for review;
   they are not an ecological assessment.
3. **City reviewer.** Sees each report next to the lab record for the same indicator, then accepts it,
   rejects it or requests follow-up, with a required reason.
4. **Exchange and verification.** Reviewed reports move from the city FHIR server to a separate
   health-authority FHIR server with their full history. The receiving side checks each report against the
   city's copy: same answer, same review decision, still marked as citizen data, same pseudonymous
   contributor, and every history step present.
   Below the received reports, the health authority also sees the population health measures it already
   holds in the same OAH format (Benevento and Nordre Aker, from the IG). They are different places from the
   streams, and the page says no link between them is implied.

Every step writes a `Provenance` record (capture, AI suggestion, extraction, automated check, expert review,
exchange import). The current review state is a `meta.tag`.

## Architecture

```
 Citizen (mobile web)          City reviewer                     Health authority
        │ QuestionnaireResponse       │ accept / reject / follow-up        ▲ verification
        ▼                             ▼                                    │
 ┌───────────────────────────────────────────────────────────────────────────────┐
 │ lane-service (Node 22, Fastify) + web app (React, Vite)          :8090        │
 │ extract → $validate → store → check → review → exchange → verify              │
 └───────────────┬───────────────────────────────────────────────┬──────────────┘
                 ▼                                               ▼
   HAPI FHIR "city" (A)  :8081                     HAPI FHIR "health" (B)  :8082
   OAH IG + citizen-lane IG loaded                 OAH IG + citizen-lane IG loaded
   real OAH Locations and lab Observations         receives evidence with its history
```

| Path | Contents |
|---|---|
| `citizen-lane-ig/` | FSH source of the extension IG: `ObservationCitizenOah`, `ProvenanceCitizenOah`, the Questionnaire, and the review-state and data-source code systems |
| `fhir-packages/` | Built FHIR packages (OAH IG with snapshots, citizen lane) and the OAH example data used as seed |
| `lane/` | lane-service: extraction, checks, review, exchange, verification (`src/workflow.mjs`) |
| `web/` | The three views: citizen, reviewer, health authority |
| `vendor/oah-ig` | The OAH IG source, pinned as a git submodule |
| `servers/hapi-overrides.yaml` | HAPI configuration shared by both servers |

## Run it

**With Docker (one command):**

```bash
git clone --recursive https://github.com/HawaleShailesh004/ieee-hackathon.git
cd ieee-hackathon
docker compose up --build
```

Open <http://localhost:8090>. The first start takes 2–3 minutes while both FHIR servers load the IGs.
The data is in memory, so every restart is a clean demo.

**Without Docker:** you need JDK 17 in `tools/jdk-17*`, a HAPI FHIR starter build in
`tools/hapi-src/target/ROOT.war` (tag `image/v8.12.0-1`, built with `mvn package spring-boot:repackage -Pboot`),
and Node 22.

```bash
bash scripts/demo-reset.sh                       # start both FHIR servers and seed the OAH data
(cd web && npm ci && npm run build)
(cd lane && npm ci && npm start)                 # http://localhost:8090
```

**Optional AI suggestions:** copy `.env.example` to `.env` and set `OPENAI_API_KEY` (an OpenAI key, or an
OpenRouter key with `OPENAI_BASE_URL`) and `OPENAI_MODEL`. Without a key, the form works and the
suggestion button is hidden.

## Proof that it conforms

CI (`.github/workflows/ci.yml`) runs on every push:

- **Conformance:** builds both IGs from source with SUSHI, then runs the official HL7 validator. The extracted
  QuestionnaireResponse, Observations and Provenance must have 0 errors against the OAH and citizen-lane
  profiles. Four negative controls must each be rejected: an identifiable performer, a missing citizen-science
  category, `status = preliminary`, and an unknown review state.
- **End to end:** starts the Docker stack, then submits, checks, reviews and exchanges one assessment between
  the two FHIR servers and verifies its history on the receiving side (`lane/src/exchange-spike.mjs`).
- **Unit tests** for extraction (`lane/test`) and a type-checked web build.

To run the validator locally: `node lane/src/spike.mjs && bash scripts/validate.sh && python scripts/summarize-validation.py --expect valid`.

## Design findings

- **`ObservationIndicatorsOah` fixes `status = final`.** An unreviewed citizen report cannot be
  `preliminary`, so the review state is carried in `meta.tag` (current state) and in the Provenance chain
  (history).
- **The IG already defines citizen-friendly codes that no example uses:** `foam`, riparian vegetation cover
  bands, `macrophytes` and `invasiveOrganisms`. The Questionnaire uses only these codes.
- **Citizen and lab data stay separable with a plain FHIR search:** lab data is `category = laboratory`;
  citizen data gets `category = citizen-science`.
- **The OAH IG's CI build is no longer published** on build.fhir.org, and the hosted sandbox was unreliable
  during the hackathon. The IG is therefore compiled from source and everything runs locally.

## Caveats

- The form's field set is reconstructed from the public OneAquaHealth citizen-science material and the IG's
  own codes. It has not been checked against the official assessment protocol.
- Review states are a proposed workflow, not validated confidence levels.
- Plausibility rules are simple, configurable prompts for a reviewer. They do not diagnose pollution.
- The validator runs with `-tx n/a`: codes in the OAH and citizen-lane code systems are checked; SNOMED CT and
  UCUM codes are not.
- Lab data shown is the OAH IG's published example data.
