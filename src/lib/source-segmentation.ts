export type SourceSentence = {
  id: string;
  paragraphId: string;
  text: string;
  index: number;
  /** Stable reading order across the complete source. */
  order: number;
  kind:
    | "sentence"
    | "list-item"
    | "heading"
    | "quote"
    | "code-block"
    | "table"
    | "callout"
    | "divider";
  /** Original-text offsets for traceable semantic planning. */
  start?: number;
  end?: number;
  boundaryKind?: "hard" | "soft";
  hint?: SourceKind;
  /** Optional first-level list group. Formatting is a hint, never a requirement. */
  listGroupId?: string;
};

type SourceKind = SourceSentence["kind"];

const SENTENCE_BOUNDARY =
  /[^\u3002\uff01\uff1f!?\uff1b;\n]+[\u3002\uff01\uff1f!?\uff1b;]?|[^\u3002\uff01\uff1f!?\uff1b;\n]+$/g;

function hasProtectedLongToken(text: string) {
  return /https?:\/\/\S{40,}|(?:[A-Za-z]:)?(?:[/\\][^\s]+){2,}|[A-Za-z0-9_][A-Za-z0-9_.=/%?&:-]{159,}/.test(
    text,
  );
}

function splitLongPlainText(text: string) {
  const maxLength = 240;
  const minLength = 110;
  if ([...text].length <= maxLength || hasProtectedLongToken(text))
    return [text];
  const fragments: string[] = [];
  let rest = text;
  while ([...rest].length > maxLength) {
    const codePoints = [...rest];
    const window = codePoints.slice(0, maxLength).join("");
    const candidates = [
      window.lastIndexOf("\u3002"),
      window.lastIndexOf("\uff01"),
      window.lastIndexOf("\uff1f"),
      window.lastIndexOf("\uff1b"),
      window.lastIndexOf("\uff0c"),
      window.lastIndexOf("\u3001"),
      window.lastIndexOf("\uff1a"),
      window.lastIndexOf(" "),
    ];
    const boundary = Math.max(...candidates);
    const cutAt = boundary >= minLength ? boundary + 1 : maxLength;
    fragments.push(codePoints.slice(0, cutAt).join(""));
    rest = codePoints.slice(cutAt).join("");
  }
  if (rest) fragments.push(rest);
  return fragments;
}

function boundaryKindFor(sentence: Pick<SourceSentence, "kind" | "text">) {
  if (
    ["heading", "list-item", "code-block", "table", "divider"].includes(
      sentence.kind,
    )
  )
    return "hard" as const;
  return /[\u3002\uff01\uff1f!?\uff1b;]$/.test(sentence.text)
    ? ("hard" as const)
    : ("soft" as const);
}

