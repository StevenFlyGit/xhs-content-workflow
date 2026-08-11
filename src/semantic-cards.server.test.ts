import { describe, expect, it } from "vitest";
import {
  publicationCharacterCount,
  SUMMARY_PUBLICATION_LIMIT,
} from "./lib/publication-limits";
import {
  analyzeSemanticProject,
  refineCardUnit,
  regenerateUnitTitle,
} from "./semantic-cards.server";

describe("summary mode fallback", () => {
  it("keeps a long publication draft within the hard limit when the model is unavailable", async () => {
    const result = await analyzeSemanticProject(
      {
        name: "一段生活记录",
        outputMode: "summary",
        originalText: "今天发生了一件值得记录的小事。".repeat(90),
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("local-fallback");
    expect(result.summaryGeneration).toBe("local-fallback");
    expect(result.generatedModes).toEqual(["summary", "card"]);
    expect(
      publicationCharacterCount({
        title: result.title,
        body: result.summary,
        tags: result.tags,
      }),
    ).toBeLessThanOrEqual(SUMMARY_PUBLICATION_LIMIT);
  });

  it("plans image-card analysis as a dedicated mode and keeps one fallback unit per source paragraph", async () => {
    const result = await analyzeSemanticProject(
      {
        name: "\u9879\u76ee\u603b\u7ed3",
        contentType: "\u9879\u76ee\u603b\u7ed3",
        outputMode: "image-card",
        originalText:
          "\u7b2c\u4e00\u6bb5\u5b8c\u6574\u5185\u5bb9\u3002\n\n\u7b2c\u4e8c\u6bb5\u5b8c\u6574\u5185\u5bb9\u3002",
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.analysisRequestedMode).toBe("image-card");
    expect(
      result.units.every((unit) => unit.sourceSentenceIds.length > 0),
    ).toBe(true);
  });

  it("keeps nested operation lists together in the local fallback", async () => {
    const result = await analyzeSemanticProject(
      {
        name: "Setup guide",
        outputMode: "card",
        originalText:
          "1. Prepare\n   1. Install\n   2. Configure\n2. Run\n   1. Verify",
      },
      {},
    );

    expect(result.mode).toBe("local-fallback");
    expect(result.units).toHaveLength(2);
    expect(result.units.map((unit) => unit.sourceSentenceIds.length)).toEqual([
      3, 2,
    ]);
    expect(result.planningVersion).toBe("card-plan-v2");
  });

  it("uses a non-copying local title fallback when the model is unavailable", async () => {
    const result = await regenerateUnitTitle(
      {
        text: "\u90e8\u7f72\u65f6\u9047\u5230\u4e86\u6743\u9650\u95ee\u9898\uff0c\u9700\u8981\u8c03\u6574\u914d\u7f6e\u540e\u91cd\u8bd5\u3002",
      },
      {},
    );
    expect(result.mode).toBe("local-fallback");
    expect(result.title).toBe("\u95ee\u9898\u4e0e\u5e94\u5bf9");
  });

  it("returns units and a publication draft even when card mode initiated the analysis", async () => {
    const result = await analyzeSemanticProject(
      {
        name: "开发者社区活动",
        outputMode: "card",
        originalText:
          "今天参加了一场开发者社区活动，现场交流很轻松，也记录了不少真实体会。".repeat(
            50,
          ),
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.analysisRequestedMode).toBe("card");
    expect(result.generatedModes).toEqual(["summary", "card"]);
    expect(result.units.length).toBeGreaterThan(0);
    expect(result.summaryGeneration).toBe("local-fallback");
    expect(result.summary).not.toBe(
      result.sourceSentences.map((sentence) => sentence.text).join(""),
    );
    expect(
      publicationCharacterCount({
        title: result.title,
        body: result.summary,
        tags: result.tags,
      }),
    ).toBeLessThanOrEqual(SUMMARY_PUBLICATION_LIMIT);
  });

  it("refines only the selected source atoms when the model is unavailable", async () => {
    const sourceSentences = [
      {
        id: "S01-01",
        paragraphId: "P01",
        text: "First sentence.",
        index: 0,
        order: 0,
        kind: "sentence" as const,
      },
      {
        id: "S01-02",
        paragraphId: "P01",
        text: "Second sentence.",
        index: 1,
        order: 1,
        kind: "sentence" as const,
      },
      {
        id: "S01-03",
        paragraphId: "P01",
        text: "Third sentence.",
        index: 2,
        order: 2,
        kind: "sentence" as const,
      },
    ];
    const result = await refineCardUnit(
      {
        unitId: "U01",
        sourceSentenceIds: sourceSentences.map((sentence) => sentence.id),
        sourceSentences,
        density: "relaxed",
      },
      {},
    );
    expect(result.mode).toBe("local-fallback");
    expect(result.units.flatMap((unit) => unit.sourceSentenceIds)).toEqual(
      sourceSentences.map((sentence) => sentence.id),
    );
  });
});
