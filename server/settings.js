// Optional settings arrive as ${VAR} placeholders that the host substitutes.
// A host that leaves an unset one unsubstituted hands us the literal
// "${TRUSTABL_VERSION}"; treat that as not set rather than as a value.
// Same rule as trustabl-cursor/server/trustabl-bin.js.
export const setting = (value) => {
  const v = value?.trim();
  return v && !/^\$\{[^}]*\}$/.test(v) ? v : undefined;
};
