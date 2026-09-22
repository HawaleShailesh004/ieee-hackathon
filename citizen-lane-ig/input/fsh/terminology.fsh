CodeSystem: OahDataSourceCs
Id: oah-data-source
Title: "OAH data source"
Description: "Who produced an OAH observation. Lets consumers keep citizen reports distinct from laboratory and sensor data."
* ^caseSensitive = true
* ^experimental = true
* #citizen-science "Citizen science" "Observation made by a volunteer contributor using a structured protocol."

CodeSystem: CitizenReviewStateCs
Id: citizen-review-state
Title: "Citizen observation review state"
Description: """Proposed workflow states for a citizen observation. These describe where the observation is in the review workflow. They are NOT validated confidence levels."""
* ^caseSensitive = true
* ^experimental = true
* #unreviewed "Unreviewed" "Submitted by the contributor; nobody has checked it yet."
* #auto-checked "Automatically checked" "Passed or failed automated plausibility checks; no human review yet."
* #accepted "Accepted by reviewer" "A reviewer judged the observation usable for follow-up."
* #rejected "Rejected by reviewer" "A reviewer judged the observation unusable. Kept for audit."
* #needs-follow-up "Needs field follow-up" "A reviewer requested a professional visit or sample."

ValueSet: CitizenReviewStateVs
Id: citizen-review-state-vs
Title: "Citizen observation review state"
Description: "All citizen review states."
* ^experimental = true
* include codes from system CitizenReviewStateCs

CodeSystem: CitizenProvenanceActivityCs
Id: citizen-provenance-activity
Title: "Citizen observation lifecycle activity"
Description: "Steps in the life of a citizen observation, recorded as Provenance.activity."
* ^caseSensitive = true
* ^experimental = true
* #capture "Captured" "Contributor completed the assessment questionnaire."
* #ai-code-suggestion "AI code suggestion" "An AI model suggested coded answers from free text; the contributor had to confirm them."
* #extraction "Extraction" "QuestionnaireResponse answers were extracted into OAH Observations."
* #automated-check "Automated check" "Rule-based plausibility check against site history."
* #expert-review "Expert review" "A human reviewer changed the review state."
* #exchange-import "Exchange import" "Observation was imported into another system with its history."

ValueSet: CitizenProvenanceActivityVs
Id: citizen-provenance-activity-vs
Title: "Citizen observation lifecycle activity"
Description: "All citizen lifecycle activities."
* ^experimental = true
* include codes from system CitizenProvenanceActivityCs
