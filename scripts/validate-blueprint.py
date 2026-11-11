#!/usr/bin/env python3
"""Validate structure and basic manifests. No external dependencies required."""
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
expected = ['AGENTS.md', 'README.md', 'DESIGN.md', 'docs/PRODUCT_SPEC.md',
            'docs/ARCHITECTURE.md', 'docs/ROADMAP.md', 'docs/PROGRESS.md',
            'docs/TEST_STRATEGY.md', 'docs/ACCEPTANCE.md', 'prompts/START_HERE.md',
            '.githooks/pre-commit', '.githooks/commit-msg']
errors = []
for name in expected:
    if not (root/name).is_file():
        errors.append(f'missing {name}')

for skill in sorted((root/'.agents/skills').glob('*/SKILL.md')):
    data = skill.read_text(encoding='utf-8')
    match = re.match(r'\A---\n(.*?)\n---\n', data, re.DOTALL)
    if not match:
        errors.append(f'invalid or missing frontmatter: {skill.relative_to(root)}')
        continue
    header = match.group(1)
    if not re.search(r'^name:\s*[a-z0-9-]+$', header, re.MULTILINE):
        errors.append(f'wrong name: {skill}')
    if not re.search(r'^description:\s*.+$', header, re.MULTILINE):
        errors.append(f'missing description: {skill}')
for rule in sorted((root/'.agents/rules').glob('*.md')):
    data = rule.read_text(encoding='utf-8')
    match = re.match(r'\A---\n(.*?)\n---\n', data, re.DOTALL)
    if not match:
        errors.append(f'missing YAML frontmatter: {rule}')
        continue
    header = match.group(1)
    if not re.search(r'^trigger:\s*(always_on|model_decision|glob|manual)$', header, re.MULTILINE):
        errors.append(f'invalid trigger: {rule}')
    if re.search(r'^trigger:\s*glob$', header, re.MULTILINE) and not re.search(r'^globs?:\s*.+$', header, re.MULTILINE):
        errors.append(f'missing globs: {rule}')

skills=list((root/'.agents/skills').glob('*/SKILL.md'))
if len(skills)<12: errors.append(f'Only {len(skills)} skills; expected at least 12')
print(f'Checked {len(skills)} skills, {len(list((root/".agents/rules").glob("*.md")))} rules, {len(expected)} expected files')
if errors:
    for error in errors: print('FAIL:',error)
    sys.exit(1)
print('PASS: blueprint structure and basic frontmatter checks')