function splitParagraphIntoSentences(
  text: string,
  paragraphIndex: number,
  kind: SourceKind = "sentence",
): Omit<SourceSentence, "order">[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const isAtomic =
    kind === "heading" ||
    kind === "list-item" ||
    kind === "code-block" ||
    kind === "table" ||
    kind === "divider";
  const units = isAtomic
    ? [trimmed]
    : trimmed.match(SENTENCE_BOUNDARY) || [trimmed];
  const expandedUnits =
    kind === "sentence" && units.length === 1
      ? splitLongPlainText(units[0])
      : units;
  return expandedUnits
    .map((unit, index) => ({
      id: `S${String(paragraphIndex + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
      paragraphId: `P${String(paragraphIndex + 1).padStart(2, "0")}`,
      text: unit.trim(),
      index,
      kind,
    }))
    .filter((item) => item.text);
}

export function buildSourceSentences(originalText: string): SourceSentence[] {
  const lines = originalText.replace(/\r\n?/g, "\n").split("\n");
  const groups: Array<{
    text: string;
    kind: SourceKind;
    listGroupId?: string;
  }> = [];
  let index = 0;
  let listGroupSequence = 0;
  let activeListGroup: { id: string; indent: number } | null = null;

  const push = (
    text: string,
    kind: SourceKind = "sentence",
    listGroupId?: string,
  ) => {
    if (!text.trim()) return;
    groups.push({
      text: text.trim(),
      kind,
      ...(listGroupId ? { listGroupId } : {}),
    });
  };
  const indentationOf = (line: string) =>
    (line.match(/^[\t ]*/)?.[0] || "").replace(/\t/g, "  ").length;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const code = [line];
      index += 1;
      while (index < lines.length) {
        code.push(lines[index]);
        if (/^```/.test(lines[index].trim())) {
          index += 1;
          break;
        }
        index += 1;
      }
      push(code.join("\n"), "code-block");
      continue;
    }
    if (/^(?:---+|\*\*\*+|___+)\s*$/.test(trimmed)) {
      push(trimmed, "divider");
      index += 1;
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      push(trimmed.replace(/^#{1,6}\s+/, ""), "heading");
      index += 1;
      continue;
    }
    if (
      /^>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(trimmed) ||
      /^:::\s*(?:note|tip|warning|info|callout)?/i.test(trimmed)
    ) {
      const callout = [line];
      index += 1;
      while (index < lines.length && lines[index].trim()) {
        callout.push(lines[index]);
        index += 1;
      }
      push(callout.join("\n").replace(/^>\s*/gm, ""), "callout");
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      push(trimmed.replace(/^>\s?/, ""), "quote");
      index += 1;
      continue;
    }
    if (/^(?:[-+*]|\d+[.)])\s+/.test(trimmed)) {
      const indent = indentationOf(line);
      if (!activeListGroup || indent <= activeListGroup.indent) {
        listGroupSequence += 1;
        activeListGroup = {
          id: `L${String(listGroupSequence).padStart(2, "0")}`,
          indent,
        };
      }
      push(trimmed, "list-item", activeListGroup.id);
      index += 1;
      continue;
    }
    if (/^\|.*\|\s*$/.test(trimmed)) {
      const table = [line];
      index += 1;
      while (index < lines.length && /^\|.*\|\s*$/.test(lines[index].trim())) {
        table.push(lines[index]);
        index += 1;
      }
      push(table.join("\n"), "table");
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```|^#{1,6}\s+|^>\s?|^(?:[-+*]|\d+[.)])\s+|^\|.*\|\s*$|^(?:---+|\*\*\*+|___+)\s*$|^:::/i.test(
        lines[index].trim(),
      )
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    const paragraphIndent = indentationOf(paragraph[0]);
    const listGroupId =
      activeListGroup && paragraphIndent > activeListGroup.indent
        ? activeListGroup.id
        : undefined;
    if (!listGroupId) activeListGroup = null;
    push(paragraph.join("\n"), "sentence", listGroupId);
  }

  const normalizedOriginal = originalText.replace(/\r\n?/g, "\n");
  let searchFrom = 0;
  return groups
    .flatMap((group, paragraphIndex) =>
      splitParagraphIntoSentences(group.text, paragraphIndex, group.kind).map(
        (sentence) =>
          group.listGroupId
            ? { ...sentence, listGroupId: group.listGroupId }
            : sentence,
      ),
    )
    .map((sentence, order) => {
      const foundAt = normalizedOriginal.indexOf(sentence.text, searchFrom);
      const start = foundAt >= 0 ? foundAt : searchFrom;
      const end = start + sentence.text.length;
      searchFrom = Math.max(searchFrom, end);
      return {
        ...sentence,
        order,
        start,
        end,
        boundaryKind: boundaryKindFor(sentence),
        hint: sentence.kind,
      };
    });
}

export function resolveSourceIds(
  sourceIds: string[],
  sentences: SourceSentence[],
): string[] {
  const sentenceIds = new Set(sentences.map((sentence) => sentence.id));
  const resolved = sourceIds.flatMap((id) => {
    if (sentenceIds.has(id)) return [id];
    return sentences
      .filter((sentence) => sentence.paragraphId === id)
      .map((sentence) => sentence.id);
  });
  return [...new Set(resolved)];
}
