# ai-harness-kit · AI Coding Harness Project-Root Template

> Main maintenance repository: `ai-harness-kit`.
> One goal: put an AI coding **governance layer** directly at your project root, so Claude Code / Cursor / GitHub Copilot / Kiro / Codex all work under the same rules.
>
> 中文版 → [README.md](README.md)

## 1. What it solves

`ai-harness-kit` is **not** a business-code framework. It is a project-root-level AI coding governance template.

It drops four kinds of assets into your project at once:

1. `AGENTS.md` — the "constitution" for AI behavior: roles, workflow, red lines, review.
2. `project-tracker.md` — single source of truth for project state: WIP, risks, decisions, handoff.
3. `.ai/skills-manifest.json` + `.ai/SKILLS.md` — the role-skill catalog available to the project.
4. `evals/` + multi-tool adapter files — regression checks and tool rules that guard output quality.

## 2. How to use: clone it as your project root

There is only one supported way — **clone this repository as your project root**. That is all it takes; no install script is required.

```bash
git clone https://github.com/genapohub/ai-harness-kit.git your-project
cd your-project
git remote rename origin ai-harness-kit-template
git remote add origin git@github.com:your-org/your-project.git
```

You can also click `Use this template` on GitHub to create your own project repository — same result, it is still a clone of a copy.

If you already have SSH configured:

```bash
git clone git@github.com:genapohub/ai-harness-kit.git your-project
```

To pin a specific version instead of tracking the latest (see §9 for the version list):

```bash
git clone -b harness-v1.20 https://github.com/genapohub/ai-harness-kit.git your-project
```

### Step 1 after cloning: pull the role skills

The initial clone does **not** include the role skills under `skills/` (the repo only keeps a `.gitkeep` placeholder).

**During a task conversation, if the AI finds `skills/*/SKILL.md` missing it will proactively tell you to pull the skills** — that is step 1.1 of the workflow in `AGENTS.md`. The full command list lives in **`.ai/SKILLS.md`**; clone only the ones your project enables, for example:

```bash
git clone https://github.com/genapohub/product-plan-guide.git skills/product-plan-guide
git clone https://github.com/genapohub/frontend-dev-guide.git skills/frontend-dev-guide
```

See §6 for the full list of 14 skill repos.

### Step 2 after cloning: edit three entry files

Edit `AGENTS.md` / `project-tracker.md` / `.ai/SKILLS.md` and you are ready to work — see §4 for what goes into each.

### Exception: the project already exists

Do **not** clone this repo inside a project that already has its own `.git` (it would disrupt the existing history). Copy these assets into the existing project root:

```text
AGENTS.md
project-tracker.md
SECURITY.md
.ai/
.claude/
.cursor/
.github/
.kiro/
evals/
docs/          # optional: Harness methodology primer
```

Then edit the three entry files above and you are ready to work. To pull the role skills later, clone them one by one with the commands in `.ai/SKILLS.md`.

## 3. Project structure

```text
your-project/
├── AGENTS.md                  # AI constitution: project identity, roles, red lines, workflow
├── project-tracker.md         # Single source of truth: WIP, risks, decisions, AI handoff
├── SECURITY.md                # Security sub-law: secrets, redaction, model routing, incidents
├── .ai/SKILLS.md              # Project skill catalog
├── .ai/skills-manifest.json   # Manifest of the 14 role-skill repos
├── .ai/harness.variables.example.json # Example of project variables
├── .claude/settings.json      # Suggested Claude Code permissions
├── .cursor/rules/harness.mdc  # Cursor project rules
├── .github/                   # Copilot instructions + PR template
├── .kiro/steering/harness.md  # Kiro steering
├── skills/                    # Empty initially; clone the 14 role-skill repos on demand
├── evals/                     # AI output quality regression checks
└── docs/harness/              # Harness methodology notes (optional, deletable)
```

## 4. Only three things to edit before you start

1. `AGENTS.md`: project goal, target users, tech stack, current phase.
2. `project-tracker.md`: current phase overview, WIP, risks, decision log.
3. `.ai/SKILLS.md`: confirm which role skills this project enables.

## 5. How different AI tools read it

| Capability | File |
|---|---|
| AI behavior rules | `AGENTS.md` |
| Project state persistence | `project-tracker.md` |
| Security red lines | `SECURITY.md` |
| Role-skill catalog | `.ai/skills-manifest.json` + `.ai/SKILLS.md` |
| Claude Code adapter | `.claude/settings.json` |
| Cursor adapter | `.cursor/rules/harness.mdc` |
| GitHub Copilot adapter | `.github/copilot-instructions.md` |
| PR template | `.github/pull_request_template.md` |
| Kiro adapter | `.kiro/steering/harness.md` |
| Quality regression checks | `evals/runner.py` |
| Methodology notes (optional) | `docs/harness/` |

Recommendations:

