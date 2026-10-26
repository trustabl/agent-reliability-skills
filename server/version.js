// Forge's --lang flag first shipped in analyzer 0.1.14. An older pinned
// TRUSTABL_VERSION would fail every call with cobra's "unknown flag" error,
// so the resolver refuses it up front with a message that says why.
export const MIN_ANALYZER_VERSION = "0.1.14";

function parse(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(tag.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] !== undefined };
}

/**
 * True when tag is at least min. A pre-release of min (v0.1.14-rc.1) is older
 * than min itself, as in semver. A tag that does not parse returns false.
 */
export function meetsMinimum(tag, min = MIN_ANALYZER_VERSION) {
  const a = parse(tag);
  const b = parse(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i];
  }
  return !a.pre || b.pre;
}

/** Release tags are v-prefixed; accept a bare "0.1.15" from settings too. */
export const normalizeTag = (value) => (/^\d/.test(value) ? `v${value}` : value);
