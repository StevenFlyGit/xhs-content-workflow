import {
  buildSourceSentences,
  type SourceSentence,
} from "./lib/source-segmentation";
import { normalizeCardUnits } from "./lib/card-units";
import {
  fitPublicationDraft,
  publicationCharacterCount,
  SUMMARY_GENERATION_TARGET,
  SUMMARY_REWRITE_THRESHOLD,
  type PublicationDraft,
} from "./lib/publication-limits";

type RuntimeEnv = Record<string, unknown>;

type ProjectPayload = {
  name?: string;
  eventName?: string;
  eventType?: string;
  contentType?: string;
  originalText?: string;
  outputMode?: "summary" | "card" | "image-card";
};

export type RegenerateUnitTitleRequest = {
  text?: string;
  currentTitle?: string;
};

export type GenerateCardEnhancementRequest = {
  kind: "lead" | "ending";
  text?: string;
};

export type RefineCardUnitRequest = {
  unitId?: string;
  title?: string;
  sourceSentenceIds?: string[];
  sourceSentences?: SourceSentence[];
  density?: "relaxed" | "standard" | "compact";
};

type SemanticCard = {
  eyebrow: string;
  title: string;
  body: string;
  addedLead?: string;
  addedEnding?: string;
  semanticBlockId?: string;
  pageRole?: string;
  sourceSentenceIds?: string[];
};

type ModelBlock = {
  id: string;
  title: string;
  summary?: string;
  sourceSentenceIds: string[];
  estimatedCardCount?: number;
  role?: "content" | "ending";
  purpose?: "step" | "explanation" | "example" | "issue" | "conclusion";
  boundaryReason?: string;
};

type ModelCardPlan = {
  blockId: string;
  pageRole:
    | "cover"
    | "block-start"
    | "content"
    | "content-continued"
    | "block-summary"
    | "ending";
  title: string;
  addedLead?: string;
  addedEnding?: string;
  sourceSentenceIds: string[];
};

type ModelUnit = {
  id?: string;
  title: string;
  role?: "content" | "ending";
  sectionId?: string;
  relation?: "whole-section" | "section-start" | "section-continued";
  splitReason?: "capacity";
  sourceSentenceIds: string[];
};

type ModelPlan = {
  deckTitle?: string;
  deckSubtitle?: string;
  semanticBlocks: ModelBlock[];
  cards: ModelCardPlan[];
  units?: ModelUnit[];
  publication?: PublicationDraft & { toneLabel?: string };
};

export const CARD_PLANNING_PROMPT_VERSION = "card-plan-v2";

