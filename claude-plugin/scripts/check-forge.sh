#!/usr/bin/env bash
# Agent Reliability Skills (Forge) plugin — SessionStart bootstrap.
#
# Installs the pinned Trustabl analyzer, which runs `trustabl forge`, into the
# plugin's private data dir, checksum-verified, and exposes it to the session as
# $FORGE_BIN. The generate-reliability-skill skill runs it with the Bash tool;
# this plugin has no MCP server (the Claude Directory accepts local MCP servers
# only from verified organizations; the MCP server lives on for Cursor and MCP
# clients).
#
# This script ALWAYS exits 0 and never fails the session.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-trustabl.sh
. "${DIR}/lib-trustabl.sh"

if bin="$(tdl_managed_bin)" && [ -n "$bin" ] && tdl_ensure; then
  if [ -n "${CLAUDE_ENV_FILE:-}" ] && ! grep -q 'FORGE_BIN=' "$CLAUDE_ENV_FILE" 2>/dev/null; then
    echo "export FORGE_BIN=\"$bin\"" >> "$CLAUDE_ENV_FILE"
  fi
  echo "[forge] Trustabl analyzer ${TDL_VERSION} ready at ${bin}. Generate the skill with \"\$FORGE_BIN\" forge <repo>."
  exit 0
fi

if command -v trustabl >/dev/null 2>&1; then
  echo "[forge] using trustabl from PATH ($(trustabl version 2>/dev/null | awk 'NR==1 {print $NF}')); Forge needs 0.1.14 or later."
else
  echo "[forge] could not install the Trustabl analyzer automatically — ${TDL_HINT}."
fi
exit 0
