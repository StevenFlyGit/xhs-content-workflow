import type { SourceSentence } from "./source-segmentation";
import type { CardMedia } from "./card-media";

export type CardUnitRole = "content" | "ending";
export type CardUnitStatus =
  "draft" | "ready" | "overflow" | "manual" | "stale";

export type CardUnit = {
  id: string;
  title: string;
  sourceSentenceIds: string[];
  role: CardUnitRole;
  status: CardUnitStatus;
  sourceRevision?: string;
  structureRevision?: number;
  titleOrigin?: "model" | "rule" | "manual";
  note?: string;
};

export type CardDraft = {
  eyebrow: string;
  title: string;
  body: string;
  bullets?: string[];
  addedLead?: string;
  addedEnding?: string;
  enhancement?: {
    leadEnabled?: boolean;
    endingEnabled?: boolean;
    source?: "model" | "manual";
  };
  semanticBlockId?: string;
  pageRole?: string;
  sourceSentenceIds?: string[];
  sourceRevision?: string;
  stale?: boolean;
  manualTitle?: boolean;
  manualBody?: boolean;
  media?: CardMedia;
};

export type CardUnitInput = Partial<CardUnit> & { sourceIds?: string[] };

function sourceOrder(sentences: SourceSentence[]) {
  return new Map(
    sentences.map((sentence, index) => [
      sentence.id,
      Number.isFinite(sentence.order) ? sentence.order : index,
    ]),
  );
}

function fallbackTitle(index: number) {
  return `内容单元 ${String(index + 1).padStart(2, "0")}`;
}

export function sourceTextForUnit(
  unit: Pick<CardUnit, "sourceSentenceIds">,
  sentences: SourceSentence[],
) {
  const ids = new Set(unit.sourceSentenceIds);
  return sentences
    .filter((sentence) => ids.has(sentence.id))
    .map(
      (sentence, index, list) =>
        `${index > 0 && list[index - 1].paragraphId !== sentence.paragraphId ? "\n\n" : ""}${sentence.text}`,
    )
    .join("");
}

/**
 * Normalizes external/model data into ordered, non-overlapping card units.
 * Missing source sentences are kept in adjacent fallback units instead of
 * silently disappearing from the source trace.
 */
export function normalizeCardUnits(
  input: CardUnitInput[] | undefined,
  sentences: SourceSentence[],
): CardUnit[] {
  const order = sourceOrder(sentences);
  const claimed = new Set<string>();
  const normalized = (input || []).flatMap((item, index) => {
    const rawIds = Array.isArray(item.sourceSentenceIds)
      ? item.sourceSentenceIds
      : item.sourceIds || [];
    const sourceSentenceIds = rawIds
      .filter(
        (id): id is string =>
          typeof id === "string" && order.has(id) && !claimed.has(id),
      )
      .sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0));
    sourceSentenceIds.forEach((id) => claimed.add(id));
    if (!sourceSentenceIds.length) return [];
    return [
      {
        id:
          typeof item.id === "string" && item.id
            ? item.id
            : `unit-${index + 1}`,
        title:
          typeof item.title === "string" && item.title.trim()
            ? item.title.trim().slice(0, 30)
            : fallbackTitle(index),
        sourceSentenceIds,
        role: item.role === "ending" ? "ending" : "content",
        status:
          item.status === "ready" ||
          item.status === "overflow" ||
          item.status === "manual" ||
          item.status === "stale"
            ? item.status
            : "draft",
        sourceRevision:
          typeof item.sourceRevision === "string"
            ? item.sourceRevision
            : undefined,
        structureRevision:
          typeof item.structureRevision === "number"
            ? item.structureRevision
            : undefined,
        titleOrigin:
          item.titleOrigin === "model" ||
          item.titleOrigin === "manual" ||
          item.titleOrigin === "rule"
            ? item.titleOrigin
            : "rule",
        note: typeof item.note === "string" ? item.note : undefined,
      },
    ];
  });

  const missing = sentences.filter((sentence) => !claimed.has(sentence.id));
  for (const sentence of missing) {
    const previous = normalized.at(-1);
    if (
      previous &&
      previous.sourceSentenceIds.length === 1 &&
      previous.sourceSentenceIds[0] ===
        sentences[order.get(sentence.id)! - 1]?.id
    ) {
      previous.sourceSentenceIds.push(sentence.id);
      continue;
    }
    normalized.push({
      id: `unit-supplement-${normalized.length + 1}`,
      title: fallbackTitle(normalized.length),
      sourceSentenceIds: [sentence.id],
      role: "content",
      status: "draft",
    });
  }

  return normalized.sort(
    (left, right) =>
      (order.get(left.sourceSentenceIds[0]) || 0) -
      (order.get(right.sourceSentenceIds[0]) || 0),
  );
}

