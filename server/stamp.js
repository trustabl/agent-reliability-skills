// Port of ParseStamp in the analyzer's internal/forge/stamp.go, so this server
// and `trustabl forge check` agree on what counts as a Forge-generated file.
// Keep the two in step: a change to the stamp format there needs one here.
const PREFIX = "<!-- generated: ";
const SUFFIX = " -->";
const INT = /^[+-]?\d+$/;

// strings.SplitN semantics: at most n parts, the last one holding the rest.
function splitN(s, sep, n) {
  const out = [];
  let rest = s;
  while (out.length < n - 1) {
    const i = rest.indexOf(sep);
    if (i < 0) break;
    out.push(rest.slice(0, i));
    rest = rest.slice(i + sep.length);
  }
  out.push(rest);
  return out;
}

// strings.TrimPrefix plus the "was the prefix there" check ParseStamp makes.
const field = (part, name) => (part.startsWith(`${name}: `) ? part.slice(name.length + 2) : null);

/** The stamp's fields, or null when there is no well-formed stamp. */
export function parseStamp(content) {
  const idx = content.indexOf(PREFIX);
  if (idx < 0) return null;
  const rest = content.slice(idx + PREFIX.length);
  const end = rest.indexOf(SUFFIX);
  if (end < 0) return null;

  const parts = splitN(rest.slice(0, end), " | ", 5);
  if (parts.length < 4 || parts.length > 5) return null;

  const rules = field(parts[1], "rules");
  if (rules === null) return null;
  const schema = field(parts[2], "schema");
  if (schema === null || !INT.test(schema)) return null;
  const sdks = field(parts[3], "sdks");
  if (sdks === null) return null;

  // A stamp with no template field predates the field; that layout is version 1.
  let template = 1;
  if (parts.length === 5) {
    const t = field(parts[4], "template");
    if (t === null || !INT.test(t) || Number(t) < 1) return null;
    template = Number(t);
  }

  return {
    date: parts[0],
    rules,
    schema: Number(schema),
    sdks: sdks.split(", ").map((s) => s.trim()).filter(Boolean),
    template,
  };
}
