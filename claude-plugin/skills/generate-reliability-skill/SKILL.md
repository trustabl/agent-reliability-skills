---
name: generate-reliability-skill
description: >-
  Use before writing or changing AI agent code in a repository (Claude Agent SDK,
  OpenAI Agents SDK, Google ADK, MCP, LangChain/LangGraph, CrewAI, Pydantic AI,
  Vercel AI SDK, AutoGen), or when the user asks for Trustabl Forge or a
  pre-coding reliability skill. Generates a SKILL.md from Trustabl's detection
  rules for the agent SDKs the repository uses, so you apply them while you code.
---

# Generate a pre-coding reliability skill with Trustabl Forge

Forge reads the repository's dependency manifests (`package.json`,
`pyproject.toml`, `requirements.txt`, `go.mod` and others), finds the agent SDKs
it uses, and prints a `SKILL.md` built from Trustabl's detection rules for exactly
those SDKs. It makes no model call and needs no API key.

## Run it

The `SessionStart` hook installs the pinned Trustabl analyzer (checksum-verified)
and exports it as `$FORGE_BIN`; when that is empty, use `trustabl` on `PATH`
(0.1.14 or later).

```bash
"${FORGE_BIN:-trustabl}" forge <repo>                               # detected SDKs only
"${FORGE_BIN:-trustabl}" forge <repo> --policy mcp,openai_sdk       # add SDK categories not yet in a manifest
"${FORGE_BIN:-trustabl}" forge <repo> --lang python,typescript      # add languages: python, typescript, go
```

`<repo>` is `.` unless the user named another directory. The SKILL.md goes to
stdout; any note or warning goes to stderr. The first run also fetches
Trustabl's rules; after that it works from cache.

**No SDK detected:** exit code 1 with `no SDKs detected` on stderr means no
supported SDK is declared in the manifests. If the repository does use one (for
example declared only in a subfolder's manifest), run again with `--policy`
naming it, and say so.

## Save it

Save the output to `.claude/skills/trustabl-pre-coding/SKILL.md`:

- If no file is there, write it.
- If one is there, replace it **only if it starts with a Forge stamp**
  (`<!-- generated: `); a file without the stamp is a hand-written skill: never
  overwrite it, tell the user instead and offer another path.

The stamp line reads `<!-- generated: <date> | rules: <version> | schema: <n> |
sdks: <list> | template: <n> -->`. Report the SDKs it covers and the rules
version, then follow the skill's rules while you write code.
