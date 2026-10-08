// A conservative lexical refusal policy, not a Mermaid/Markdown/CSS parser.
// Mermaid 11.17.2 can fetch image metadata before producing SVG, and inserts
// label HTML/user styles into temporary DOM. Reject these surfaces *before*
// calling the converter, including encodings that could hide their keywords.
// Deliberately rejects benign uses too; re-audit when upstream changes.
const RESOURCE_CAPABLE_SYNTAX: readonly RegExp[] = [
  // Node metadata is YAML: even its img key can be quoted/escaped or aliased.
  // Refuse the entire extended-metadata surface instead of parsing its fields.
  /@\s*\{/u,
  // Sequence properties can set icon URLs without @{...}; details can import
  // those properties from host DOM. Refuse both keywords, including benign text.
  /\b(?:properties|details)\b/iu,
  // HTML/Mermaid entities and JSON/YAML/CSS escapes can disguise resource text.
  /\\|&(?:#|[a-z][a-z\d]*;)|#(?:\d+|x[\da-f]+|[a-z][a-z\d]*);|ﬂ°|¶ß/iu,
  // Image/resource elements and attributes, including relative URLs.
  /<\s*\/?\s*(?:img|image|feimage|use|iframe|video|audio|source|object|embed|link|style|script|meta|base)\b/iu,
  /\b(?:src|srcset|href|xlink:href|poster|background|style|data)\s*=/iu,
  /!\s*\[/u,
  // CSS images/imports and comments that upstream CSS processing may remove.
  /\b(?:url|image|image-set|-webkit-image-set)\s*\(|@\s*import\b|\/\*/iu,
  // Refuse URL declarations even in labels/comments, without interpreting them.
  /(?:https?|ftp|file|data|blob|javascript|vbscript):|\/\//iu,
];

export function rejectResourceSyntax(source: string): void {
  if (RESOURCE_CAPABLE_SYNTAX.some((pattern) => pattern.test(source))) {
    throw new Error("Resource-capable Mermaid syntax is not supported: remove image/node metadata, properties/details, resource HTML/CSS, URLs, escapes or entities.");
  }
}