function envString(env: RuntimeEnv | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = env?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function compactJsonFromModel(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型返回不是 JSON");
  return JSON.parse(raw.slice(start, end + 1)) as ModelPlan;
}

function compactTitle(value: string) {
  return value
    .replace(/[。！？!?，,；;：:\s]/g, "")
    .replace(/[.。…]+$/g, "")
    .slice(0, 14);
}

function titleLooksCopied(title: string, body: string) {
  const cleanTitle = compactTitle(title);
  const cleanBody = compactTitle(body).slice(0, Math.max(8, cleanTitle.length));
  if (!cleanTitle) return true;
  if (
    cleanTitle.includes("…") ||
    cleanTitle.includes("...") ||
    /第?\d+页|·\s*\d+$/.test(title)
  )
    return true;
  if (cleanTitle.length > 16) return true;
  return (
    cleanBody.length >= 8 &&
    (cleanBody.startsWith(cleanTitle.slice(0, 8)) ||
      cleanTitle.startsWith(cleanBody.slice(0, 8)))
  );
}

function makeFallbackTitle(index: number, blockTitle?: string, role?: string) {
  const base = compactTitle(blockTitle || "");
  if (base && base.length <= 14 && !/内容块|原文|第\d+页/.test(base))
    return base;
  if (role === "ending") return "最后的思考";
  if (role === "block-start")
    return `观察重点${String(index + 1).padStart(2, "0")}`;
  return `内容小节${String(index + 1).padStart(2, "0")}`;
}

function safeGeneratedTitle(
  title: string,
  body: string,
  index: number,
  blockTitle?: string,
  role?: string,
) {
  return titleLooksCopied(title, body)
    ? makeFallbackTitle(index, blockTitle, role)
    : compactTitle(title);
}

function fallbackCardEnhancement(kind: "lead" | "ending") {
  return kind === "lead"
    ? "\u672c\u9875\u805a\u7126\u4e00\u4e2a\u91cd\u70b9"
    : "\u53ef\u4ee5\u636e\u6b64\u7ee7\u7eed\u63a8\u8fdb";
}

/** Generates optional supporting copy without changing original card content. */
export async function generateCardEnhancement(
  request: GenerateCardEnhancementRequest,
  env?: RuntimeEnv,
) {
  const text = request.text?.trim() || "";
  if (!text)
    return {
      text: fallbackCardEnhancement(request.kind),
      mode: "local-fallback" as const,
    };
  const baseUrl =
    envString(env, "MODEL_BASE_URL", "model_base_url").replace(/\/$/, "") ||
    "https://api.openai.com/v1";
  const apiKey = envString(env, "MODEL_KEY", "model_key", "OPENAI_API_KEY");
  const model = envString(env, "MODEL_NAME", "model_name") || "gpt-4.1-mini";
  if (!apiKey)
    return {
      text: fallbackCardEnhancement(request.kind),
      mode: "local-fallback" as const,
    };
  try {
    const response = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Return JSON only. Write one concise Chinese supporting sentence, no more than 36 Chinese characters. Never add facts, data, names, or conclusions absent from the supplied text.",
          },
          {
            role: "user",
            content:
              (request.kind === "lead"
                ? "Write a lead-in that frames the main point."
                : "Write a closing or transition that follows from the main point.") +
              "\n\nCard text:\n" +
              text,
          },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) throw new Error("model request failed");
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = payload.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(raw) as { text?: unknown; content?: unknown };
    const candidate = String(parsed.text || parsed.content || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 36);
    return {
      text: candidate || fallbackCardEnhancement(request.kind),
      mode: "model" as const,
    };
  } catch {
    return {
      text: fallbackCardEnhancement(request.kind),
      mode: "local-fallback" as const,
    };
  }
}

function fallbackRefinedUnits(sentences: SourceSentence[]) {
  if (sentences.length < 2)
    return [
      {
        id: "refined-1",
        title: fallbackUnitTitle(sentences[0]?.text || ""),
        sourceSentenceIds: sentences.map((sentence) => sentence.id),
        role: "content" as const,
      },
    ];
  const splitAt = Math.ceil(sentences.length / 2);
  return [sentences.slice(0, splitAt), sentences.slice(splitAt)]
    .filter((group) => group.length)
    .map((group, index) => ({
      id: "refined-" + String(index + 1),
      title: fallbackUnitTitle(group.map((sentence) => sentence.text).join("")),
      sourceSentenceIds: group.map((sentence) => sentence.id),
      role: "content" as const,
    }));
}

