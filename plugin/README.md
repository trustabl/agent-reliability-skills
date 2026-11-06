# agent-reliability-skills

A plugin for Claude Code and Cursor that adds the Agent Reliability Skills MCP server (Trustabl Forge). Your coding
agent uses it to generate a pre-coding reliability skill for your repository, so it applies Trustabl's rules while
it writes code instead of meeting them later as scan findings.

## What it does

- Reads your repository's dependency manifests (`package.json`, `pyproject.toml`, `requirements.txt`, `go.mod` and
  others) and finds the agent SDKs it uses: the Claude Agent SDK, OpenAI Agents SDK, Google ADK, MCP, LangChain and
  LangGraph, CrewAI, Pydantic AI, the Vercel AI SDK, AutoGen and more.
- Builds a `SKILL.md` from Trustabl's detection rules for exactly those SDKs.
- Makes no model call and needs no API key.

## Tool

- `trustabl_forge`: returns a short summary and the `SKILL.md` content. It writes a file only when you pass
  `output_path` (usually `.claude/skills/trustabl-pre-coding/SKILL.md`), and replaces an existing file only if Forge
  generated it.

## Requirements

Node.js 22 or later.

## What it changes on your machine

- Downloads the open-source [Trustabl analyzer](https://github.com/trustabl/agent-reliability-analyzer) for your OS
  and architecture on first use, checks it against the release's `checksums.txt`, and caches it in
  `~/.agent-reliability-skills/<version>/`.
- Fetches Trustabl's rules repository on first use; the analyzer caches it.
- Writes the `SKILL.md` into your repository only when you ask for it with `output_path`.

## Privacy

- **Collection:** none by default. The server sends nothing to Trustabl. The analyzer's own `TRUSTABL_TELEMETRY`
  setting applies to the binary it runs, and it is off until you configure it.
- **Your code:** read on your machine (only the dependency manifests are needed) and never uploaded.
- **Network access:** only GitHub, on first use, to download the analyzer release and Trustabl's rules repository.
  After that it works offline from cache.
- **Storage:** the analyzer binary in `~/.agent-reliability-skills/`, the analyzer's rules cache, and the `SKILL.md`
  you choose to write. Delete any of them at any time.
- **Third parties:** nothing is shared with Trustabl or anyone else.
- **Trustabl's privacy policy** (for its hosted services): https://trustabl.ai/privacy/
- **Contact:** https://github.com/trustabl/agent-reliability-skills/issues

## Releasing

The plugin pins an exact npm version, because the Claude Directory requires one. After each release is on npm,
update `@trustabl/agent-reliability-skills@<version>` in `.mcp.json` and `mcp.json` in a follow-up pull request.

## More

Server details and settings: [README.md](../README.md). License: Apache-2.0.
