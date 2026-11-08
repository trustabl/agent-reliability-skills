# agent-reliability-skills for Claude Code

A Claude Code plugin for Trustabl Forge: Claude generates a pre-coding reliability skill for your repository, so it
applies Trustabl's rules while it writes code instead of meeting them later as scan findings.

Install in Claude Code:

```
/plugin install agent-reliability-skills --marketplace trustabl/agent-reliability-skills
```

Use it with `/agent-reliability-skills:forge [repo]`, or ask Claude for a reliability skill before agent work; the
`generate-reliability-skill` skill takes it from there.

## What it does

- Reads your repository's dependency manifests (`package.json`, `pyproject.toml`, `requirements.txt`, `go.mod` and
  others) and finds the agent SDKs it uses: the Claude Agent SDK, OpenAI Agents SDK, Google ADK, MCP, LangChain and
  LangGraph, CrewAI, Pydantic AI, the Vercel AI SDK, AutoGen and more.
- Builds a `SKILL.md` from Trustabl's detection rules for exactly those SDKs and saves it to
  `.claude/skills/trustabl-pre-coding/SKILL.md`, replacing an existing file there only if Forge generated it.
- Makes no model call and needs no API key.

## How it runs

The plugin has no MCP server. At session start it installs the pinned open-source
[Trustabl analyzer](https://github.com/trustabl/agent-reliability-analyzer), which runs `trustabl forge`, into the
plugin's own data folder, after checking it against the release's `checksums.txt` (a mismatch installs nothing), and
Claude runs it with the Bash tool. It works on macOS, Linux and Windows (Git Bash). For Cursor and other MCP clients,
use the MCP server instead: [plugin/README.md](../plugin/README.md).

## Requirements

Nothing beyond Claude Code.

## Privacy

- **Collection:** none by default. The plugin sends nothing to Trustabl. The analyzer's own `TRUSTABL_TELEMETRY`
  setting applies to the binary it runs, and it is off until you configure it.
- **Your code:** read on your machine (only the dependency manifests are needed) and never uploaded.
- **Network access:** only GitHub, to download the analyzer release and Trustabl's rules repository. After that it
  works offline from cache.
- **Storage:** the analyzer binary in the plugin's data folder, the analyzer's rules cache, and the `SKILL.md` it
  writes into your repository. Delete any of them at any time.
- **Third parties:** nothing is shared with Trustabl or anyone else.
- **Trustabl's privacy policy** (for its hosted services): https://trustabl.ai/privacy/
- **Contact:** https://github.com/trustabl/agent-reliability-skills/issues

License: Apache-2.0.
