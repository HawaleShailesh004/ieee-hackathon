// Field set reconstructed from the public OneAquaHealth citizen-science page
// (water appearance, riparian vegetation, invasive species, signs of pollution)
// and restricted to codes that already exist in the OAH IG. Pending confirmation
// against the official app protocol.

RuleSet: PresenceOptions
* answerOption[0].valueCoding = $oah-cs#absent "Absent"
* answerOption[1].valueCoding = $oah-cs#present "Present"
* answerOption[2].valueCoding = $oah-cs#extensive "Extensive"

RuleSet: CoverOptions
* answerOption[0].valueCoding = $oah-cs#0-20-percent "0-20%"
* answerOption[1].valueCoding = $oah-cs#21-40-percent "21-40%"
* answerOption[2].valueCoding = $oah-cs#41-60-percent "41-60%"
* answerOption[3].valueCoding = $oah-cs#61-80-percent "61-80%"
* answerOption[4].valueCoding = $oah-cs#81-100-percent "81-100%"

RuleSet: Extract
* extension[+].url = $sdc-obs-extract
* extension[=].valueBoolean = true

Instance: CitizenStreamAssessmentOah
InstanceOf: Questionnaire
Title: "OAH citizen stream assessment"
Usage: #definition
* url = "https://hawaleshailesh004.github.io/ieee-hackathon/Questionnaire/citizen-stream-assessment"
* version = "0.1.0"
* name = "CitizenStreamAssessmentOah"
* title = "Urban stream check (OneAquaHealth citizen lane)"
* status = #draft
* subjectType = #Location
* description = "A short visual assessment of an urban stream reach. Each coded answer is extracted into an OAH citizen Observation."

* item[0].linkId = "water"
* item[=].text = "The water"
* item[=].type = #group
* item[=].item[0].linkId = "foam"
* item[=].item[=].text = "Is there foam, unusual colour or a bad smell?"
* item[=].item[=].type = #choice
* item[=].item[=].code = $oah-cs#foam "Foam/colour/smell"
* item[=].item[=] insert Extract
* item[=].item[=] insert PresenceOptions
* item[=].item[1].linkId = "water-temperature"
* item[=].item[=].text = "Water temperature, if you have a thermometer (°C)"
* item[=].item[=].type = #quantity
* item[=].item[=].code = $oah-cs#waterTemperature "Water temperature"
* item[=].item[=] insert Extract
* item[=].item[=].extension[+].url = "http://hl7.org/fhir/StructureDefinition/questionnaire-unitOption"
* item[=].item[=].extension[=].valueCoding = $ucum#Cel "°C"

* item[1].linkId = "banks"
* item[=].text = "Plants on the banks (how much of the bank is covered?)"
* item[=].type = #group
* item[=].item[0].linkId = "trees"
* item[=].item[=].text = "Trees (taller than 3 m)"
* item[=].item[=].type = #choice
* item[=].item[=].code = $oah-cs#trees "Trees (height >3m)"
* item[=].item[=] insert Extract
* item[=].item[=] insert CoverOptions
* item[=].item[1].linkId = "bushes"
* item[=].item[=].text = "Bushes (1.5 to 3 m)"
* item[=].item[=].type = #choice
* item[=].item[=].code = $oah-cs#bushes "Bushes (height (1.5-3m)"
* item[=].item[=] insert Extract
* item[=].item[=] insert CoverOptions
* item[=].item[2].linkId = "herbaceous"
* item[=].item[=].text = "Grasses and low plants (under 1.5 m)"
* item[=].item[=].type = #choice
* item[=].item[=].code = $oah-cs#herbaceous "Herbaceous (height < 1.5m)"
* item[=].item[=] insert Extract
* item[=].item[=] insert CoverOptions

* item[2].linkId = "in-stream"
* item[=].text = "In the stream"
* item[=].type = #group
* item[=].item[0].linkId = "macrophytes"
* item[=].item[=].text = "Water plants growing in the stream"
* item[=].item[=].type = #choice
* item[=].item[=].code = $oah-cs#macrophytes "Macrophytes"
* item[=].item[=] insert Extract
* item[=].item[=] insert PresenceOptions
* item[=].item[1].linkId = "invasive"
* item[=].item[=].text = "Plants or animals that don't belong here (invasive species)"
* item[=].item[=].type = #choice
* item[=].item[=].code = $oah-cs#invasiveOrganisms "Invasive invertebrate, plants and fish"
* item[=].item[=] insert Extract
* item[=].item[=].answerOption[0].valueCoding = $oah-cs#absent "Absent"
* item[=].item[=].answerOption[1].valueCoding = $oah-cs#non-native-species "Non-native species"
* item[=].item[=].answerOption[2].valueCoding = $oah-cs#several-non-native-species "Several non-native species"
* item[=].item[=].answerOption[3].valueCoding = $oah-cs#unknown-non-native-species "Unknown non-native species"

* item[3].linkId = "notes"
* item[=].text = "Anything else you noticed? (describe what you see, not what you think caused it)"
* item[=].type = #text