/** Refines only the selected unit and preserves its source-id boundary. */
export async function refineCardUnit(
  request: RefineCardUnitRequest,
  env?: RuntimeEnv,
) {
  const requestedIds = new Set(request.sourceSentenceIds || []);
  const sourceSentences = (request.sourceSentences || [])
    .filter((sentence) => requestedIds.has(sentence.id))
    .sort((left, right) => left.order - right.order);
  if (!sourceSentences.length)
    return { units: [], mode: "local-fallback" as const };
  const fallback = () => ({
    units: fallbackRefinedUnits(sourceSentences),
    mode: "local-fallback" as const,
  });
  if (sourceSentences.length < 2) return fallback();
  const baseUrl =
    envString(env, "MODEL_BASE_URL", "model_base_url").replace(/\/$/, "") ||
    "https://api.openai.com/v1";
  const apiKey = envString(env, "MODEL_KEY", "model_key", "OPENAI_API_KEY");
  const model = envString(env, "MODEL_NAME", "model_name") || "gpt-4.1-mini";
  if (!apiKey) return fallback();
  try {
    const response = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Return JSON only. Replan only the supplied source sentence IDs. Split only when the selected unit cannot fit a card; use the smallest number of units necessary, normally two. Keep complete semantic steps, commands, URLs and list items intact. Every supplied ID must appear exactly once in original order. Never edit, omit or invent source text. Titles must be concise summaries, not copied first sentences.",
          },
          {
            role: "user",
            content:
              "Density: " +
              (request.density || "relaxed") +
              "\nCurrent title: " +
              (request.title || "") +
              "\nSource atoms:\n" +
              sourceSentences
                .map((sentence) => sentence.id + ": " + sentence.text)
                .join("\n") +
              '\nReturn: {"units":[{"title":"...","sourceSentenceIds":["S01-01"]}]}',
          },
        ],
        temperature: 0.25,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) return fallback();
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = payload.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(raw) as {
      units?: Array<{
        id?: unknown;
        title?: unknown;
        sourceSentenceIds?: unknown;
      }>;
    };
    if (!Array.isArray(parsed.units)) return fallback();
    const units = normalizeCardUnits(
      parsed.units.map((unit, index) => ({
        id:
          typeof unit.id === "string"
            ? unit.id
            : "refined-" + String(index + 1),
        title: typeof unit.title === "string" ? unit.title : "",
        sourceSentenceIds: Array.isArray(unit.sourceSentenceIds)
          ? unit.sourceSentenceIds.filter(
              (id): id is string => typeof id === "string",
            )
          : [],
      })),
      sourceSentences,
    ).map((unit) => ({
      ...unit,
      title: titleLooksCopied(
        unit.title,
        buildBodyFromIds(sourceSentences, unit.sourceSentenceIds),
      )
        ? fallbackUnitTitle(
            buildBodyFromIds(sourceSentences, unit.sourceSentenceIds),
          )
        : unit.title,
    }));
    return { units, mode: "model" as const };
  } catch {
    return fallback();
  }
}

function fallbackUnitTitle(text: string) {
  if (/问题|报错|失败|风险|限制/.test(text)) return "问题与应对";
  if (/步骤|配置|安装|部署|操作/.test(text)) return "操作步骤";
  if (/总结|结论|收获|思考|启发/.test(text)) return "总结与收获";
  if (/案例|实践|经验/.test(text)) return "实践经验";
  return "本页核心内容";
}

/** Regenerates only a display title; it never changes the source-unit mapping. */
export async function regenerateUnitTitle(
  request: RegenerateUnitTitleRequest,
  env?: RuntimeEnv,
) {
  const text = String(request.text || "").trim();
  if (!text) return { title: "本页核心内容", mode: "local-fallback" as const };
  const baseUrl =
    envString(env, "MODEL_BASE_URL", "model_base_url").replace(/\/$/, "") ||
    "https://api.openai.com/v1";
  const apiKey = envString(env, "MODEL_KEY", "model_key", "OPENAI_API_KEY");
  const model = envString(env, "MODEL_NAME", "model_name") || "gpt-4.1-mini";
  if (!apiKey)
    return { title: fallbackUnitTitle(text), mode: "local-fallback" as const };
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              '你是中文卡片标题编辑。只输出 JSON：{"title":"..."}。标题必须是 6-14 个汉字的原创概括，不得复制正文开头，不含页码、省略号、引号或“内容小节”。',
          },
          {
            role: "user",
            content: `为下列单卡原文拟一个概括标题。只能根据原文，不得编造：\n${text}`,
          },
        ],
        temperature: 0.25,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) throw new Error(`模型接口调用失败：${response.status}`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = compactJsonFromModel(content) as { title?: unknown };
    const title =
      typeof parsed.title === "string" ? compactTitle(parsed.title) : "";
    return {
      title:
        !title || titleLooksCopied(title, text)
          ? fallbackUnitTitle(text)
          : title,
      mode: "model" as const,
    };
  } catch {
    return { title: fallbackUnitTitle(text), mode: "local-fallback" as const };
  }
}
function buildBodyFromIds(sentences: SourceSentence[], ids: string[]) {
  const set = new Set(ids);
  return sentences
    .filter((sentence) => set.has(sentence.id))
    .map((sentence) => sentence.text)
    .join("");
}

function groupFallbackSentences(sentences: SourceSentence[]) {
  const groups: SourceSentence[][] = [];
  let current: SourceSentence[] = [];
  let currentKey = "";
  for (const sentence of sentences) {
    const key = sentence.listGroupId
      ? "list:" + sentence.listGroupId
      : "paragraph:" + sentence.paragraphId;
    if (!current.length || key === currentKey) {
      current.push(sentence);
      currentKey = key;
      continue;
    }
    groups.push(current);
    current = [sentence];
    currentKey = key;
  }
  if (current.length) groups.push(current);
  return groups;
}