export function cardUnitCoverage(
  units: CardUnit[],
  sentences: SourceSentence[],
) {
  const occurrences = new Map<string, number>();
  units.forEach((unit) =>
    unit.sourceSentenceIds.forEach((id) =>
      occurrences.set(id, (occurrences.get(id) || 0) + 1),
    ),
  );
  const missing = sentences
    .filter((sentence) => !occurrences.has(sentence.id))
    .map((sentence) => sentence.id);
  const duplicates = [...occurrences.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  return {
    missing,
    duplicates,
    complete: missing.length === 0 && duplicates.length === 0,
  };
}

export function splitCardUnitAtSentence(
  units: CardUnit[],
  unitId: string,
  afterSentenceId: string,
  sentences: SourceSentence[],
): CardUnit[] {
  const index = units.findIndex((unit) => unit.id === unitId);
  const selected = units[index];
  if (!selected) return units;
  const boundary = selected.sourceSentenceIds.indexOf(afterSentenceId);
  if (boundary < 0 || boundary === selected.sourceSentenceIds.length - 1)
    return units;
  const leftIds = selected.sourceSentenceIds.slice(0, boundary + 1);
  const rightIds = selected.sourceSentenceIds.slice(boundary + 1);
  const result = [...units];
  result.splice(
    index,
    1,
    { ...selected, sourceSentenceIds: leftIds, status: "manual" },
    {
      ...selected,
      id: crypto.randomUUID(),
      title:
        sourceTextForUnit({ sourceSentenceIds: rightIds }, sentences)
          .replace(/[。！？!?，,；;：:\s]/g, "")
          .slice(0, 14) || fallbackTitle(index + 1),
      sourceSentenceIds: rightIds,
      status: "manual",
    },
  );
  return result;
}

export function mergeAdjacentCardUnits(
  units: CardUnit[],
  unitId: string,
  direction: -1 | 1,
  sentences: SourceSentence[],
): CardUnit[] {
  const index = units.findIndex((unit) => unit.id === unitId);
  const neighborIndex = index + direction;
  if (index < 0 || neighborIndex < 0 || neighborIndex >= units.length)
    return units;
  const leftIndex = Math.min(index, neighborIndex);
  const left = units[leftIndex];
  const right = units[leftIndex + 1];
  const order = sourceOrder(sentences);
  const sourceSentenceIds = [
    ...new Set([...left.sourceSentenceIds, ...right.sourceSentenceIds]),
  ].sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0));
  const merged: CardUnit = { ...left, sourceSentenceIds, status: "manual" };
  return [...units.slice(0, leftIndex), merged, ...units.slice(leftIndex + 2)];
}

/** A ready unit produces exactly one content card. */
export function compileCardsFromUnits(
  units: CardUnit[],
  sentences: SourceSentence[],
  existingCards: CardDraft[] = [],
): CardDraft[] {
  const existingByUnit = new Map(
    existingCards
      .filter((card) => card.semanticBlockId)
      .map((card) => [card.semanticBlockId!, card]),
  );
  return units.map((unit, index) => {
    const existing = existingByUnit.get(unit.id);
    const body = sourceTextForUnit(unit, sentences);
    const sourceUnchanged =
      !existing?.sourceSentenceIds?.length ||
      (existing.sourceSentenceIds.length === unit.sourceSentenceIds.length &&
        existing.sourceSentenceIds.every(
          (id, sourceIndex) => id === unit.sourceSentenceIds[sourceIndex],
        ) &&
        (!existing.sourceRevision ||
          !unit.sourceRevision ||
          existing.sourceRevision === unit.sourceRevision));
    return {
      eyebrow: `${String(index + 1).padStart(2, "0")} · 原文`,
      title:
        existing?.manualTitle && sourceUnchanged ? existing.title : unit.title,
      body: existing?.manualBody && sourceUnchanged ? existing.body : body,
      bullets: sourceUnchanged ? existing?.bullets : undefined,
      addedLead: sourceUnchanged ? existing?.addedLead : undefined,
      addedEnding: sourceUnchanged ? existing?.addedEnding : undefined,
      enhancement: sourceUnchanged ? existing?.enhancement : undefined,
      semanticBlockId: unit.id,
      pageRole: unit.role,
      sourceSentenceIds: unit.sourceSentenceIds,
      sourceRevision: unit.sourceRevision,
      stale: false,
      manualTitle: sourceUnchanged ? existing?.manualTitle : false,
      manualBody: sourceUnchanged ? existing?.manualBody : false,
      media: sourceUnchanged ? existing?.media : undefined,
    };
  });
}
