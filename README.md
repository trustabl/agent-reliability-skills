# Agent Reliability Skills MCP server

Forge Claude Code skills generate more reliable agents.

Agent Reliability Skills is the MCP server for Trustabl Forge. It writes a pre-coding reliability skill for **your**
repository: Forge reads the repository's dependency manifests (`package.json`, `pyproject.toml`, `requirements.txt`,
`go.mod` and others), finds the agent SDKs it uses, and builds a `SKILL.md` from Trustabl's detection rules for
exactly those SDKs. An agent that reads the skill applies the rules while it writes code, instead of meeting them
later as findings in a scan.

The skill is generated per repository. It is not a fixed skill to install, and it changes as your dependencies
and Trustabl's rules change.

Supported SDKs include the Claude Agent SDK, OpenAI Agents SDK, Google ADK, MCP, LangChain and LangGraph, CrewAI,
Pydantic AI, the Vercel AI SDK and AutoGen.

---

<a id="trustabl-partners"></a>
<h2 align="center">Trustabl partners — install from the catalogue you already use</h2>
<p align="center">
  <sub>One reliability skill generator, six front doors.</sub>
</p>

<table align="center">
  <tr>
    <td align="center" width="200">
      <a href="https://registry.modelcontextprotocol.io/?q=agent-reliability-skills"><b>MCP Registry</b></a> &middot;
      <a href="https://www.npmjs.com/package/@trustabl/agent-reliability-skills"><b>npm</b></a><br>
      <sub>Generate the skill from<br>any MCP-aware client</sub>
    </td>
    <td align="center" width="200">
      <a href="claude-plugin/README.md"><b>Claude Code</b></a><br>
      <sub>Plugin: Claude writes the<br>skill before it writes code</sub>
    </td>
    <td align="center" width="200">
      <a href="#claude-desktop"><b>Claude Desktop</b></a><br>
      <sub>Name the repository,<br>get its skill</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://cursor.directory/plugins/agent-reliability-skills"><b>Cursor</b></a><br>
      <sub>Same skill, wired in<br>as an MCP server</sub>
    </td>
    <td align="center">
      <a href="https://pypi.org/project/pydantic-ai-agent-reliability-skills/"><b>PyPI</b></a><br>
      <sub>A tool your<br>Pydantic AI agent calls</sub>
    </td>
    <td align="center">
      <a href="https://github.com/trustabl/agent-reliability-analyzer/releases"><b>CLI</b></a><br>
      <sub><code>trustabl forge</code> via Homebrew,<br>Scoop, Docker or a binary</sub>
    </td>
  </tr>
</table>

<p align="center">
  <sub>
    Every one of these generates the same skill on your own machine.<br>
    Scanning agent code instead? <a href="https://github.com/trustabl/agent-reliability-analyzer#trustabl-partners">Agent Reliability Analyzer</a> has ten more front doors.
  </sub>
</p>

---

<p align="center">
  <a href="https://www.star-history.com/#trustabl/agent-reliability-skills&Date">
    <img src="https://api.star-history.com/svg?repos=trustabl/agent-reliability-skills&type=Date" alt="GitHub stars over time for trustabl/agent-reliability-skills" width="800">
  </a>
</p>

## Install

Requires Node.js 22 or later. Every install below downloads the release file from GitHub.

### Claude Code

```bash
claude mcp add agent-reliability-skills -- npx -y https://github.com/trustabl/agent-reliability-skills/releases/download/v0.1.0-rc.3/agent-reliability-skills-0.1.0-rc.3.tgz
```

### Cursor

Add to `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "agent-reliability-skills": {
      "command": "npx",
      "args": ["-y", "https://github.com/trustabl/agent-reliability-skills/releases/download/v0.1.0-rc.3/agent-reliability-skills-0.1.0-rc.3.tgz"]
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
| Claude Code | pending |
| Cursor | pending |
| Claude Desktop | pending |

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `TRUSTABL_VERSION` | `v0.1.16` | Analyzer release to run. Unset runs the release this server version pins; set a tag (for example `v0.1.15`, `v0.1.14` or later) or `latest` for the newest release. |
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
downloads the `.tgz`, so GitHub counts it. pending. A weekly workflow records the counts in
`.github/stats/download-history.json`. They are downloads, not users, and include automated installs such as CI.

## Releasing

1. In one pull request, set `version` in `package.json`, update the release URLs in this README and `mcp.json`
   (CI fails until they match), run `npm run build` in `server/`, and commit `dist/index.js`.
2. After it merges, tag the merge commit `v<version>` and push the tag. The release workflow checks the tag
   against `package.json`, packs the server, and publishes the `.tgz` with `checksums.txt`.

## Security

See [SECURITY.md](SECURITY.md).
