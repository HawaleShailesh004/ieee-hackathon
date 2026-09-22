"""Prints a per-file summary of the HL7 validator's OperationOutcome output (build/validation.json).

Usage: summarize-validation.py [validation.json] [--expect valid|invalid]
  --expect valid    exit 1 unless every file has 0 errors   (CI gate for the examples)
  --expect invalid  exit 1 unless every file has >= 1 error (CI gate for the negative controls)
"""
import json
import sys
from pathlib import Path

args = sys.argv[1:]
expect = None
if '--expect' in args:
    i = args.index('--expect')
    expect = args[i + 1]
    del args[i:i + 2]

path = Path(args[0] if args else Path(__file__).parent.parent / 'build' / 'validation.json')
outcome = json.loads(path.read_text(encoding='utf-8'))
results = [e['resource'] for e in outcome.get('entry', [])] or [outcome]

failed = []
for result in results:
    source = next((x.get('valueString') for x in result.get('extension', []) if 'file' in x.get('url', '')), '?')
    issues = result.get('issue', [])
    counts = {s: sum(1 for i in issues if i['severity'] in ((s, 'fatal') if s == 'error' else (s,))) for s in ('error', 'warning')}
    print(f"\n== {Path(source).name}: errors={counts['error']} warnings={counts['warning']}")
    for issue in issues:
        if issue['severity'] in ('error', 'fatal', 'warning'):
            where = (issue.get('expression') or issue.get('location') or [''])[0]
            print(f"  [{issue['severity']}] {where}: {issue.get('details', {}).get('text', '')[:220]}")
    if (expect == 'valid' and counts['error']) or (expect == 'invalid' and not counts['error']):
        failed.append(Path(source).name)

if expect:
    if failed:
        print(f"\nFAIL: expected every file to be {expect}, but not: {', '.join(failed)}")
        sys.exit(1)
    print(f"\nPASS: all {len(results)} file(s) {expect} as expected")
