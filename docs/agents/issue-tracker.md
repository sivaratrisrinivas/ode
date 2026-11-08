# Issue tracker: GitHub

Issues and specs live in GitHub Issues for sivaratrisrinivas/ode.
Use the gh CLI from this repo.

## Operations

- Create: gh issue create --title "..." --body-file <file>
- Read: gh issue view <number> --comments
- List: gh issue list --state open --json number,title,body,labels,comments
- Comment: gh issue comment <number> --body-file <file>
- Add labels: gh issue edit <number> --add-label "..."
- Remove labels: gh issue edit <number> --remove-label "..."
- Close: gh issue close <number> --comment "..."

Use files with actual newlines for multiline bodies.
The CLI infers the repository from the Git remote.

## Pull requests as a triage surface

PRs as a request surface: no.

## Skill instructions

When a skill says "publish to the issue tracker", create a GitHub issue.
When a skill says "fetch the relevant ticket", read the issue and its comments.

## Wayfinding

Use a single issue labelled wayfinder:map as the map.
Link child tickets as GitHub sub-issues where supported.
Otherwise, list children in the map and add "Part of #<map>" to each child.

Use wayfinder:<type> labels for research, prototype, grilling, and task tickets.
Represent blockers with native GitHub issue dependencies where supported.
Otherwise, record "Blocked by: #<number>" in the child.

Select the first open, unassigned child in map order with no open blockers.
Claim it by assigning yourself.
On resolution, comment with the result, close the child, and add a result
summary and link to the map's Decisions-so-far.
