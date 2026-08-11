import { describe, expect, it } from "vitest";
import { buildSourceSentences } from "./source-segmentation";
import {
  cardUnitCoverage,
  compileCardsFromUnits,
  mergeAdjacentCardUnits,
  normalizeCardUnits,
  splitCardUnitAtSentence,
} from "./card-units";

const sentences = buildSourceSentences("第一句。第二句。\n\n第三句。第四句。");

describe("card units", () => {
  it("keeps source order, removes duplicate assignments and supplements missing source", () => {
    const units = normalizeCardUnits(
      [
        {
          id: "second",
          title: "第二组",
          sourceSentenceIds: [sentences[2].id, sentences[3].id],
        },
        {
          id: "first",
          title: "第一组",
          sourceSentenceIds: [sentences[0].id, sentences[2].id],
        },
      ],
      sentences,
    );

    expect(units.map((unit) => unit.id)).toEqual(["first", "second"]);
    expect(units[0].sourceSentenceIds).toEqual([
      sentences[0].id,
      sentences[1].id,
    ]);
    expect(cardUnitCoverage(units, sentences)).toEqual({
      missing: [],
      duplicates: [],
      complete: true,
    });
  });

  it("only splits on a complete source sentence boundary and preserves order", () => {
    const units = normalizeCardUnits(
      [
        {
          id: "u1",
          title: "主题",
          sourceSentenceIds: sentences.map((sentence) => sentence.id),
        },
      ],
      sentences,
    );
    const split = splitCardUnitAtSentence(
      units,
      "u1",
      sentences[1].id,
      sentences,
    );
    expect(split).toHaveLength(2);
    expect(split.flatMap((unit) => unit.sourceSentenceIds)).toEqual(
      sentences.map((sentence) => sentence.id),
    );
  });

  it("only merges adjacent units and compiles one content card per unit", () => {
    const units = normalizeCardUnits(
      [
        {
          id: "u1",
          title: "前半",
          sourceSentenceIds: [sentences[0].id, sentences[1].id],
        },
        {
          id: "u2",
          title: "后半",
          sourceSentenceIds: [sentences[2].id, sentences[3].id],
        },
      ],
      sentences,
    );
    const merged = mergeAdjacentCardUnits(units, "u2", -1, sentences);
    expect(merged).toHaveLength(1);
    const cards = compileCardsFromUnits(units, sentences, [
      {
        semanticBlockId: "u1",
        title: "人工标题",
        body: "人工正文",
        eyebrow: "",
        manualTitle: true,
        manualBody: true,
      },
    ]);
    expect(cards).toHaveLength(2);
    expect(cards[0].title).toBe("人工标题");
    expect(cards[0].body).toBe("人工正文");
    expect(cards[1].sourceSentenceIds).toEqual(units[1].sourceSentenceIds);
  });

  it("does not reuse manual body when a unit no longer owns the same source", () => {
    const units = normalizeCardUnits(
      [
        { id: "u1", title: "first", sourceSentenceIds: [sentences[0].id] },
        { id: "u2", title: "second", sourceSentenceIds: [sentences[1].id] },
      ],
      sentences,
    );
    const cards = compileCardsFromUnits(units, sentences, [
      {
        semanticBlockId: "u1",
        title: "manual title",
        body: "manual body",
        eyebrow: "",
        sourceSentenceIds: [sentences[0].id, sentences[1].id],
        manualTitle: true,
        manualBody: true,
      },
    ]);
    expect(cards[0].body).not.toBe("manual body");
    expect(cards[0].manualBody).toBe(false);
  });
});
