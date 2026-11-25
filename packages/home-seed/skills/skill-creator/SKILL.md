---
name: skill-creator
description: Create or update Stella skills. Use when the user asks to add, revise, port, validate, document, or design reusable agent skills, skill instructions, skill scripts, skill references, or skill assets for Stella agents.
---

# Skill Creator

Skills live in `~/.stella/skills/<name>/` (lowercase, hyphenated, under 64 characters). Stella's shipped defaults come from `packages/home-seed/skills/<name>/` in its source; edit those only when changing what future builds ship.

A skill is a `SKILL.md` whose frontmatter holds exactly `name` and `description`, plus a short body. The description is the only part every agent always sees, so it says in a line or two what the skill does and when to reach for it; the body loads only once it triggers.

Write for a capable agent: only what it couldn't reliably infer (team conventions, required checks, current CLI or API facts, gotchas), as principles rather than a script for every edge case, and without examples that a slightly different task would copy wrongly. When a skill grows long, move detail into files linked from `SKILL.md` (`references/`, `scripts/` for deterministic helpers, `templates/`, `assets/`) so the agent reads only the part it needs. No README or changelog unless asked.

When updating, read the skill and its files first, keep what is still true, and delete what is stale or duplicated.

```bash
python3 ~/.stella/skills/skill-creator/scripts/init_skill.py <name> --path ~/.stella/skills   # scaffold
python3 ~/.stella/skills/skill-creator/scripts/quick_validate.py ~/.stella/skills/<name>      # check frontmatter and naming
```

`init_skill.py` also writes `agents/openai.yaml`, which Stella doesn't use: delete it unless the user wants OpenAI-style metadata (`references/openai_yaml.md`). Discovery rules are in `runtime/kernel/shared/skill-catalog.ts` in Stella's source.
