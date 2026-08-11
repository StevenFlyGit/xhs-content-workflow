import { describe, expect, it } from "vitest";
import { buildSourceSentences, resolveSourceIds } from "./source-segmentation";

describe("source segmentation", () => {
  const text = "第一句话。第二句话！\n\n第三段只有一句。";

  it("creates stable sentence ids and traceable source ranges", () => {
    const sentences = buildSourceSentences(text);
    expect(
      sentences.map((item) => ({
        id: item.id,
        paragraphId: item.paragraphId,
        order: item.order,
        kind: item.kind,
      })),
    ).toEqual([
      { id: "S01-01", paragraphId: "P01", order: 0, kind: "sentence" },
      { id: "S01-02", paragraphId: "P01", order: 1, kind: "sentence" },
      { id: "S02-01", paragraphId: "P02", order: 2, kind: "sentence" },
    ]);
    expect(
      sentences.map((item) => ({
        start: item.start,
        end: item.end,
        boundaryKind: item.boundaryKind,
        hint: item.hint,
      })),
    ).toEqual([
      { start: 0, end: 5, boundaryKind: "hard", hint: "sentence" },
      { start: 5, end: 10, boundaryKind: "hard", hint: "sentence" },
      { start: 12, end: 20, boundaryKind: "hard", hint: "sentence" },
    ]);
  });

  it("keeps Markdown structural atoms stable without creating an image kind", () => {
    const structured = buildSourceSentences(
      "# 标题\n\n- 一个完整列表项\n\n> 可按句子拆分。第二句。\n\n```ts\nconst a = 1\n```\n\n| A | B |\n| - | - |",
    );
    expect(structured.map((item) => item.kind)).toEqual([
      "heading",
      "list-item",
      "quote",
      "quote",
      "code-block",
      "table",
    ]);
    expect(structured.map((item) => item.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("migrates legacy paragraph ids to sentence ids without duplicates", () => {
    const sentences = buildSourceSentences(text);
    expect(resolveSourceIds(["P01", "S01-02"], sentences)).toEqual([
      "S01-01",
      "S01-02",
    ]);
  });

  it("keeps nested list items in the same first-level list group", () => {
    const list = buildSourceSentences(
      "1. Setup\n   1. Install\n   2. Configure\n2. Run\n   1. Verify",
    );
    expect(list.map((item) => item.listGroupId)).toEqual([
      "L01",
      "L01",
      "L01",
      "L02",
      "L02",
    ]);
  });

  it("keeps a long URL as one protected source atom", () => {
    const url = "https://example.com/" + "path/".repeat(120) + "file";
    const fragments = buildSourceSentences(url);
    expect(fragments).toHaveLength(1);
    expect(fragments[0].text).toBe(url);
    expect(fragments[0].boundaryKind).toBe("soft");
  });

  it("creates soft candidate boundaries for unformatted long text", () => {
    const fragments = buildSourceSentences(
      "\u8fd9\u662f\u4e00\u6bb5\u6ca1\u6709\u6807\u70b9\u7684\u4e2d\u6587\u5185\u5bb9".repeat(
        40,
      ),
    );
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.every((item) => item.boundaryKind === "soft")).toBe(true);
  });
});