1. Claude Code / Codex: read `AGENTS.md`, `project-tracker.md`, `.ai/SKILLS.md` on entry.
2. Cursor: auto-reads `.cursor/rules/harness.mdc`; also treat `AGENTS.md` as the source of project rules.
3. GitHub Copilot: reads `.github/copilot-instructions.md` and the PR template.
4. Kiro: reads `.kiro/steering/harness.md`.
5. Teamwork: update `project-tracker.md` on every important change.

## 6. Role-skill maintenance

The `ai-harness-kit` main repo filters out `skills/` content, keeping only `skills/.gitkeep` as a placeholder. The 14 role skills are independent GitHub repositories — the full list and clone commands are in `.ai/SKILLS.md`.

In later task conversations, if the AI finds `skills/` empty or missing `SKILL.md`, **it must first prompt you to pull the skills** before using role skills — this is enforced by step 1.1 of the workflow in `AGENTS.md`.

Maintenance rules:

1. Edit the role skill in that skill repo's working copy.
2. Commit and push it inside that skill directory to `https://github.com/genapohub/<skill-name>`.
3. The main repo never commits `skills/<skill-name>/` content — only the manifests and governance files.
4. When adding or removing a role skill, update both `.ai/skills-manifest.json` and `.ai/SKILLS.md`.

## 7. Dynamic variables

Template fields use `{{VARIABLE_NAME}}` placeholders; see `.ai/harness.variables.example.json`. Replace the `{{...}}` placeholders you actually use, one by one — unreplaced placeholders do not affect how the governance files work.

## 8. Quality checks

No scripts are needed for daily use. To validate AI output:

```bash
python3 evals/runner.py . --since HEAD~1
```

Coverage (runner v0.4, all 14 cases in `regression-cases.json`):

- **Harness governance**: harness-001 governance trio present (AGENTS.md / project-tracker.md / SECURITY.md)
- **Code quality**: code-001 naming (Python snake_case / no spaces in filenames) · code-002 no leftover debug code (console.log / debugger / print; `deploy/ scripts/ test_/ migrate_` exempt) · code-003 test coverage (structural proxy)
- **Spec compliance**: spec-001 no blacklisted tools (rm -rf /, git push --force, editing CI workflows) · spec-002 PR description completeness · spec-003 commit message convention (conventional prefix + first line ≤72)
- **Doc quality**: doc-001 PRD structure · doc-002 API doc structure · doc-003 selection/design doc traceability
- **AI collaboration**: collab-001 cross-role handoff · collab-002 role-conflict escalation
- **Security**: security-001 no secret leakage · security-002 sensitive-data redaction

> Note: doc / spec-002 / code-003 are structural/proxy checks — a hit is a baseline item for human review, not necessarily a defect.

### PR gate (evals-gate)

To turn the quality checks into a merge constraint, enable the workflow template shipped in the repo:

```bash
cp .github/workflows/evals-gate.yml.example .github/workflows/evals-gate.yml
```

It runs `python3 evals/runner.py . --since HEAD~1` on PRs or pushes to `main`. Default is `continue-on-error: true`; once false positives are handled, delete that line to make it a hard gate.

## 9. Versions

Current: `harness-v1.20`

v1.20:
1. **All maintenance scripts under `scripts/` removed** (no longer distributed): pulling role skills is now a per-repo `git clone` list in `.ai/SKILLS.md`, and dynamic variables are replaced by hand.
2. **The "pull your skills" prompt is kept and strengthened**: step 1.1 of the workflow in `AGENTS.md` requires the AI to prompt the human and hand over the clone commands when `skills/*/SKILL.md` is missing.
3. The PR gate template moved out of `scripts/` to `.github/workflows/evals-gate.yml.example` — copy and rename to enable.

v1.19:
1. **Removed the install script** `scripts/init-harness.py`: the kit no longer ships any shell/inject script; the single supported path is cloning it as your project root.
2. The "exception" section for existing projects now lists assets to copy manually; the PR gate is enabled by copying `scripts/templates/evals-gate.yml`.

v1.18:
1. External usage collapsed to a single path: **clone this repo as your project root**. The former Path A / B / C split is removed; `Use this template` is kept as an equivalent shortcut.
2. `init-harness.py` moved off the main path and reframed as the exception case for projects that already exist.
3. Version-pinning example and the §2 clone commands updated together.

v1.17:
1. Personal data and fields removed from the template; it is now fully generic for external users.
2. Only a generic methodology primer ships under `docs/harness/`; maintainer notes and scripts moved out of the tree.

v1.16:
1. External-release cleanup: maintainer's own project logs moved out of the shipped tree.
2. Added `README.en.md` (this file).
3. Fixed inconsistency between the README "Path C copy list" and the project structure.
4. Added version-pinning instructions (`git clone -b harness-vX.Y`).

Earlier versions: see [README.md](README.md#九版本).

## 10. Maintenance principles

1. Maintain only `ai-harness-kit` from now on.
2. No more forked copies; rules, skills, evals and adapters all live with the project root in version control.
3. For new projects, clone this repo as the project root (or use `Use this template`).
4. Update the `AGENTS.md` version section and tag `harness-vX.Y` on every stable change.

---

*MIT License*
