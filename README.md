# Agent Reliability Skills MCP server

Agent Reliability Skills writes a pre-coding reliability skill for **your** repository. It reads the repository's
dependency manifests (`package.json`, `pyproject.toml`, `requirements.txt`, `go.mod` and others), finds the agent
SDKs it uses, and builds a `SKILL.md` from Trustabl's detection rules for exactly those SDKs. An agent that reads
the skill applies the rules while it writes code, instead of meeting them later as findings in a scan.

The skill is generated per repository. It is not a fixed skill to install, and it changes as your dependencies
and Trustabl's rules change.

Supported SDKs include the Claude Agent SDK, OpenAI Agents SDK, Google ADK, MCP, LangChain and LangGraph, CrewAI,
Pydantic AI, the Vercel AI SDK and AutoGen.

## Install

Requires Node.js 22 or later. Every install below downloads the release file from GitHub.

### Claude Code

```bash
claude mcp add agent-reliability-skills -- npx -y https://github.com/trustabl/agent-reliability-skills/releases/download/v0.1.0/agent-reliability-skills-0.1.0.tgz
```

### Cursor

Add to `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "agent-reliability-skills": {
      "command": "npx",
      "args": ["-y", "https://github.com/trustabl/agent-reliability-skills/releases/download/v0.1.0/agent-reliability-skills-0.1.0.tgz"]
    }
  }
}
```

### Claude Desktop

Open **Settings → Developer → Edit Config** and add the same `mcpServers` entry to
`claude_desktop_config.json`, then restart Claude Desktop.

Claude Desktop has no project folder, so name the repository when you ask, for example: *"Generate the Trustabl
pre-coding skill for /Users/me/code/my-agent and write it to .claude/skills/trustabl-pre-coding/SKILL.md."*

## The `trustabl_forge` tool

| Input | Required | Meaning |
|---|---|---|
| `path` | see below | Absolute path of the repository. A relative path is resolved against the client's workspace. |
| `policy` | no | SDK categories to add on top of the detected ones, for an SDK not yet in a manifest (for example `openai_sdk`). |
| `lang` | no | Languages to add: `python`, `typescript`, `go`. |
| `output_path` | no | Write the skill here, relative to the repository. Usually `.claude/skills/trustabl-pre-coding/SKILL.md`. |

It returns a short summary (the SDKs covered, where the skill was written) and the `SKILL.md` content.

It writes a file **only** when `output_path` is given. The path must stay inside the repository, and an existing
file is replaced only if Forge generated it, so regenerating a stale skill works but a hand-written file is never
overwritten.

### When `path` is needed

`path` is optional when your client reports its workspace through MCP roots, and required otherwise. Forge never
guesses from the server's working directory, because some clients start servers from your home directory.

| Client | Reports its workspace |
|---|---|
| Claude Code | RESULT-CLAUDE-CODE |
| Cursor | RESULT-CURSOR |
| Claude Desktop | RESULT-CLAUDE-DESKTOP |

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `TRUSTABL_VERSION` | `latest` | Analyzer release to run, for example `v0.1.15`. Must be `v0.1.14` or later. |
| `GITHUB_TOKEN` | unset | Used only to download the analyzer. Avoids GitHub's anonymous limit of 60 requests an hour. |
| `TRUSTABL_BIN` | unset | Path to a local `trustabl` build to run instead of downloading one. |

The server runs the [Trustabl analyzer](https://github.com/trustabl/agent-reliability-analyzer)'s
`trustabl forge`. On first use it downloads the analyzer release for your OS and architecture, checks it against
the release's `checksums.txt` (a mismatch is a hard failure), and caches it in `~/.agent-reliability-skills/<version>/`.
The analyzer's own `TRUSTABL_TELEMETRY` setting applies to the binary it runs; analyzer telemetry is off until
you configure it.

## Network

The first call fetches two things: the analyzer binary, and Trustabl's rules repository, which the analyzer
caches. After that both work offline from cache. No `git` binary is needed.

## Download counts

Each release attaches `agent-reliability-skills-<version>.tgz` and `checksums.txt`, and every install above
downloads the `.tgz`, so GitHub counts it. RESULT-COUNT-MEANING A weekly workflow records the counts in
`.github/stats/download-history.json`. They are downloads, not users, and include automated installs such as CI.

## Releasing

1. In one pull request, set `version` in `package.json`, update the release URLs in this README and `mcp.json`
   (CI fails until they match), run `npm run build` in `server/`, and commit `dist/index.js`.
2. After it merges, tag the merge commit `v<version>` and push the tag. The release workflow checks the tag
   against `package.json`, packs the server, and publishes the `.tgz` with `checksums.txt`.

## Security

See [SECURITY.md](SECURITY.md).