function fallbackPlan(
  project: ProjectPayload,
  sentences: SourceSentence[],
): {
  semanticBlocks: ModelBlock[];
  cards: SemanticCard[];
  title: string;
  summary: string;
  tags: string;
} {
  const semanticBlocks: ModelBlock[] = groupFallbackSentences(sentences).map(
    (list, index) => ({
      id: "B" + String(index + 1).padStart(2, "0"),
      title: "\u5185\u5bb9\u5c0f\u8282" + String(index + 1).padStart(2, "0"),
      summary:
        "\u6309\u8fde\u7eed\u6bb5\u843d\u6216\u540c\u7ea7\u5217\u8868\u751f\u6210\u7684\u672c\u5730\u56de\u9000\u5206\u7ec4\uff0c\u914d\u7f6e\u6a21\u578b\u540e\u4f1a\u751f\u6210\u8bed\u4e49\u5c0f\u6807\u9898",
      sourceSentenceIds: list.map((item) => item.id),
      estimatedCardCount: 1,
    }),
  );
  const cards: SemanticCard[] = [];
  cards.push({
    eyebrow: project.eventName || "完整原文卡片",
    title: project.name || project.eventName || "内容整理",
    body: "以下内容按原文顺序拆分为可阅读图片，正文区保留用户原文。",
    pageRole: "cover",
  });
  for (const block of semanticBlocks) {
    const blockSentences = sentences.filter((sentence) =>
      block.sourceSentenceIds.includes(sentence.id),
    );
    cards.push({
      eyebrow: `${block.id} · 本地分组`,
      title: makeFallbackTitle(cards.length - 1, block.title, "block-start"),
      body: blockSentences.map((item) => item.text).join(""),
      semanticBlockId: block.id,
      pageRole: "block-start",
      sourceSentenceIds: blockSentences.map((item) => item.id),
    });
  }
  const title = project.name || project.eventName || "完整内容卡片";
  return {
    units: semanticBlocks.map((block) => ({
      id: block.id,
      title: block.title,
      summary: block.summary,
      sourceSentenceIds: block.sourceSentenceIds,
      role: "content" as const,
    })),
    semanticBlocks,
    cards,
    title,
    summary: sentences.map((sentence) => sentence.text).join(""),
    tags: "#小红书图文 #内容整理 #完整原文",
  };
}

