import { describe, expect, it, vi } from "vitest";
import {
  publicationCharacterCount,
  SUMMARY_PUBLICATION_LIMIT,
} from "./lib/publication-limits";
import {
  analyzeSemanticProject,
  CARD_PLANNING_PROMPT_VERSION,
  generatePublicationDraft,
  refineCardUnit,
  regenerateUnitTitle,
} from "./semantic-cards.server";

describe("content planning and publication generation", () => {
  it("generates a bounded local publication fallback as an independent task", async () => {
    const result = await generatePublicationDraft(
      {
        name: "一段生活记录",
        outputMode: "summary",
        originalText: "今天发生了一件值得记录的小事。".repeat(90),
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("local-fallback");
    if (!result.ok) return;
    expect(result.summaryGeneration).toBe("local-fallback");
    expect(
      publicationCharacterCount({
        title: result.title,
        body: result.body,
        tags: result.tags,
      }),
    ).toBeLessThanOrEqual(SUMMARY_PUBLICATION_LIMIT);
  });

  it("returns only single-card structure units during card planning", async () => {
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
    expect(result.generatedModes).toEqual([]);
    expect(result.units.length).toBeGreaterThan(0);
    expect(result.planningVersion).toBe(CARD_PLANNING_PROMPT_VERSION);
    expect("summaryGeneration" in result).toBe(false);
  });

  it("uses one model request for card structure and keeps publication out of the blocking result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                deckTitle: "开发准备",
                deckSubtitle: "从环境到连接",
                units: [
                  {
                    id: "U01",
                    title: "环境准备",
                    role: "content",
                    sourceSentenceIds: ["S01-01", "S01-02"],
                  },
                ],
              }),
            },
          },
        ],
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await analyzeSemanticProject(
        {
          name: "开发准备",
          outputMode: "card",
          originalText: "先安装环境。然后连接设备。",
        },
        {
          MODEL_BASE_URL: "https://model.example/v1",
          MODEL_KEY: "test-key",
          MODEL_NAME: "test-model",
        },
      );

      expect(result.ok).toBe(true);
      expect(result.mode).toBe("model");
      expect(result.generatedModes).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(String(request.body));
      expect(payload.model).toBe("test-model");
      expect(payload.max_tokens).toBeGreaterThanOrEqual(700);
      expect(payload.messages[0].content).toContain("do not generate publication copy");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("disables DeepSeek V4 thinking for fast structured planning", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                deckTitle: "开发准备",
                units: [
                  {
                    id: "U01",
                    title: "环境与设备准备",
                    role: "content",
                    sourceSentenceIds: ["S01-01", "S01-02"],
                  },
                ],
              }),
            },
          },
        ],
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await analyzeSemanticProject(
        {
          name: "开发准备",
          outputMode: "card",
          originalText: "先安装环境。然后连接设备。",
        },
        {
          MODEL_BASE_URL: "https://model.example/v1",
          MODEL_KEY: "test-key",
          MODEL_NAME: "deepseek-v4-flash",
        },
      );

      const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(String(request.body));
      expect(payload.thinking).toEqual({ type: "disabled" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("accepts array-based completion content from compatible Chat Completions providers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    deckTitle: "设备准备",
                    units: [
                      {
                        id: "U01",
                        title: "设备连接准备",
                        role: "content",
                        sourceSentenceIds: ["S01-01", "S01-02"],
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await analyzeSemanticProject(
        {
          name: "设备准备",
          outputMode: "card",
          originalText: "先安装环境。然后连接设备。",
        },
        {
          MODEL_BASE_URL: "https://model.example/v1",
          MODEL_KEY: "test-key",
          MODEL_NAME: "test-model",
        },
      );

      expect(result.ok).toBe(true);
      expect(result.mode).toBe("model");
      expect(result.units[0]?.title).toBe("设备连接准备");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports an explicit local fallback warning when a provider returns no completion content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "length",
            message: { content: null, reasoning_content: "hidden reasoning" },
          },
        ],
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await analyzeSemanticProject(
        {
          name: "设备准备",
          outputMode: "card",
          originalText: "先安装环境。然后连接设备。",
        },
        {
          MODEL_BASE_URL: "https://model.example/v1",
          MODEL_KEY: "test-key",
          MODEL_NAME: "test-model",
        },
      );

      expect(result.ok).toBe(true);
      expect(result.mode).toBe("local-fallback");
      expect(result.warning).toContain("被截断");
      expect(result.warning).toContain("finish_reason=length");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("uses a separate model request when generating publication copy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                publication: {
                  title: "开发准备记录",
                  body: "今天完成了环境安装和设备连接，为后续开发做好准备。",
                  tags: "#开发记录 #项目总结",
                  toneLabel: "清晰务实",
                },
              }),
            },
          },
        ],
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await generatePublicationDraft(
        {
          name: "开发准备",
          outputMode: "summary",
          originalText: "先安装环境。然后连接设备。",
        },
        {
          MODEL_BASE_URL: "https://model.example/v1",
          MODEL_KEY: "test-key",
          MODEL_NAME: "test-model",
        },
      );

      expect(result.ok).toBe(true);
      expect(result.mode).toBe("model");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(String(request.body));
      expect(payload.messages[0].content).toContain("Generate publication copy only");
      expect(payload.messages[1].content).toContain("生成一份可直接发布到小红书的精华文案");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("uses publication text when a compatible provider ignores the JSON response format", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content:
                "# 环境准备记录\n\n完成环境安装和设备连接，后续可以进入正式开发。\n\n#开发记录 #环境准备",
            },
          },
        ],
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await generatePublicationDraft(
        {
          name: "开发准备",
          outputMode: "summary",
          originalText: "先安装环境。然后连接设备。",
        },
        {
          MODEL_BASE_URL: "https://model.example/v1",
          MODEL_KEY: "test-key",
          MODEL_NAME: "test-model",
        },
      );

      expect(result.ok).toBe(true);
      expect(result.mode).toBe("model");
      if (!result.ok) return;
      expect(result.title).toBe("环境准备记录");
      expect(result.body).toContain("完成环境安装");
      expect(result.tags).toBe("#开发记录 #环境准备");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("plans complete-card analysis with relaxed capacity and keeps source IDs", async () => {
    const result = await analyzeSemanticProject(
      {
        name: "\u9879\u76ee\u603b\u7ed3",
        contentType: "\u9879\u76ee\u603b\u7ed3",
        outputMode: "card",
        originalText: "\u7b2c\u4e00\u6bb5\u5b8c\u6574\u5185\u5bb9\u3002\n\n\u7b2c\u4e8c\u6bb5\u5b8c\u6574\u5185\u5bb9\u3002",
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.analysisRequestedMode).toBe("card");
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
    expect(result.planningVersion).toBe(CARD_PLANNING_PROMPT_VERSION);
  });

  it("uses a non-copying local title fallback when the model is unavailable", async () => {
    const result = await regenerateUnitTitle(
      {
        text: "部署时遇到了权限问题，需要调整配置后重试。",
      },
      {},
    );
    expect(result.mode).toBe("local-fallback");
    expect(result.title).toBe("问题与应对");
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