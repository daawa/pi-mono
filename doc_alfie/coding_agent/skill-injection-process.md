# Skill Creation and Injection Process

This document explains how Pi creates skill metadata from `SKILL.md` files, injects the available skill list into the system prompt, and expands explicit `/skill:name` commands into full skill instructions.

## Table of Contents

- [Main Flow](#main-flow)
- [Skill File Shape](#skill-file-shape)
- [Skill Sources](#skill-sources)
- [Discovery Rules](#discovery-rules)
- [System Prompt Injection](#system-prompt-injection)
- [Explicit Skill Command Injection](#explicit-skill-command-injection)
- [LLM Boundary](#llm-boundary)
- [Runtime UI Behavior](#runtime-ui-behavior)
- [Debugging Checklist](#debugging-checklist)

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
| Global Agent Skills | `~/.agents/skills/` |
| Project Pi skills | `.pi/skills/` after the project is trusted |
| Project Agent Skills | `.agents/skills/` in `cwd` and ***ancestor directories***, up to the Git repository root or filesystem root, after the project is trusted |
| Packages | `skills/` directories or `pi.skills` entries in `package.json` |
| Settings | `skills` arrays in global or project settings |
| CLI | `--skill <path>` |
| Extensions | `resources_discover` event returning `skillPaths` |
| SDK | `DefaultResourceLoader` options such as additional skill paths or overrides |

`--no-skills` disables normal configured and auto-discovered skills. Explicit CLI and SDK additional paths still load, and extensions can add skill paths later through `resources_discover`.

For name collisions, explicit CLI paths are loaded before configured resources. Configured resource precedence is:

1. project settings
2. project auto-discovery
3. user settings
4. user auto-discovery
5. packages

SDK additional paths and extension-discovered paths are appended to the existing path set. `skillsOverride` can replace the final loaded result.

## Discovery Rules

Automatic discovery first resolves individual skill paths through `DefaultPackageManager`. Pi and Agent Skills locations differ at the root:

- `~/.pi/agent/skills/` and project `.pi/skills/` **accept** direct root `.md` files
- `~/.agents/skills/` and project `.agents/skills/` **ignore** direct root `.md` files
- all locations **recursively discover** directories containing `SKILL.md`

Once a directory is passed to `loadSkillsFromDir()`, it follows these rules:

- if a directory contains `SKILL.md`, treat it as a skill root and do not recurse further
- if the initial directory has no `SKILL.md`, load its immediate `.md` children as standalone skills
- recurse into subdirectories to find `SKILL.md`
- do not load arbitrary `.md` files inside those subdirectories
- skip hidden entries and `node_modules`
- apply ignore files such as `.gitignore`, `.ignore`, and `.fdignore`

For example:

```text
skills/
  review.md          # loaded as a standalone skill
  summarize.md       # loaded as a standalone skill
  nested/
    notes.md         # not loaded
    task/
      SKILL.md       # loaded as a directory-based skill
```

Automatic `.agents/skills/` discovery is stricter: it ignores `review.md` and `summarize.md` at the root and only discovers directories containing `SKILL.md`.

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

`AgentSession` rebuilds the system prompt from active tool snippets and guidelines, context files, configured system-prompt content, and loaded skills.

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

### `enableSkillCommands`

`enableSkillCommands` controls whether interactive autocomplete registers each loaded skill as `/skill:name`. It is a top-level setting and defaults to `true` when omitted:

```json
{
  "enableSkillCommands": false
}
```

It can also be changed through interactive `/settings`. The UI writes the global setting, saves it, and rebuilds the autocomplete provider.

**The setting controls *command discovery*, not *command expansion***:

- `true`: interactive autocomplete includes `/skill:name` entries
- `false`: those autocomplete entries are hidden, but manually submitted `/skill:name` text still expands when normal prompt expansion is enabled
- RPC `get_commands` lists every loaded skill independently of this interactive setting

`AgentSession._expandSkillCommand()` does not read `enableSkillCommands`. Normal `prompt()` calls expand skill commands through the `expandPromptTemplates` path, which defaults to enabled.

### Expansion

When the user sends `/skill:name args`, `AgentSession._expandSkillCommand()`:

1. looks up the skill by name
2. reads the full skill file
3. strips frontmatter
4. wraps the body in a `<skill name="..." location="...">` block and prepends `References are relative to <baseDir>.`
5. appends user args as raw text after the block, without a `User:` label
6. sends the expanded text through the normal prompt path

The resulting text has this shape:

```xml
<skill name="my-skill" location="/absolute/path/to/my-skill/SKILL.md">
References are relative to /absolute/path/to/my-skill.

# My Skill

Follow these steps...
</skill>

user arguments
```

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
2. For project-local skills, check that the project is trusted and that the expected `.agents/skills/` ancestor is inside the discovery boundary.
3. Check `SKILL.md` frontmatter has a non-empty `description`.
4. Check name validation.
5. Check for name collisions; the first loaded skill wins according to source precedence.
6. Check whether `disable-model-invocation: true` hides it from the automatic system prompt list.
7. Check whether `read` is active. Without `read`, automatic skill listing is omitted.
8. Check whether `enableSkillCommands` is `true` for interactive `/skill:name` completion.
9. Use `/skill:name` to force full skill injection when the model does not choose the skill from metadata.