function normalizePlan(
  project: ProjectPayload,
  sentences: SourceSentence[],
  plan: ModelPlan,
) {
  const validIds = new Set(sentences.map((sentence) => sentence.id));
  const assignedToBlocks = new Set<string>();
  const used = new Set<string>();
  const blocks = Array.isArray(plan.semanticBlocks)
    ? plan.semanticBlocks
        .map((block, index) => ({
          id: block.id || `B${String(index + 1).padStart(2, "0")}`,
          title: String(block.title || `语义块 ${index + 1}`).slice(0, 30),
          summary: block.summary || "",
          sourceSentenceIds: (block.sourceSentenceIds || []).filter((id) => {
            if (!validIds.has(id) || assignedToBlocks.has(id)) return false;
            assignedToBlocks.add(id);
            return true;
          }),
          estimatedCardCount: block.estimatedCardCount || 1,
        }))
        .filter((block) => block.sourceSentenceIds.length)
    : [];

  for (const group of groupFallbackSentences(
    sentences.filter((sentence) => !assignedToBlocks.has(sentence.id)),
  )) {
    const index = blocks.length;
    blocks.push({
      id: "B" + String(index + 1).padStart(2, "0"),
      title: "\u8865\u5145\u5185\u5bb9" + String(index + 1).padStart(2, "0"),
      summary:
        "\u6a21\u578b\u672a\u5f52\u5165\u5df2\u6709\u4e3b\u9898\uff0c\u7cfb\u7edf\u5df2\u6309\u8fde\u7eed\u5185\u5bb9\u81ea\u52a8\u8865\u9f50\u4ee5\u786e\u4fdd\u539f\u6587\u5b8c\u6574\u8986\u76d6",
      sourceSentenceIds: group.map((sentence) => sentence.id),
      estimatedCardCount: 1,
    });
  }
  const cards: SemanticCard[] = [];
  cards.push({
    eyebrow: project.eventName || "完整原文卡片",
    title: String(
      plan.deckTitle || project.name || project.eventName || "内容整理",
    ).slice(0, 36),
    body: String(
      plan.deckSubtitle || "按语义顺序拆成一组可阅读、可发布的小红书图片。",
    ).slice(0, 90),
    pageRole: "cover",
  });

  const plannedCards =
    Array.isArray(plan.units) && plan.units.length
      ? plan.units.map(
          (unit) =>
            ({
              blockId: unit.sectionId || unit.id || "unit",
              pageRole:
                unit.role === "ending"
                  ? "ending"
                  : unit.relation === "section-continued"
                    ? "content-continued"
                    : "content",
              title: unit.title,
              sourceSentenceIds: unit.sourceSentenceIds,
            }) as ModelCardPlan,
        )
      : Array.isArray(plan.cards)
        ? plan.cards
        : [];
  for (const item of plannedCards) {
    const ids = (item.sourceSentenceIds || []).filter(
      (id) => validIds.has(id) && !used.has(id),
    );
    if (!ids.length) continue;
    ids.forEach((id) => used.add(id));
    const block = blocks.find((value) => value.id === item.blockId);
    const body = buildBodyFromIds(sentences, ids);
    cards.push({
      eyebrow: `${item.blockId || block?.id || "语义块"} · ${item.pageRole === "content-continued" ? "延续" : "原文"}`,
      title: safeGeneratedTitle(
        String(item.title || ""),
        body,
        cards.length - 1,
        block?.title,
        item.pageRole,
      ),
      addedLead: item.addedLead
        ? String(item.addedLead).slice(0, 60)
        : undefined,
      addedEnding: item.addedEnding
        ? String(item.addedEnding).slice(0, 60)
        : undefined,
      body,
      semanticBlockId: item.blockId,
      pageRole: item.pageRole,
      sourceSentenceIds: ids,
    });
  }

  const missing = sentences.filter((sentence) => !used.has(sentence.id));
  if (missing.length) {
    const fallback = fallbackPlan(project, missing).cards.filter(
      (card) => card.pageRole !== "cover",
    );
    cards.push(...fallback);
  }

  const units = normalizeCardUnits(
    cards
      .filter(
        (card) => card.pageRole !== "cover" && card.sourceSentenceIds?.length,
      )
      .map((card, index) => ({
        id: `U${String(index + 1).padStart(2, "0")}`,
        title: safeGeneratedTitle(card.title, card.body, index),
        sourceSentenceIds: card.sourceSentenceIds,
        role: card.pageRole === "ending" ? "ending" : ("content" as const),
        status: "draft" as const,
      })),
    sentences,
  );

  return {
    units: units.map((unit) => ({
      id: unit.id,
      title: unit.title,
      summary: `\u5355\u5361\u5185\u5bb9\u5355\u5143\uff0c\u5305\u542b ${unit.sourceSentenceIds.length} \u4e2a\u539f\u6587\u539f\u5b50\u3002`,
      sourceSentenceIds: unit.sourceSentenceIds,
      role: unit.role,
    })),
    semanticBlocks: units.map((unit) => ({
      id: unit.id,
      title: unit.title,
      summary: `单卡内容单元，包含 ${unit.sourceSentenceIds.length} 个原文句子。`,
      sourceSentenceIds: unit.sourceSentenceIds,
      estimatedCardCount: 1,
      role: unit.role,
    })),
    // Cards are compiled on the client only after the user confirms the unit structure.
    cards: [],
    title:
      plan.deckTitle || project.name || project.eventName || "完整内容卡片",
    summary: sentences.map((sentence) => sentence.text).join(""),
    tags: "#小红书图文 #完整原文 #内容整理",
  };
}

function fallbackPublication(project: ProjectPayload) {
  const draft = fitPublicationDraft({
    title: (project.name || project.eventName || "今天想记录一下").slice(0, 36),
    body: project.originalText || "",
    tags: "#生活记录 #真实感受",
  });
  return {
    ...draft,
    publicationTone: "原文保真整理",
    publicationCharacterCount: publicationCharacterCount(draft),
  };
}

