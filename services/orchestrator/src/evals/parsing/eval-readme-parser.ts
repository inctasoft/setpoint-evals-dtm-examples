/**
 * Pure, dependency-free parser for a Setpoint Eval README.md (SE Conventions v2 —
 * server-config/docs/setpoint-eval-conventions.md).
 *
 * Deliberately tolerant: this repo's SE corpus has 5/42 READMEs (as of Phase 4a) that predate
 * the "## Setpoint Eval Metadata" heading and carry the same bold fields directly
 * under the title instead — those must still parse (fields present, just no
 * section wrapper), and 2/42 (SE-14, SE-15) have no ## Payload section at all.
 * A missing/malformed section degrades to `undefined` fields, never an exception —
 * discovery must return EVERY eval dir regardless of README shape.
 */

export interface EvalMetadata {
  category?: string;
  duration?: string;
  timeout?: string;
  isolation?: string;
  quick?: boolean;
}

export interface EvalPayload {
  /** Raw text of the first ```json fence found inside the ## Payload section. */
  raw: string;
  /** Parsed JSON, or undefined if JSON.parse failed. */
  json?: Record<string, unknown>;
  /** Present iff JSON.parse failed on `raw`. */
  parseError?: string;
}

/**
 * Split content into lines and find the [start, end) line-index span of a
 * level-2 (`## Heading`) section by exact heading text match. `end` is the
 * index of the next level-2 heading (`## `, never `### `) or content.length.
 * Returns undefined if the heading isn't found.
 */
function findSection(
  lines: string[],
  headingText: string,
): { start: number; end: number } | undefined {
  const headingLine = `## ${headingText}`;
  const startIdx = lines.findIndex((l) => l.trim() === headingLine);
  if (startIdx === -1) return undefined;

  let end = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    // Level-2 heading: "## " with no third '#'. "### Sub" does not match.
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start: startIdx + 1, end };
}

/** First fenced code block of the given language within a line range. Returns inner text, sans fences. */
function firstFence(lines: string[], start: number, end: number, lang: string): string | undefined {
  const openRe = new RegExp('^```' + lang + '\\s*$');
  for (let i = start; i < end; i++) {
    if (openRe.test(lines[i].trim())) {
      const closeIdx = lines.findIndex((l, idx) => idx > i && idx < end && l.trim() === '```');
      if (closeIdx === -1) return undefined;
      return lines.slice(i + 1, closeIdx).join('\n');
    }
  }
  return undefined;
}

/**
 * Title: text of the first `# H1` line (the file's own title), with a
 * leading `SE-<id>: ` prefix (if present) left intact — callers that want
 * just the human name can strip it; discovery keeps the full line as `name`.
 */
export function parseTitle(content: string): string | undefined {
  const match = content.match(/^# (.+)$/m);
  return match ? match[1].trim() : undefined;
}

/**
 * Metadata fields. Scans the WHOLE document (not just inside a
 * "## Setpoint Eval Metadata" section) for `**Key**: value` tokens up to the
 * first "## Scenario" heading (or end of file if that heading is missing),
 * so it tolerates both the wrapped and the bare-bold-line pre-v2 shape.
 * Multiple tokens per line, separated by " · " or newlines, are both
 * supported.
 */
export function parseMetadata(content: string): EvalMetadata {
  const scenarioIdx = content.indexOf('## Scenario');
  const head = scenarioIdx === -1 ? content : content.slice(0, scenarioIdx);

  const fields: Record<string, string> = {};
  const tokenRe = /\*\*([A-Za-z]+)\*\*:\s*([^*\n·]+?)(?=\s*(?:·|$|\n))/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(head)) !== null) {
    fields[m[1].toLowerCase()] = m[2].trim();
  }

  const metadata: EvalMetadata = {};
  if (fields.category) metadata.category = fields.category;
  if (fields.duration) metadata.duration = fields.duration;
  if (fields.timeout) metadata.timeout = fields.timeout;
  if (fields.isolation) metadata.isolation = fields.isolation;
  if (fields.quick !== undefined) {
    metadata.quick = /^(yes|true)$/i.test(fields.quick);
  }
  return metadata;
}

/** The gherkin block inside "## Scenario", sans the ```gherkin fences. */
export function parseScenario(content: string): string | undefined {
  const lines = content.split('\n');
  const section = findSection(lines, 'Scenario');
  if (!section) return undefined;
  return firstFence(lines, section.start, section.end, 'gherkin');
}

/**
 * The first ```json fence inside "## Payload" (which may itself nest it
 * under a "### Job payload" sub-heading — findSection's level-2-only
 * boundary means the sub-heading doesn't end the section). Returns
 * undefined if there's no "## Payload" section or no json fence within it
 * (e.g. SE-14, SE-15 — schema/leader-election SEs with no job to replay).
 */
export function parsePayload(content: string): EvalPayload | undefined {
  const lines = content.split('\n');
  const section = findSection(lines, 'Payload');
  if (!section) return undefined;

  const raw = firstFence(lines, section.start, section.end, 'json');
  if (raw === undefined) return undefined;

  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    return { raw, json };
  } catch (err) {
    return { raw, parseError: err instanceof Error ? err.message : String(err) };
  }
}
