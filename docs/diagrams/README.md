# CI/CD Diagrams

This folder contains Mermaid source files for the project CI/CD workflow.

## Files

- `ci_cd_flowchart.mmd`: high-level stage flow (decision-oriented)
- `ci_cd_sequence.mmd`: sequence view (actor/message-oriented)

## Quick Use in Markdown

Paste either diagram into a Mermaid code block:

```mermaid
%% contents of ci_cd_flowchart.mmd
```

```mermaid
%% contents of ci_cd_sequence.mmd
```

## Render Locally (Optional)

Using Mermaid CLI (`mmdc`):

```bash
npx -y @mermaid-js/mermaid-cli -i docs/diagrams/ci_cd_flowchart.mmd -o docs/diagrams/ci_cd_flowchart.png
npx -y @mermaid-js/mermaid-cli -i docs/diagrams/ci_cd_sequence.mmd -o docs/diagrams/ci_cd_sequence.png
```

## Report Tip

For the course report:
- Use `ci_cd_flowchart.mmd` in architecture/process chapter
- Use `ci_cd_sequence.mmd` in DevSecOps/automation chapter