function normalizePublication(project: ProjectPayload, plan: ModelPlan) {
  const publication = plan.publication;
  const draft = fitPublicationDraft({
    title: String(
      publication?.title ||
        plan.deckTitle ||
        project.name ||
        project.eventName ||
        "今天想记录一下",
    ).slice(0, 36),
    body: String(publication?.body || ""),
    tags: String(publication?.tags || "#生活记录 #真实感受"),
  });
  return {
    ...draft,
    publicationTone: String(publication?.toneLabel || "自然真诚").slice(0, 18),
    publicationCharacterCount: publicationCharacterCount(draft),
  };
}

async function callOpenAICompatible(
  env: RuntimeEnv | undefined,
  project: ProjectPayload,
  sentences: SourceSentence[],
) {
  const baseUrl =
    envString(env, "MODEL_BASE_URL", "model_base_url").replace(/\/$/, "") ||
    "https://api.openai.com/v1";
  const apiKey = envString(env, "MODEL_KEY", "model_key", "OPENAI_API_KEY");
  const model = envString(env, "MODEL_NAME", "model_name") || "gpt-4.1-mini";
  if (!apiKey) throw new Error("缺少模型密钥");

  const originalLength = [...(project.originalText || "")].length;
  const publicationTask = `\n\n精华版发布文案任务（无论当前界面选择哪种输出模式，都必须与卡片结果同时返回）：\n1. 原文共 ${originalLength} 字，${originalLength > SUMMARY_REWRITE_THRESHOLD ? `超过 ${SUMMARY_REWRITE_THRESHOLD} 字，必须重新组织和压缩` : "可以轻量润色并优化阅读节奏"}。\n2. 根据内容场景自动选择最自然的口吻：游乐园、旅行等偏欢快活泼；学术论坛、研究思考偏严谨深刻；开发者社区偏轻松活跃；读书、电影、聚餐或日常小事偏真实、有画面感和个人情绪。不要拘泥于这些类别，要根据原文自行判断。\n3. 写成可以直接粘贴到小红书发布页的成稿，标题、正文、标签合计目标约 ${SUMMARY_GENERATION_TARGET} 字，绝对不要超过 930 字，为平台计数留出余量。\n4. 开头要有自然的吸引力，但不要使用夸张标题党；正文要有具体信息、个人判断和节奏变化，结尾留下真实余味或交流空间。\n5. 少用“首先、其次、最后、总的来说、值得一提、赋能、深刻认识到”等模板词；不要写“作为一个 AI”；不要堆砌 emoji、感叹号、排比和空洞金句。\n6. 不能编造原文没有出现的人物、地点、对话、数字、感官细节或结论。可以改变表达和组织方式，但事实必须来自原文。\n7. toneLabel 用 2-8 个字描述实际采用的口吻，例如“欢快有画面”“严谨而深刻”“轻松有思考”，不要照抄示例。`;

  const capacityRule =
    project.outputMode === "image-card"
      ? "初次分块按“带图片卡片”的保守容量安排：每张卡上半部必须为用户图片预留空间，正文最多使用同等纯文字紧凑卡约 60% 的容量；宁可拆成更多相对独立完整的单元。"
      : "初次分块按“舒展”密度的保守容量安排；宁可拆成更多相对独立完整的单元，也不要为了凑字数把两个主题合并或在句子中部截断。";
  const cardPlanningParameters =
    project.outputMode === "image-card"
      ? "presentationMode=image-card; planningDensity=compact; contentCapacityRatio=0.60; mediaRegion=top-39-percent"
      : "presentationMode=card; planningDensity=relaxed; contentCapacityRatio=1.00; mediaRegion=none";
  const prompt = `你是一个中文内容编辑系统。任务：将用户提交的完整文段，按语义顺序拆成若干个“单卡内容单元”。每个单元确认后恰好生成一张 1080 × 1440 的内容卡。\n\n硬性规则：\n1. 图片正文必须完整保留用户原文，不得改写、删减、总结、替换原文句子。\n2. 你只能返回原文句子 ID 的分组和每个单元的概括标题；不要返回 cards、导语、结束语或估算页数。\n3. ${capacityRule}\n4. 不要在语义强相关的句子、列表项、URL、路径或英文单词中间断开；每个单元必须在完整句子/完整列表项边界结束。\n5. 所有句子 ID 必须且只能出现一次，且 units 数组顺序必须与原文顺序一致。\n6. 每个单元的 title 是根据本页内容生成的“小标题”，控制在 6-14 个汉字；禁止直接复制正文开头，禁止使用省略号、页码或“内容小节”。\n7. 如果原文开头是“一楼的H1-1展区主要是……”这类句子，标题应概括为“展区里的模型信号”“未来会走向何处”这类短标题，而不是照搬正文。${publicationTask}\n\n用户背景：\n项目：${project.name || ""}\n内容类型：${project.contentType || project.eventType || "未填写"}\n活动/场景：${project.eventName || ""}\n\n句子列表：\n${sentences.map((sentence) => `${sentence.id}: ${sentence.text}`).join("\n")}\n\n只返回 JSON，不要解释。格式：\n{\n  "deckTitle": "整组图片标题",\n  "deckSubtitle": "一句封面副标题",\n  "units": [{"id":"U01","title":"本页标题","role":"content","sourceSentenceIds":["S01-01"]}],\n  "publication": {"title":"可直接发布的标题","body":"个性化口吻的正文","tags":"#相关标签 #真实标签","toneLabel":"实际采用的口吻"}\n}`;

  const semanticPlanningOverride = [
    "IMPORTANT: This is semantic planning pass one.",
    "The requirements below replace every earlier instruction that asks for units or cards.",
    "Return deckTitle, deckSubtitle, semanticBlocks and publication only; do not return units or cards.",
    "Each semantic block must be a complete, continuous topic, stage, argument, or step chain, not an atomic line.",
    "Formatting, list indentation and paragraph boundaries are evidence only; use semantic transitions even when text is unformatted.",
    "Keep related parent steps, substeps, commands and explanations together when they express one stage.",
    "All source IDs must appear exactly once across semanticBlocks and remain in original order.",
    "For every block include purpose (step, explanation, example, issue, or conclusion) and boundaryReason.",
  ].join(" ");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "Return valid JSON only. This is semantic-planning pass one; return only semanticBlocks plus the requested publication draft. Do not return units or cards." +
            "\n\n" +
            semanticPlanningOverride,
        },
        {
          role: "user",
          content:
            prompt +
            "\n\nPlanning parameters: " +
            cardPlanningParameters +
            "\n\n" +
            semanticPlanningOverride,
        },
      ],
      temperature: 0.25,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `模型接口调用失败：${response.status} ${detail.slice(0, 180)}`,
    );
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型未返回内容");
  return compactJsonFromModel(content);
}

