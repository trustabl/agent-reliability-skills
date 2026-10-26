// ToolError is a failure the caller can act on: a bad input, a missing
// workspace, a refused write. The tool handler returns its message as an
// isError result. Any other exception is a bug and is reported as one.
export class ToolError extends Error {}
