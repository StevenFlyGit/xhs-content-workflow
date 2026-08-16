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
  outputMode?: "summary" | "card";
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

export const CARD_PLANNING_PROMPT_VERSION = "card-plan-v3-single-pass";

function readProcessEnv(...keys: string[]): string {
  if (typeof process === 'undefined') return ''
  for (const key of keys) {
    const value = process.env?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function envString(env: RuntimeEnv | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = env?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return readProcessEnv(...keys);
}

/** DeepSeek V4 enables thinking by default; structured short-output tasks do not need it. */
function fastStructuredOutputOptions(model: string) {
  return /^deepseek-v4-(flash|pro)$/i.test(model.trim())
    ? { thinking: { type: "disabled" as const } }
    : {};
}
function compactJsonFromModel(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : text).replace(/^\uFEFF/, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型返回不是 JSON");
  try {
    return JSON.parse(raw.slice(start, end + 1)) as ModelPlan;
  } catch {
    throw new Error("模型返回的 JSON 格式无效");
  }
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
        ...fastStructuredOutputOptions(model),
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
        ...fastStructuredOutputOptions(model),
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
        ...fastStructuredOutputOptions(model),
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) throw new Error(`模型接口调用失败：${response.status}`);
    const data = (await response.json()) as ChatCompletionPayload;
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
  _project: ProjectPayload,
  sentences: SourceSentence[],
): {
  units: Array<{
    id: string;
    title: string;
    summary: string;
    sourceSentenceIds: string[];
    role: "content";
  }>;
  semanticBlocks: ModelBlock[];
  cards: SemanticCard[];
  title: string;
} {
  const semanticBlocks: ModelBlock[] = groupFallbackSentences(sentences).map(
    (list, index) => ({
      id: "B" + String(index + 1).padStart(2, "0"),
      title: "内容小节" + String(index + 1).padStart(2, "0"),
      summary: "按连续段落或同级列表生成的本地回退分组，可在结构解析中继续调整。",
      sourceSentenceIds: list.map((item) => item.id),
      estimatedCardCount: 1,
    }),
  );
  return {
    units: semanticBlocks.map((block) => ({
      id: block.id,
      title: block.title,
      summary: block.summary,
      sourceSentenceIds: block.sourceSentenceIds,
      role: "content" as const,
    })),
    semanticBlocks,
    // 卡片仅在用户确认单卡结构后由客户端映射，不在回退阶段提前生成。
    cards: [],
    title: "完整内容卡片",
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
    for (const group of groupFallbackSentences(missing)) {
      const fallbackIndex = cards.length;
      const fallbackBody = group.map((sentence) => sentence.text).join("\n");
      cards.push({
        eyebrow: `补充内容 · 原文`,
        title: makeFallbackTitle(
          fallbackIndex,
          fallbackUnitTitle(fallbackBody),
          "content",
        ),
        body: fallbackBody,
        semanticBlockId: `B${String(fallbackIndex).padStart(2, "0")}`,
        pageRole: "content",
        sourceSentenceIds: group.map((sentence) => sentence.id),
      });
    }
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

function publicationPlanFromPlainText(
  text: string,
  project: ProjectPayload,
): ModelPlan | null {
  const cleaned = text
    .replace(/```(?:markdown|text|plain)?/gi, "")
    .replace(/```/g, "")
    .trim();
  if (cleaned.length < 12) return null;

  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  let title = "";
  const first = lines[0];
  const heading = first.match(/^#{1,6}\s+(.+)$/);
  const labelledTitle = first.match(/^(?:标题|title)\s*[:：]\s*(.+)$/i);
  if (heading?.[1]) {
    title = heading[1].trim();
    lines.shift();
  } else if (labelledTitle?.[1]) {
    title = labelledTitle[1].trim();
    lines.shift();
  }

  let tags = "";
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const matches = lines[index].match(/#[^\s#，。；、,;]+/g);
    if (matches?.length) {
      tags = matches.join(" ");
      lines.splice(index, 1);
      break;
    }
  }

  if (/^(?:正文|body)\s*[:：]?$/i.test(lines[0] || "")) lines.shift();
  const body = lines.join("\n\n").trim();
  if (!body) return null;
  return {
    semanticBlocks: [],
    cards: [],
    publication: {
      title: title || project.name || project.eventName || "今天想记录一下",
      body,
      tags: tags || "#生活记录 #真实感受",
      toneLabel: "模型生成",
    },
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

function structureMaxTokens(fragmentCount: number) {
  // A structure plan returns only titles and source-ID ranges, but a plan with
  // dozens of fragments still needs enough room to close its JSON object.
  return Math.min(1600, Math.max(900, 700 + fragmentCount * 8));
}

function publicationMaxTokens(originalLength: number) {
  return Math.min(1800, Math.max(1200, 900 + Math.ceil(originalLength / 2)));
}

type ChatCompletionUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type ChatCompletionMessage = {
  content?: unknown;
  reasoning_content?: unknown;
  reasoning?: unknown;
  refusal?: unknown;
  function_call?: { arguments?: unknown };
  tool_calls?: Array<{ function?: { arguments?: unknown } }>;
};

type ChatCompletionChoice = {
  message?: ChatCompletionMessage;
  text?: unknown;
  finish_reason?: unknown;
};

type ChatCompletionPayload = {
  choices?: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
  output_text?: unknown;
};

type CompletionDiagnostics = {
  choiceCount: number;
  finishReason?: string;
  messageContentKind: string;
  choiceTextKind: string;
  outputTextKind: string;
  reasoningKind: string;
  refusalKind: string;
  messageFields: string[];
};

type CompletionText = {
  text: string;
  source: "message.content" | "choice.text" | "tool.arguments" | "output_text" | "none";
  diagnostics: CompletionDiagnostics;
};

function responseValueKind(value: unknown) {
  if (value === null) return "null";
  if (typeof value === "string") return `string:${value.length}`;
  if (Array.isArray(value)) return `array:${value.length}`;
  return typeof value;
}

function textFromCompletionField(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) {
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    return textFromCompletionField(record.text) || textFromCompletionField(record.value);
  }
  return value
    .map((part) => textFromCompletionField(part))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function completionText(data: ChatCompletionPayload): CompletionText {
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const choice = choices[0];
  const message = choice?.message;
  const toolArguments = (message?.tool_calls || [])
    .map((call) => textFromCompletionField(call.function?.arguments))
    .find(Boolean) || textFromCompletionField(message?.function_call?.arguments);
  const candidates: Array<{
    source: CompletionText["source"];
    value: unknown;
  }> = [
    { source: "message.content", value: message?.content },
    { source: "choice.text", value: choice?.text },
    { source: "tool.arguments", value: toolArguments },
    { source: "output_text", value: data.output_text },
  ];
  const diagnostics: CompletionDiagnostics = {
    choiceCount: choices.length,
    finishReason:
      typeof choice?.finish_reason === "string"
        ? choice.finish_reason
        : undefined,
    messageContentKind: responseValueKind(message?.content),
    choiceTextKind: responseValueKind(choice?.text),
    outputTextKind: responseValueKind(data.output_text),
    reasoningKind: responseValueKind(
      message?.reasoning_content ?? message?.reasoning,
    ),
    refusalKind: responseValueKind(message?.refusal),
    messageFields: message
      ? Object.keys(message).filter((key) =>
          [
            "content",
            "reasoning_content",
            "reasoning",
            "refusal",
            "function_call",
            "tool_calls",
          ].includes(key),
        )
      : [],
  };
  for (const candidate of candidates) {
    const text = textFromCompletionField(candidate.value);
    if (text) return { text, source: candidate.source, diagnostics };
  }
  return { text: "", source: "none", diagnostics };
}

function completionDiagnosticsLabel(diagnostics: CompletionDiagnostics) {
  return [
    `finish_reason=${diagnostics.finishReason || "unknown"}`,
    `message.content=${diagnostics.messageContentKind}`,
    `choice.text=${diagnostics.choiceTextKind}`,
    `output_text=${diagnostics.outputTextKind}`,
    `reasoning=${diagnostics.reasoningKind}`,
    `refusal=${diagnostics.refusalKind}`,
  ].join(", ");
}

function missingCompletionMessage(diagnostics: CompletionDiagnostics) {
  const cause =
    diagnostics.finishReason === "length"
      ? "模型响应在生成完成前被截断，未返回可读取的内容"
      : "模型接口已响应，但未返回可读取的内容";
  return `${cause}（${completionDiagnosticsLabel(diagnostics)}）`;
}

function completionUsage(data: ChatCompletionPayload) {
  const usage = data.usage;
  return usage
    ? {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      }
    : undefined;
}

async function callSinglePassCardStructurePlanner(
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

  const capacityRule =
    "按纯文字卡片的舒展密度预留容量；仅在完整语义边界确有必要时拆分。";
  const sourceAtoms = sentences
    .map((sentence) => {
      const hints = [
        sentence.hint || sentence.kind,
        sentence.boundaryKind || "soft",
        sentence.listGroupId || "",
      ]
        .filter(Boolean)
        .join(",");
      return `${sentence.id} [${hints}]: ${sentence.text}`;
    })
    .join("\n");
  const prompt = [
    "你是中文知识卡片的内容结构规划器。",
    "任务：把完整原文直接规划为‘单卡内容单元’。结构解析页会逐项展示这些单元，用户可手动拆分、合并和改标题；确认后系统会直接映射为卡片，因此每个 unit 必须对应恰好一张内容卡。",
    "只返回原文 ID 分组和单卡标题；不得改写、删减、总结原文，不得输出正文、导语、收尾、精华文案、卡片样式或解释。",
    capacityRule,
    "所有 sourceSentenceIds 必须且只能出现一次，并保持原文顺序。不能为了减少卡片把无关主题合并，也不能为了增加卡片把子步骤、命令、URL、路径或短过渡语单独分出。",
    "标题为 6-14 个汉字的原创概括，不得照抄正文开头，不得使用页码、省略号或‘内容小节’。",
    "标题、缩进、编号、段落只是边界证据；即使输入没有换行，也应依据主题、因果、转折和步骤关系分组。",
    `项目：${project.name || ""}\n内容类型：${project.contentType || project.eventType || "未填写"}\n主题/场景：${project.eventName || ""}`,
    "原文片段：\n" + sourceAtoms,
    '只返回 JSON：{"deckTitle":"整套卡片标题","deckSubtitle":"封面副标题","units":[{"id":"U01","title":"本页标题","role":"content","sourceSentenceIds":["S01-01"]}]}',
  ].join("\n\n");
  const maxTokens = structureMaxTokens(sentences.length);
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
            "Return valid JSON only. Produce one complete single-card structure plan; do not generate publication copy or a second planning stage.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
      ...fastStructuredOutputOptions(model),
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `模型接口调用失败：${response.status} ${detail.slice(0, 180)}`,
    );
  }
  const data = (await response.json()) as ChatCompletionPayload;
  const completion = completionText(data);
  if (!completion.text) {
    throw new Error(missingCompletionMessage(completion.diagnostics));
  }
  let plan: ModelPlan;
  try {
    plan = compactJsonFromModel(completion.text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "模型返回无法解析";
    throw new Error(`${message}（source=${completion.source}; ${completionDiagnosticsLabel(completion.diagnostics)}）`);
  }
  if (!Array.isArray(plan.units) || !plan.units.length) {
    throw new Error("模型未返回单卡内容结构");
  }
  return {
    plan,
    maxTokens,
    model,
    usage: completionUsage(data),
    completionSource: completion.source,
    responseDiagnostics: completion.diagnostics,
  };
}

/** Generates publication copy as an independent task, either in the background or for summary-only output. */
export async function generatePublicationDraft(
  project: ProjectPayload,
  env?: RuntimeEnv,
) {
  const originalText = project.originalText || "";
  if (!originalText.trim()) return { ok: false, error: "请先输入原文" };
  const traceId = `publication-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const startedAt = Date.now();
  const originalLength = [...originalText].length;
  const maxTokens = publicationMaxTokens(originalLength);
  console.info("[publication] start", {
    traceId,
    characters: originalLength,
    model: envString(env, "MODEL_NAME", "model_name") || "gpt-4.1-mini",
    maxTokens,
  });

  const fallback = () => {
    const publication = fallbackPublication(project);
    console.info("[publication] complete", {
      traceId,
      durationMs: Date.now() - startedAt,
      mode: "local-fallback",
    });
    return {
      ok: true,
      mode: "local-fallback" as const,
      ...publication,
      summaryGeneration: "local-fallback" as const,
      summaryWasRewritten: false,
    };
  };

  const baseUrl =
    envString(env, "MODEL_BASE_URL", "model_base_url").replace(/\/$/, "") ||
    "https://api.openai.com/v1";
  const apiKey = envString(env, "MODEL_KEY", "model_key", "OPENAI_API_KEY");
  const model = envString(env, "MODEL_NAME", "model_name") || "gpt-4.1-mini";
  if (!apiKey) return fallback();

  try {
    const task = [
      "根据用户原文生成一份可直接发布到小红书的精华文案。",
      `原文共 ${originalLength} 字；${originalLength > SUMMARY_REWRITE_THRESHOLD ? "需要重新组织和压缩" : "可轻量润色并优化阅读节奏"}。`,
      `标题、正文、标签合计目标约 ${SUMMARY_GENERATION_TARGET} 字，绝对不得超过 930 字。`,
      "根据场景自然选择口吻；开头有吸引力但不标题党，正文有具体信息和个人判断，结尾保留真实交流空间。",
      "不能编造原文未出现的人物、地点、对话、数字、感受或结论。少用模板词、空洞金句、emoji 和感叹号。",
      "返回 title、body、tags 与 2-8 字的 toneLabel。",
      `项目：${project.name || ""}\n内容类型：${project.contentType || project.eventType || "未填写"}\n主题/场景：${project.eventName || ""}`,
      "原文：\n" + originalText,
      '只返回 JSON：{"publication":{"title":"...","body":"...","tags":"#标签 #标签","toneLabel":"..."}}',
    ].join("\n\n");
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
              "Return valid JSON only. Generate publication copy only; do not plan cards or mention the generation process.",
          },
          { role: "user", content: task },
        ],
        temperature: 0.35,
        max_tokens: maxTokens,
        ...fastStructuredOutputOptions(model),
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) throw new Error(`模型接口调用失败：${response.status}`);
    const data = (await response.json()) as ChatCompletionPayload;
    const completion = completionText(data);
    if (!completion.text) {
      throw new Error(missingCompletionMessage(completion.diagnostics));
    }
    let plan: ModelPlan;
    let completionFormat: "json" | "plain-text" = "json";
    try {
      plan = compactJsonFromModel(completion.text);
    } catch (error) {
      const recovered = publicationPlanFromPlainText(completion.text, project);
      if (!recovered) {
        const message = error instanceof Error ? error.message : "模型返回无法解析";
        throw new Error(`${message}（source=${completion.source}; ${completionDiagnosticsLabel(completion.diagnostics)}）`);
      }
      plan = recovered;
      completionFormat = "plain-text";
    }
    if (!plan.publication?.body?.trim()) throw new Error("模型未返回精华文案");
    const publication = normalizePublication(project, plan);
    console.info("[publication] complete", {
      traceId,
      durationMs: Date.now() - startedAt,
      mode: "model",
      model,
      characterCount: publication.publicationCharacterCount,
      completionSource: completion.source,
      completionFormat,
      responseDiagnostics: completion.diagnostics,
      usage: completionUsage(data),
    });
    return {
      ok: true,
      mode: "model" as const,
      ...publication,
      summaryGeneration: "model" as const,
      summaryWasRewritten: originalLength > SUMMARY_REWRITE_THRESHOLD,
    };
  } catch (error) {
    console.warn("[publication] failed", {
      traceId,
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return fallback();
  }
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

  const traceId = `plan-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const startedAt = Date.now();
  console.info("[content-planning] start", {
    traceId,
    characters: [...originalText].length,
    sourceFragments: sentences.length,
    outputMode: project.outputMode || "card",
    model: envString(env, "MODEL_NAME", "model_name") || "gpt-4.1-mini",
    maxTokens: structureMaxTokens(sentences.length),
    stages: 1,
  });

  try {
    const {
      plan,
      maxTokens,
      model,
      usage,
      completionSource,
      responseDiagnostics,
    } = await callSinglePassCardStructurePlanner(
      env,
      project,
      sentences,
    );
    const normalized = normalizePlan(project, sentences, plan);
    console.info("[content-planning] structure-plan:complete", {
      traceId,
      durationMs: Date.now() - startedAt,
      model,
      maxTokens,
      completionSource,
      responseDiagnostics,
      usage,
      cardUnits: normalized.units.length,
    });
    console.info("[content-planning] complete", {
      traceId,
      durationMs: Date.now() - startedAt,
      mode: "model",
      cardUnits: normalized.units.length,
    });
    return {
      ok: true,
      mode: "model" as const,
      analysisRequestedMode: project.outputMode || "card",
      generatedModes: [] as const,
      sourceSentences: sentences,
      ...normalized,
      planningVersion: CARD_PLANNING_PROMPT_VERSION,
    };
  } catch (modelError) {
    console.warn("[content-planning] model-plan:failed", {
      traceId,
      durationMs: Date.now() - startedAt,
      message: modelError instanceof Error ? modelError.message : "Unknown error",
    });
    const fallback = fallbackPlan(project, sentences);
    console.info("[content-planning] complete", {
      traceId,
      durationMs: Date.now() - startedAt,
      mode: "local-fallback",
      cardUnits: fallback.units.length,
    });
    return {
      ok: true,
      mode: "local-fallback" as const,
      analysisRequestedMode: project.outputMode || "card",
      generatedModes: [] as const,
      warning:
        modelError instanceof Error
          ? modelError.message
          : "模型调用失败，已使用本地回退",
      sourceSentences: sentences,
      ...fallback,
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