async function callCardUnitPlanner(
  env: RuntimeEnv | undefined,
  project: ProjectPayload,
  sentences: SourceSentence[],
  semanticBlocks: ModelBlock[],
) {
  const baseUrl =
    envString(env, "MODEL_BASE_URL", "model_base_url").replace(/\/$/, "") ||
    "https://api.openai.com/v1";
  const apiKey = envString(env, "MODEL_KEY", "model_key", "OPENAI_API_KEY");
  const model = envString(env, "MODEL_NAME", "model_name") || "gpt-4.1-mini";
  if (!apiKey) throw new Error("Missing model key");

  const capacity =
    project.outputMode === "image-card"
      ? "image-card compact capacity: reserve the upper image region and use at most about sixty percent of a text-only compact card"
      : "relaxed text-card capacity";
  const sourceAtoms = sentences
    .map((sentence) => {
      const hints = [
        sentence.hint || sentence.kind,
        sentence.boundaryKind || "soft",
        sentence.listGroupId || "",
      ]
        .filter(Boolean)
        .join(",");
      return sentence.id + " [" + hints + "]: " + sentence.text;
    })
    .join("\n");
  const sections = semanticBlocks
    .map(
      (section) =>
        section.id +
        " | " +
        section.title +
        " | " +
        (section.purpose || "explanation") +
        " | ids: " +
        section.sourceSentenceIds.join(",") +
        " | boundary: " +
        (section.boundaryReason || ""),
    )
    .join("\n");
  const prompt = [
    "You are card packing pass two for a 1080x1440 Chinese knowledge-card editor.",
    "Create card units from the approved semantic sections and source atoms.",
    "Do not target a fixed card count. A semantic section that fits must stay whole.",
    "Split only when capacity requires it, and only at a complete substep, paragraph, sentence, or list-item boundary.",
    "Never isolate a substep, command, URL, path, or short transition just to make another card.",
    "Do not merge unrelated short sections merely to reduce the count.",
    "Every source id must appear exactly once, in original order.",
    "Use relation whole-section when a section stays whole; use section-start and section-continued only for a capacity split.",
    "For a split, set splitReason to capacity. Titles must summarize the actual unit and must not copy its opening sentence.",
    "Capacity: " + capacity + ".",
    "Semantic sections:",
    sections,
    "Source atoms:",
    sourceAtoms,
    'Return JSON only: {"units":[{"id":"U01","title":"...","sectionId":"B01","relation":"whole-section","sourceSentenceIds":["S01-01"]}]}',
  ].join("\n\n");

  const response = await fetch(baseUrl + "/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "Return valid JSON only. Preserve all supplied source IDs exactly once and in order.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      "Card planning request failed: " +
        response.status +
        " " +
        detail.slice(0, 180),
    );
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Card planner returned no content");
  const parsed = compactJsonFromModel(content) as unknown as {
    units?: ModelUnit[];
  };
  if (!Array.isArray(parsed.units) || !parsed.units.length) {
    throw new Error("Card planner returned no units");
  }
  return parsed.units;
}

