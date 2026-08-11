import { describe, expect, it } from "vitest";
import { generationSourceKey, hasCurrentGeneration } from "./generation-state";

describe("generation state", () => {
  it("keeps both generated modes valid when only the display mode changes", () => {
    const input = {
      name: "项目",
      eventName: "活动",
      eventType: "Conference",
      originalText: "原文",
    };
    const record = {
      ...input,
      outputMode: "summary",
      generatedModes: ["summary", "card"] as const,
      generatedSourceKey: generationSourceKey(input),
    };
    expect(hasCurrentGeneration(record, "summary")).toBe(true);
    expect(
      hasCurrentGeneration({ ...record, outputMode: "card" }, "card"),
    ).toBe(true);
  });

  it("invalidates generated content after the source text changes", () => {
    const input = {
      name: "项目",
      eventName: "活动",
      eventType: "Conference",
      originalText: "旧原文",
    };
    expect(
      hasCurrentGeneration(
        {
          ...input,
          originalText: "新原文",
          generatedModes: ["summary", "card"],
          generatedSourceKey: generationSourceKey(input),
        },
        "summary",
      ),
    ).toBe(false);
  });

  it("does not invalidate cards when only project metadata changes", () => {
    const input = {
      name: "old name",
      contentType: "project reflection",
      originalText: "same source",
    };
    const record = {
      ...input,
      generatedModes: ["summary", "card"] as const,
      generatedSourceKey: generationSourceKey(input),
    };
    expect(
      hasCurrentGeneration(
        {
          ...record,
          name: "new name",
          contentType: "competition reflection",
        },
        "card",
      ),
    ).toBe(true);
  });
});
