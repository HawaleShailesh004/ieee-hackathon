Profile: ObservationCitizenOah
Parent: $oah-obs
Id: observation-citizen-oah
Title: "Observation: OAH citizen indicator"
Description: """A citizen-science observation that conforms to the OAH indicator profile and stays distinguishable from laboratory data.
The parent profile fixes status to final, so review state is carried in meta.tag and Provenance rather than Observation.status."""
* meta.tag ^slicing.discriminator.type = #value
* meta.tag ^slicing.discriminator.path = "system"
* meta.tag ^slicing.rules = #open
* meta.tag contains reviewState 1..1 MS
* meta.tag[reviewState].system 1..1
* meta.tag[reviewState].system = "https://hawaleshailesh004.github.io/ieee-hackathon/CodeSystem/citizen-review-state"
* meta.tag[reviewState].code 1..1
* meta.tag[reviewState] from CitizenReviewStateVs (required)
* category ^slicing.discriminator.type = #pattern
* category ^slicing.discriminator.path = "$this"
* category ^slicing.rules = #open
* category contains citizenScience 1..1 MS
* category[citizenScience] = OahDataSourceCs#citizen-science
* performer 1..1 MS
* performer.identifier 1..1 MS
* performer.identifier ^short = "Pseudonymous contributor ID (no personal data)"
* performer.reference 0..0
* derivedFrom 1..* MS
* derivedFrom only Reference(QuestionnaireResponse)
* derivedFrom ^short = "The QuestionnaireResponse this observation was extracted from"

Profile: ProvenanceCitizenOah
Parent: Provenance
Id: provenance-citizen-oah
Title: "Provenance: citizen observation lifecycle step"
Description: "One step in the life of a citizen observation. The chain of these resources is the observation's evidence history and must survive exchange."
* target 1..* MS
* activity 1..1 MS
* activity from CitizenProvenanceActivityVs (required)
* agent 1..* MS
* agent.type 1..1 MS
* agent.who.identifier MS
* entity MS
* reason MS