export async function analyzeSemanticProject(
  project: ProjectPayload,
  env?: RuntimeEnv,
) {
  const originalText = project.originalText || "";
  if (!originalText.trim()) {
    return { ok: false, error: "请先输入原文" };
  }
  const sentences = buildSourceSentences(originalText);
  if (!sentences.length) {
    return { ok: false, error: "未识别到可分页文本" };
  }

  try {
    const semanticPlan = await callOpenAICompatible(env, project, sentences);
    const plannedUnits = await callCardUnitPlanner(
      env,
      project,
      sentences,
      semanticPlan.semanticBlocks || [],
    );
    const plan: ModelPlan = { ...semanticPlan, units: plannedUnits };
    if (!plan.publication?.body?.trim()) {
      throw new Error("模型未返回可发布的精华版文案");
    }
    const normalized = normalizePlan(project, sentences, plan);
    const publication = normalizePublication(project, plan);
    return {
      ok: true,
      mode: "model",
      analysisRequestedMode: project.outputMode || "card",
      generatedModes: ["summary", "card"] as const,
      sourceSentences: sentences,
      ...normalized,
      title: publication.title,
      summary: publication.body,
      tags: publication.tags,
      publicationTone: publication.publicationTone,
      publicationCharacterCount: publication.publicationCharacterCount,
      summaryGeneration: "model",
      summaryWasRewritten: [...originalText].length > SUMMARY_REWRITE_THRESHOLD,
      planningVersion: CARD_PLANNING_PROMPT_VERSION,
    };
  } catch (modelError) {
    const fallback = fallbackPlan(project, sentences);
    const publication = fallbackPublication(project);
    return {
      ok: true,
      mode: "local-fallback",
      analysisRequestedMode: project.outputMode || "card",
      generatedModes: ["summary", "card"] as const,
      warning:
        modelError instanceof Error
          ? modelError.message
          : "模型调用失败，已使用本地回退",
      sourceSentences: sentences,
      ...fallback,
      title: publication.title,
      summary: publication.body,
      tags: publication.tags,
      publicationTone: publication.publicationTone,
      publicationCharacterCount: publication.publicationCharacterCount,
      summaryGeneration: "local-fallback",
      summaryWasRewritten: false,
      planningVersion: CARD_PLANNING_PROMPT_VERSION,
    };
  }
}

export async function handleSemanticCardsRequest(
  request: Request,
  env?: RuntimeEnv,
) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/semantic-cards") return null;
  if (request.method !== "POST")
    return Response.json(
      { ok: false, error: "Method Not Allowed" },
      { status: 405 },
    );
  try {
    const project = (await request.json()) as ProjectPayload;
    const result = await analyzeSemanticProject(project, env);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "语义解析失败",
      },
      { status: 500 },
    );
  }
}
