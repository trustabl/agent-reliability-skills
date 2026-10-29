// The trustabl_forge tool: metadata for tools/list and the call handler.
// The handler is plain async code with its dependencies passed in, so it is
// unit-tested without a binary, a network, or an MCP client.
import { z } from "zod";

import { ToolError } from "./errors.js";
import { buildForgeArgs, describeFailure } from "./forge.js";
import { writeSkill } from "./output.js";
import { parseStamp } from "./stamp.js";
import { resolveTarget } from "./target.js";

export const TOOL_NAME = "trustabl_forge";
export const TOOL_TITLE = "Generate a pre-coding reliability skill";
export const SKILL_DESTINATION = ".claude/skills/trustabl-pre-coding/SKILL.md";

export const TOOL_DESCRIPTION =
  "Generate a pre-coding reliability skill (SKILL.md) for a repository with Trustabl Forge. Forge reads the " +
  "repository's dependency manifests, finds the agent SDKs it uses (Claude Agent SDK, OpenAI Agents SDK, " +
  "Google ADK, MCP, LangChain, CrewAI, Pydantic AI, Vercel AI SDK, AutoGen and more), and builds the skill from " +
  "Trustabl's detection rules for those SDKs, so the rules are applied while code is written. Returns a short " +
  "summary and the SKILL.md content. Writes a file only when output_path is given; the usual destination is " +
  `${SKILL_DESTINATION}. An existing file is replaced only if Forge generated it.`;

export const TOOL_ANNOTATIONS = { title: TOOL_TITLE, readOnlyHint: false, destructiveHint: true };

export const TOOL_INPUT_SCHEMA = {
  path: z
    .string()
    .optional()
    .describe(
      "Absolute path of the repository directory. Optional when the client reports its workspace through MCP " +
        "roots; otherwise required. A relative path is resolved against that workspace.",
    ),
  policy: z
    .array(z.string())
    .optional()
    .describe(
      "SDK categories to add on top of the ones Forge detects, for an SDK not yet declared in a manifest. " +
        "Accepted today: claude_sdk, openai_sdk, google_adk, mcp, langchain, crewai, pydantic_ai, vercel_ai, " +
        "autogen, claude_skill, observability, raw_llm_sdk, agent_config, openshell. The installed analyzer " +
        "decides; an unknown value returns its list.",
    ),
  lang: z
    .array(z.string())
    .optional()
    .describe(
      "Languages to add on top of the detected ones: python, typescript, go. They pick the Runtime Tracing " +
        "section and filter each SDK's rules. A language does not select an SDK; use policy for that.",
    ),
  output_path: z
    .string()
    .optional()
    .describe(
      `Write the SKILL.md to this path, relative to the repository, usually ${SKILL_DESTINATION}. It must stay ` +
        "inside the repository, and an existing file there is replaced only if Forge generated it. Omit it to " +
        "get the content without writing anything.",
    ),
};

const result = (texts, isError = false) => ({ content: texts.map((text) => ({ type: "text", text })), isError });

export function summary({ target, skill, written, note }) {
  const stamp = parseStamp(skill);
  const sdks = stamp ? stamp.sdks.join(", ") || "none listed" : "unavailable (the output has no Forge stamp)";
  const lines = [
    `Generated a pre-coding reliability skill for ${target}.`,
    `SDKs: ${sdks}`,
    written ? `Written to: ${written}` : `Not written. Pass output_path to write it, usually ${SKILL_DESTINATION}.`,
  ];
  if (note) lines.push(`Note from trustabl: ${note}`);
  return lines.join("\n");
}

export async function forgeTool(input, { ensureBin, run, getRoots }) {
  try {
    const target = await resolveTarget(input.path, getRoots);

    let bin;
    try {
      bin = await ensureBin();
    } catch (err) {
      throw new ToolError(`Could not install the trustabl binary: ${err.message}`);
    }

    const ran = await run(bin, buildForgeArgs({ target, policy: input.policy, lang: input.lang }));
    if (ran.code !== 0) return result([describeFailure(ran)], true);

    const outputPath = input.output_path?.trim();
    const written = outputPath ? writeSkill(target, outputPath, ran.stdout) : null;
    return result([summary({ target, skill: ran.stdout, written, note: ran.stderr.trim() }), ran.stdout]);
  } catch (err) {
    if (err instanceof ToolError) return result([err.message], true);
    return result([`Unexpected error in agent-reliability-skills (please report it): ${err?.stack ?? err}`], true);
  }
}
