# Skill Creation and Injection Process

This document explains how Pi creates skill metadata from `SKILL.md` files, injects the available skill list into the system prompt, and expands explicit `/skill:name` commands into full skill instructions.

## Main Flow

Skills have two injection paths:

1. Discovery and system prompt listing: Pi scans configured skill locations, parses frontmatter metadata, and appends an `<available_skills>` list to the system prompt.
2. Explicit skill invocation: `/skill:name args` reads the full `SKILL.md`, strips frontmatter, wraps the body in a `<skill>` block, and sends it as a user message.

Skills are not `AgentTool` objects. They are prompt resources. They never enter `agent.state.tools` and are not sent to providers through `Context.tools`.

## Skill File Shape

A skill is usually a directory containing `SKILL.md`, plus optional helper files:

```text
my-skill/
  SKILL.md
  scripts/
  references/
  assets/
```

`SKILL.md` starts with frontmatter:

```markdown
---
name: my-skill
description: Use when the task needs this specific workflow.
disable-model-invocation: false
---

# My Skill

Follow these steps...
```

Runtime metadata is defined in `packages/coding-agent/src/core/skills.ts`:

- `name`
- `description`
- `filePath`
- `baseDir`
- `sourceInfo`
- `disableModelInvocation`

Only metadata is kept in memory during discovery. Full instructions are read later from `filePath`.

## Skill Sources

Skill paths enter the runtime from:

| Source | Path or API |
| --- | --- |
| Global Pi skills | `~/.pi/agent/skills/` |
| Project Pi skills | `.pi/skills/` |
| Packages | package resources and package config |
| Settings | `skills` array in settings |
| CLI | `--skill <path>` |
| Extensions | `resources_discover` event returning `skillPaths` |
| SDK | `DefaultResourceLoader` options such as additional skill paths or overrides |

`--no-skills` disables normal discovery, but explicit CLI/additional skill paths can still load.

## Discovery Rules

`loadSkillsFromDir()` follows these rules:

- if a directory contains `SKILL.md`, treat it as a skill root and do not recurse further
- otherwise, load direct `.md` children in the root
- recurse into subdirectories to find `SKILL.md`
- skip hidden entries and `node_modules`
- apply ignore files such as `.gitignore`, `.ignore`, and `.fdignore`

`loadSkillFromFile()` parses frontmatter, validates the name and description, and still loads skills with validation warnings unless the description is missing.

Name validation:

- lowercase letters, numbers, and hyphens only
- no leading or trailing hyphen
- no consecutive hyphens
- maximum 64 characters

Description validation:

- required
- maximum 1024 characters

`loadSkills()` dedupes by real path and by skill name. On name collision, the first loaded skill wins and a diagnostic is recorded.

## System Prompt Injection

`AgentSession` rebuilds the system prompt from active tools, context files, prompt metadata, and loaded skills.

`buildSystemPrompt()` appends skills only when the `read` tool is active. This guard exists because automatic skill usage requires the model to read the full `SKILL.md` itself. If `read` is unavailable, Pi omits the automatic skill list.

`formatSkillsForPrompt()` filters out skills with `disable-model-invocation: true` and injects metadata only:

```xml
<available_skills>
  <skill>
    <name>my-skill</name>
    <description>Use when the task needs this specific workflow.</description>
    <location>/absolute/path/to/my-skill/SKILL.md</location>
  </skill>
</available_skills>
```

At this stage, the model sees only the skill name, description, and location. It must use the normal `read` tool to load full instructions.

## Explicit Skill Command Injection

Interactive mode registers `/skill:name` commands when `enableSkillCommands` is enabled. RPC exposes the same command names through command listing.

When the user sends `/skill:name args`, `AgentSession._expandSkillCommand()`:

1. looks up the skill by name
2. reads the full skill file
3. strips frontmatter
4. wraps the body in a `<skill name="..." location="...">` block
5. appends user args after the block
6. sends the expanded text through the normal prompt path

This path works for `disable-model-invocation: true` skills because it bypasses the automatic available-skills list and injects the full skill by explicit user command.

## LLM Boundary

After skill command expansion, the message is ordinary conversation content.

Unlike tools:

- no `ToolDefinition` is created for a skill
- no `AgentTool` wrapper exists for a skill
- no skill is passed through `Context.tools`
- the model cannot call a skill as a provider tool
- the model can read a skill file, follow its instructions, and use normal tools

## Runtime UI Behavior

The TUI treats expanded skill blocks specially for display. It parses the `<skill>` block and renders it with `SkillInvocationMessageComponent`.

This is presentation only. The LLM receives the same user message content.

The `read` tool also classifies reads of `SKILL.md` as compact skill reads in the interactive UI.

## Debugging Checklist

Use this path when a skill is missing or not triggering:

1. Check whether the skill was discovered through `session.resourceLoader.getSkills().skills`.
2. Check `SKILL.md` frontmatter has a non-empty `description`.
3. Check name validation.
4. Check for name collisions; first loaded skill wins.
5. Check whether `disable-model-invocation: true` hides it from the automatic system prompt list.
6. Check whether `read` is active. Without `read`, automatic skill listing is omitted.
7. Check whether `enableSkillCommands` is `true` for `/skill:name` completion.
8. Use `/skill:name` to force full skill injection when the model does not choose the skill from metadata.
