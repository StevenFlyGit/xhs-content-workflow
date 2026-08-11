import { createFileRoute } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  Eye,
  FileArchive,
  FileText,
  History,
  ImagePlus,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  Menu,
  Palette,
  PanelRight,
  Plus,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toBlob } from "html-to-image";
import JSZip from "jszip";
import {
  ContentBlockReview,
  type ContentBlock,
} from "../components/content-block-review";
import {
  CardPreview,
  measureCardLayout,
  type CardLayoutStatus,
} from "../components/card-preview";
import { SummaryEditor } from "../components/summary-editor";
import {
  generationSourceKey,
  hasCurrentGeneration,
  type GeneratedMode,
} from "../lib/generation-state";
import {
  publicationCharacterCount,
  publicationText,
  SUMMARY_PUBLICATION_LIMIT,
  SUMMARY_REWRITE_THRESHOLD,
} from "../lib/publication-limits";
import {
  buildSourceSentences,
  resolveSourceIds,
  type SourceSentence,
} from "../lib/source-segmentation";
import { compileCardsFromUnits, type CardUnit } from "../lib/card-units";
import {
  deleteCardMedia,
  getCardMediaUrl,
  saveCardMedia,
  type CardMedia,
} from "../lib/card-media";
import {
  analyzeSemanticProject,
  generateCardEnhancement,
  refineCardUnit,
  regenerateUnitTitle,
  type GenerateCardEnhancementRequest,
  type RefineCardUnitRequest,
  type RegenerateUnitTitleRequest,
} from "../semantic-cards.server";

export const Route = createFileRoute("/")({ component: Home });

type Step = "projects" | "input" | "editor" | "export";
type EditorPane = "structure" | "cards";
type Density = "relaxed" | "standard" | "compact";
type ThemeId =
  | "research-light"
  | "ai-dark"
  | "warm-reflection"
  | "structured-notes";
type Insight = ContentBlock;
type Card = {
  title: string;
  eyebrow: string;
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
type Version = {
  id: string;
  label: string;
  entity: string;
  at: string;
  sourceKey?: string;
  snapshot?: unknown;
};
type LocalWorkspace = {
  id: string;
  project: ProjectState;
  insights: Insight[];
  cards: Card[];
  theme: ThemeId;
  density: Density;
  editorMode?: OutputMode;
  updatedAt: string;
  editorPane?: EditorPane;
  sourceSentences?: SourceSentence[];
  analysisMode?: "model" | "local-fallback";
  analysisDirty?: boolean;
  versions?: Version[];
};

type OutputMode = "summary" | "card" | "image-card";
type ProjectState = {
  id?: string;
  name: string;
  eventName: string;
  eventType: string;
  contentType?: string;
  originalText: string;
  outputMode: OutputMode;
  requireImageMedia?: boolean;
  title: string;
  summary: string;
  tags: string;
  publicationTone?: string;
  summaryGeneration?: "model" | "local-fallback";
  summaryWasRewritten?: boolean;
  generatedModes?: GeneratedMode[];
  generatedSourceKey?: string;
  analysisRequestedMode?: OutputMode;
  /** Internal planning contract version; prompt configuration UI is intentionally deferred. */
  planningVersion?: string;
};

type SemanticApiResponse = {
  ok: boolean;
  mode?: "model" | "local-fallback";
  warning?: string;
  error?: string;
  title?: string;
  summary?: string;
  tags?: string;
  publicationTone?: string;
  publicationCharacterCount?: number;
  summaryGeneration?: "model" | "local-fallback";
  summaryWasRewritten?: boolean;
  generatedModes?: GeneratedMode[];
  analysisRequestedMode?: OutputMode;
  planningVersion?: string;
  cards?: Card[];
  sourceSentences?: SourceSentence[];
  units?: Array<{
    id: string;
    title: string;
    summary?: string;
    sourceSentenceIds: string[];
    role?: "content" | "ending";
  }>;
  semanticBlocks?: Array<{
    id: string;
    title: string;
    summary?: string;
    sourceSentenceIds: string[];
    estimatedCardCount?: number;
    role?: "content" | "ending";
  }>;
};

const densityOptions: Array<{
  id: Density;
  label: string;
  description: string;
}> = [
  {
    id: "relaxed",
    label: "舒展",
    description: "稍大字号与行距，适合文字较少的页面",
  },
  {
    id: "standard",
    label: "标准",
    description: "均衡留白与承载量，适合大多数页面",
  },
  {
    id: "compact",
    label: "紧凑",
    description: "小幅压缩间距，提升单页内容容量",
  },
];
const RECENT_CONTENT_TYPES_KEY = "xhs-compiler-recent-content-types";
const DEFAULT_CONTENT_TYPES = [
  "活动复盘",
  "读书感悟",
  "项目总结",
  "竞赛经验",
  "技术实践",
  "学习笔记",
  "旅行记录",
];

const analyzeSemanticCards = createServerFn({ method: "POST" })
  .validator((data: ProjectState) => data)
  .handler(async ({ data, context }) => {
    return analyzeSemanticProject(
      data,
      (context as { env?: Record<string, unknown> }).env,
    ) as Promise<SemanticApiResponse>;
  });
const regenerateSemanticUnitTitle = createServerFn({ method: "POST" })
  .validator((data: RegenerateUnitTitleRequest) => data)
  .handler(async ({ data, context }) => {
    return regenerateUnitTitle(
      data,
      (context as { env?: Record<string, unknown> }).env,
    );
  });
const generateSemanticCardEnhancement = createServerFn({ method: "POST" })
  .validator((data: GenerateCardEnhancementRequest) => data)
  .handler(async ({ data, context }) => {
    return generateCardEnhancement(
      data,
      (context as { env?: Record<string, unknown> }).env,
    );
  });
const refineSemanticCardUnit = createServerFn({ method: "POST" })
  .validator((data: RefineCardUnitRequest) => data)
  .handler(async ({ data, context }) => {
    return refineCardUnit(
      data,
      (context as { env?: Record<string, unknown> }).env,
    );
  });

const sampleText = `上周参加了一场关于 AI Agent 产品落地的圆桌讨论。相比模型能力本身，现场更多人关注的是 Agent 如何真正进入业务流程。

第一个共识是：Agent 的价值不在于“会聊天”，而在于能否在清晰边界内持续完成任务。工具调用、上下文管理和失败恢复，决定了它是不是一个可靠产品。

一位创业者分享了客服 Agent 的案例。早期团队追求全自动，结果因为异常场景太多，用户反而失去信任。后来他们把产品改成“默认执行、关键节点确认”，完成率和满意度同时提高。

我最大的认知变化是，Agent 产品设计不是不断增加自主性，而是设计合适的人机协作颗粒度。哪些步骤可以自动做，哪些决策必须解释，哪些风险需要用户确认，这些比 Demo 的惊艳程度更重要。

接下来我会用三个问题重新检查自己的产品：任务边界是否明确？失败后是否可恢复？用户是否随时知道系统正在做什么？这可能才是 Agent 从玩具走向工具的关键。`;

const initialSourceSentences = buildSourceSentences(sampleText);
const initialSentenceIds = (paragraphId: string) =>
  initialSourceSentences
    .filter((sentence) => sentence.paragraphId === paragraphId)
    .map((sentence) => sentence.id);

const initialProject: ProjectState = {
  name: "AI Agent 圆桌复盘",
  eventName: "AI Agent 产品落地圆桌",
  eventType: "Roundtable Discussion",
  contentType: "活动复盘",
  originalText: sampleText,
  outputMode: "card",
  title: "参加一场 AI 圆桌后，我重新理解了 Agent 产品",
  summary:
    "上周参加了一场关于 AI Agent 产品落地的圆桌。现场最重要的共识，不是模型又变强了，而是 Agent 如何真正进入业务流程。\n\n01｜价值不在“会聊天”\nAgent 能否在清晰边界内持续完成任务，取决于工具调用、上下文管理和失败恢复。\n\n02｜全自动不等于好产品\n一个客服 Agent 从全自动改为“默认执行、关键节点确认”后，完成率和满意度反而同时提高。\n\n03｜重新设计人机协作颗粒度\n哪些步骤可以自动做，哪些决策必须解释，哪些风险需要用户确认，比 Demo 的惊艳程度更重要。\n\n接下来我会用三个问题检查产品：任务边界是否明确？失败后是否可恢复？用户是否随时知道系统正在做什么？",
  tags: "#AI产品 #AIAgent #产品经理 #创业思考 #活动复盘",
  publicationTone: "严谨有思考",
  summaryGeneration: "model",
  summaryWasRewritten: false,
  generatedModes: ["summary", "card"],
  generatedSourceKey: generationSourceKey({
    originalText: sampleText,
  }),
  analysisRequestedMode: "card",
};

function createEmptyProject(name = "新内容项目"): ProjectState {
  return {
    name,
    eventName: "",
    eventType: "Roundtable Discussion",
    contentType: "",
    originalText: "",
    outputMode: "card",
    title: "",
    summary: "",
    tags: "",
  };
}

function normalizeOutputMode(
  value: unknown,
  fallback: unknown = "card",
): OutputMode {
  if (value === "summary" || value === "card" || value === "image-card")
    return value;
  return fallback === "summary" || fallback === "image-card"
    ? fallback
    : "card";
}

function isCardOutputMode(mode: OutputMode) {
  return mode === "card" || mode === "image-card";
}

function cardPresentationMode(mode: OutputMode): "card" | "image-card" {
  return mode === "image-card" ? "image-card" : "card";
}

const initialInsights: Insight[] = [
  {
    id: "insight-1",
    title: "圆桌讨论的关注点",
    summary: "讨论从模型能力转向 Agent 如何真正进入业务流程。",
    sourceIds: initialSentenceIds("P01"),
  },
  {
    id: "insight-2",
    title: "Agent 的价值不在“会聊天”",
    summary: "能否在清晰边界内持续完成任务，才是 Agent 成为可靠产品的关键。",
    sourceIds: initialSentenceIds("P02"),
  },
  {
    id: "insight-3",
    title: "全自动不等于更好的体验",
    summary: "默认执行、关键节点确认，让完成率与用户信任同时提升。",
    sourceIds: initialSentenceIds("P03"),
  },
  {
    id: "insight-4",
    title: "设计人机协作的颗粒度",
    summary: "自主性不是越多越好，解释、确认与风险边界同样重要。",
    sourceIds: initialSentenceIds("P04"),
  },
  {
    id: "insight-5",
    title: "用三个问题检查 Agent 产品",
    summary: "任务边界、失败恢复、过程可见性，决定 Agent 能否从玩具走向工具。",
    sourceIds: initialSentenceIds("P05"),
  },
];

const initialCards: Card[] = [
  {
    eyebrow: "AI AGENT ROUNDTABLE",
    title: "我重新理解了\nAgent 产品",
    body: "一场圆桌讨论后，关于任务边界、用户信任与人机协作的 4 个关键认知。",
  },
  {
    eyebrow: "01 · 核心共识",
    title: "价值不在\n“会聊天”",
    body: "Agent 能否在清晰边界内持续完成任务，取决于它是不是一个可靠的执行系统。",
    bullets: ["工具调用是否稳定", "上下文是否连续", "失败后是否可恢复"],
  },
  {
    eyebrow: "02 · 真实案例",
    title: "全自动，未必是\n更好的产品",
    body: "客服 Agent 从“完全自动”调整为“默认执行、关键节点确认”后，完成率和满意度同时提高。",
  },
  {
    eyebrow: "03 · 认知变化",
    title: "设计协作颗粒度",
    body: "哪些步骤可以自动做，哪些决策必须解释，哪些风险需要用户确认，比 Demo 是否惊艳更重要。",
  },
  {
    eyebrow: "04 · 行动清单",
    title: "重新检查产品",
    body: "下一次设计 Agent 时，先回答这三个问题。",
    bullets: [
      "任务边界是否明确？",
      "失败之后是否可恢复？",
      "用户是否知道系统在做什么？",
    ],
  },
  {
    eyebrow: "SUMMARY",
    title: "从玩具走向工具",
    body: "真正的 Agent 产品，不是不断增加自主性，而是在自动执行与用户控制之间建立可持续的信任。",
  },
];

const initialVersions: Version[] = [];

function normalizeVersions(value: unknown): Version[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<Version>;
    if (
      typeof record.id !== "string" ||
      typeof record.label !== "string" ||
      typeof record.entity !== "string" ||
      typeof record.at !== "string"
    )
      return [];
    return [
      {
        id: record.id,
        label: record.label,
        entity: record.entity,
        at: record.at,
        sourceKey:
          typeof record.sourceKey === "string" ? record.sourceKey : undefined,
        snapshot: record.snapshot,
      },
    ];
  });
}

function historyTimestamp() {
  return new Date().toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function normalizeCard(card: Partial<Card> | undefined, index = 0): Card {
  return {
    eyebrow:
      typeof card?.eyebrow === "string" && card.eyebrow.trim()
        ? card.eyebrow
        : `${String(index + 1).padStart(2, "0")} · 原文卡片`,
    title:
      typeof card?.title === "string" && card.title.trim()
        ? card.title
        : `第 ${index + 1} 页`,
    body: typeof card?.body === "string" ? card.body : "",
    bullets: Array.isArray(card?.bullets)
      ? card.bullets.filter((item) => typeof item === "string")
      : undefined,
    addedLead: typeof card?.addedLead === "string" ? card.addedLead : undefined,
    addedEnding:
      typeof card?.addedEnding === "string" ? card.addedEnding : undefined,
    enhancement:
      card?.enhancement && typeof card.enhancement === "object"
        ? {
            leadEnabled: card.enhancement.leadEnabled === true,
            endingEnabled: card.enhancement.endingEnabled === true,
            source: card.enhancement.source === "model" ? "model" : "manual",
          }
        : undefined,
    semanticBlockId:
      typeof card?.semanticBlockId === "string"
        ? card.semanticBlockId
        : undefined,
    pageRole: typeof card?.pageRole === "string" ? card.pageRole : undefined,
    sourceSentenceIds: Array.isArray(card?.sourceSentenceIds)
      ? card.sourceSentenceIds.filter((item) => typeof item === "string")
      : undefined,
    sourceRevision:
      typeof card?.sourceRevision === "string"
        ? card.sourceRevision
        : undefined,
    stale: card?.stale === true,
    manualTitle: card?.manualTitle === true,
    manualBody: card?.manualBody === true,
    media:
      card?.media &&
      typeof card.media === "object" &&
      typeof card.media.blobKey === "string"
        ? (card.media as CardMedia)
        : undefined,
  };
}

function normalizeCards(value: unknown): Card[] {
  return Array.isArray(value)
    ? value.map((item, index) => normalizeCard(item as Partial<Card>, index))
    : [];
}

function normalizeInsightSources(
  insights: Insight[],
  sentences: SourceSentence[],
): Insight[] {
  return insights.map((insight) => ({
    ...insight,
    role: insight.role === "ending" ? "ending" : "content",
    status: insight.status || "draft",
    sourceIds: resolveSourceIds(
      Array.isArray(insight.sourceIds) ? insight.sourceIds : [],
      sentences,
    ),
  }));
}

/** Automatically rebuilds legacy local source atoms; users never see a migration step. */
function normalizeSourceSentences(
  value: unknown,
  originalText: string,
): SourceSentence[] {
  if (!Array.isArray(value) || !value.length)
    return buildSourceSentences(originalText);
  const valid = value.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as SourceSentence).id === "string" &&
      typeof (item as SourceSentence).text === "string" &&
      typeof (item as SourceSentence).paragraphId === "string" &&
      typeof (item as SourceSentence).order === "number" &&
      typeof (item as SourceSentence).kind === "string",
  );
  return valid
    ? [...(value as SourceSentence[])].sort(
        (left, right) => left.order - right.order,
      )
    : buildSourceSentences(originalText);
}

function buildCardsFromBlocks(
  project: ProjectState,
  blocks: Insight[],
  sentences: SourceSentence[],
  existingCards: Card[],
): Card[] {
  const existingCover = normalizeCards(existingCards).find(
    (card) => card.pageRole === "cover",
  );
  const cover: Card = existingCover
    ? {
        ...existingCover,
        pageRole: "cover",
        semanticBlockId: undefined,
        sourceSentenceIds: [],
      }
    : {
        eyebrow: project.eventName || "完整原文卡片",
        title: project.title || project.name || project.eventName || "内容整理",
        body: `以下内容已按 ${blocks.length} 个主题分块，正文完整保留原文。`,
        pageRole: "cover",
        sourceSentenceIds: [],
      };
  const units: CardUnit[] = blocks.map((block) => ({
    id: block.id,
    title: block.title,
    sourceSentenceIds: block.sourceIds,
    role: block.role === "ending" ? "ending" : "content",
    status: "ready",
    sourceRevision: block.sourceRevision,
    structureRevision: block.structureRevision,
    titleOrigin: block.titleOrigin,
  }));
  const contentCards = compileCardsFromUnits(
    units,
    sentences,
    normalizeCards(existingCards),
  );
  return [cover, ...contentCards];
}

const themes: {
  id: ThemeId;
  name: string;
  desc: string;
  swatches: string[];
}[] = [
  {
    id: "research-light",
    name: "Research Light",
    desc: "清晰 · 理性",
    swatches: ["#ffffff", "#2563eb", "#111827"],
  },
  {
    id: "ai-dark",
    name: "AI Dark",
    desc: "技术 · 高对比",
    swatches: ["#111827", "#8b5cf6", "#f8fafc"],
  },
  {
    id: "warm-reflection",
    name: "Warm Reflection",
    desc: "温暖 · 叙事",
    swatches: ["#fffaf0", "#c56a3d", "#3f342f"],
  },
  {
    id: "structured-notes",
    name: "Structured Notes",
    desc: "冷灰 · 墨绿",
    swatches: ["#f3f4f6", "#0f766e", "#1f2937"],
  },
];

const navItems: {
  id: Step;
  label: string;
  icon: typeof LayoutDashboard;
  number?: number;
}[] = [
  { id: "projects", label: "项目工作台", icon: LayoutDashboard },
  { id: "input", label: "内容输入", icon: FileText, number: 1 },
  { id: "editor", label: "内容编辑器", icon: PanelRight, number: 2 },
  { id: "export", label: "内容导出", icon: FileArchive, number: 4 },
];

function safeFileName(value: string) {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "内容卡片"
  );
}

async function renderCardPng(
  card: Card,
  theme: ThemeId,
  density: Density,
  page: number,
  total: number,
  presentation: OutputMode,
  mediaUrl?: string,
) {
  const host = document.createElement("div");
  host.className = "export-render-host";
  const root = document.createElement("div");
  host.appendChild(root);
  document.body.appendChild(host);
  const { createRoot } = await import("react-dom/client");
  const reactRoot = createRoot(root);
  reactRoot.render(
    <CardPreview
      card={card}
      theme={theme}
      density={density}
      page={page}
      total={total}
      presentation={presentation}
      mediaUrl={mediaUrl}
    />,
  );
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  try {
    const node = root.querySelector(".card-preview") as HTMLElement | null;
    if (!node) throw new Error("卡片渲染失败");
    const layout = measureCardLayout(node);
    if (layout.horizontalOverflow)
      throw new Error(`第 ${page} 页仍有横向溢出，请缩短标题或正文后再导出`);
    const blob = await toBlob(node, {
      width: 410,
      height: 546.6667,
      canvasWidth: 1080,
      canvasHeight: 1440,
      pixelRatio: 1,
      cacheBust: true,
      backgroundColor:
        theme === "ai-dark"
          ? "#111827"
          : theme === "warm-reflection"
            ? "#fffaf0"
            : theme === "structured-notes"
              ? "#f3f4f6"
              : "#ffffff",
      style: { width: "410px", height: "546.6667px", boxShadow: "none" },
    });
    if (!blob) throw new Error("图片编码失败");
    return blob;
  } finally {
    reactRoot.unmount();
    host.remove();
  }
}

async function buildImagePackage(
  project: ProjectState,
  cards: Card[],
  theme: ThemeId,
  density: Density,
  insights: Insight[],
  paragraphs: { id: string; text: string }[],
  sourceSentences: SourceSentence[],
) {
  const zip = new JSZip();
  const generatedAt = new Date().toISOString();
  const characterCount = publicationCharacterCount({
    title: project.title,
    body: project.summary,
    tags: project.tags,
  });
  const cardMode = isCardOutputMode(project.outputMode);
  const outputDensity =
    project.outputMode === "image-card" ? "compact" : density;
  if (
    project.outputMode === "image-card" &&
    project.requireImageMedia &&
    cards.some((card) => card.pageRole !== "cover" && !card.media)
  )
    throw new Error(
      "\u6bcf\u5f20\u5185\u5bb9\u5361\u90fd\u9700\u4e0a\u4f20\u56fe\u7247\u624d\u80fd\u5bfc\u51fa",
    );
  const exportedCardCount = cardMode ? cards.length : 0;
  const manifest = {
    projectName: project.name,
    contentType: project.contentType || project.eventType || null,
    mode: project.outputMode,
    generatedModes: project.generatedModes || [],
    analysisRequestedMode: project.analysisRequestedMode || null,
    generatedSourceKey: project.generatedSourceKey || null,
    title: project.title,
    characterCount,
    cardCount: exportedCardCount,
    template: theme,
    density: outputDensity,
    imageSize: cardMode ? "1080x1440" : null,
    imageFormat: cardMode ? "png" : null,
    generatedAt,
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("title.txt", project.title);
  zip.file("content.txt", project.summary);
  zip.file("tags.txt", project.tags);
  if (project.outputMode === "summary") {
    zip.file(
      "publish-ready.txt",
      publicationText({
        title: project.title,
        body: project.summary,
        tags: project.tags,
      }),
    );
  }
  zip.file("source/original.txt", project.originalText);
  zip.file(
    "source/structured-content.json",
    JSON.stringify(
      {
        contentType: project.contentType || project.eventType || null,
        contentBlocks: insights,
        sourceParagraphs: paragraphs,
        sourceSentences,
      },
      null,
      2,
    ),
  );
  if (cardMode) {
    for (let index = 0; index < cards.length; index += 1) {
      const mediaUrl =
        project.outputMode === "image-card"
          ? await getCardMediaUrl(cards[index].media).catch(() => undefined)
          : undefined;
      try {
        const png = await renderCardPng(
          cards[index],
          theme,
          outputDensity,
          index + 1,
          cards.length,
          project.outputMode,
          mediaUrl,
        );
        zip.file(`cards/card-${String(index + 1).padStart(2, "0")}.png`, png);
      } finally {
        if (mediaUrl) URL.revokeObjectURL(mediaUrl);
      }
    }
  }
  return {
    blob: await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    }),
    manifest,
  };
}

function Home() {
  const analyzeCardsFn = useServerFn(analyzeSemanticCards);
  const regenerateUnitTitleFn = useServerFn(regenerateSemanticUnitTitle);
  const generateCardEnhancementFn = useServerFn(
    generateSemanticCardEnhancement,
  );
  const refineCardUnitFn = useServerFn(refineSemanticCardUnit);
  const [step, setStep] = useState<Step>("input");
  const [project, setProject] = useState<ProjectState>(initialProject);
  const [insights, setInsights] = useState<Insight[]>(initialInsights);
  const [sourceSentences, setSourceSentences] = useState<SourceSentence[]>(
    initialSourceSentences,
  );
  const [analysisMode, setAnalysisMode] = useState<"model" | "local-fallback">(
    "model",
  );
  const [analysisDirty, setAnalysisDirty] = useState(false);
  const [cards, setCards] = useState<Card[]>(initialCards);
  const [theme, setTheme] = useState<ThemeId>("research-light");
  const [density, setDensity] = useState<Density>("standard");
  const [editorPane, setEditorPane] = useState<EditorPane>("structure");
  const [activeCard, setActiveCard] = useState(0);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("sample-project");
  const [storageReady, setStorageReady] = useState(false);
  const [workspaces, setWorkspaces] = useState<LocalWorkspace[]>([
    {
      id: "sample-project",
      project: initialProject,
      insights: initialInsights,
      cards: initialCards,
      theme: "research-light",
      density: "standard",
      updatedAt: "刚刚",
      sourceSentences: initialSourceSentences,
      analysisMode: "model",
      versions: initialVersions,
    },
  ]);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [analysisState, setAnalysisState] = useState<
    "idle" | "loading" | "done" | "error"
  >("done");
  const [toast, setToast] = useState("");
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>(initialVersions);
  const [mobileNav, setMobileNav] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [recentContentTypes, setRecentContentTypes] = useState<string[]>(
    DEFAULT_CONTENT_TYPES,
  );
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const paragraphs = useMemo(
    () =>
      project.originalText
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((text, i) => ({ id: `P${String(i + 1).padStart(2, "0")}`, text })),
    [project.originalText],
  );
  const charCount = [...project.originalText].length;
  const publicationCount = publicationCharacterCount({
    title: project.title,
    body: project.summary,
    tags: project.tags,
  });
  const publicationOverLimit = publicationCount > SUMMARY_PUBLICATION_LIMIT;
  const estimatedCards = Math.max(3, Math.min(12, Math.ceil(charCount / 230)));
  const summaryReady =
    hasCurrentGeneration(project, "summary") &&
    Boolean(project.summaryGeneration && project.summary.trim());
  const cardGenerationAvailable =
    hasCurrentGeneration(project, "card") && !analysisDirty && cards.length > 0;
  const generatedCardPresentation = cardPresentationMode(
    project.analysisRequestedMode || "card",
  );
  const cardsReady =
    cardGenerationAvailable &&
    (project.outputMode === "summary" ||
      cardPresentationMode(project.outputMode) === generatedCardPresentation);
  const completeCardCount =
    cardGenerationAvailable && generatedCardPresentation === "card"
      ? cards.length
      : 0;
  const imageCardCount =
    cardGenerationAvailable && generatedCardPresentation === "image-card"
      ? cards.length
      : 0;
  const mediaSignature = useMemo(
    () => cards.map((card) => card.media?.blobKey || "").join("|"),
    [cards],
  );

  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(RECENT_CONTENT_TYPES_KEY) || "[]",
      );
      const cleaned = Array.isArray(saved)
        ? saved
            .filter(
              (value): value is string =>
                typeof value === "string" &&
                value.trim().length >= 2 &&
                value.trim().length <= 40,
            )
            .map((value) => value.trim())
        : [];
      setRecentContentTypes(
        [...new Set([...cleaned, ...DEFAULT_CONTENT_TYPES])].slice(0, 20),
      );
    } catch {
      setRecentContentTypes(DEFAULT_CONTENT_TYPES);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const createdUrls: string[] = [];
    Promise.all(
      cards.map(async (card, index) => {
        const url = await getCardMediaUrl(card.media).catch(() => undefined);
        if (url) createdUrls.push(url);
        return [String(index), url] as const;
      }),
    ).then((entries) => {
      if (disposed) {
        entries.forEach(([, url]) => {
          if (url) URL.revokeObjectURL(url);
        });
        return;
      }
      setMediaUrls(
        Object.fromEntries(entries.filter(([, url]) => Boolean(url))) as Record<
          string,
          string
        >,
      );
    });
    return () => {
      disposed = true;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [mediaSignature]);

  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("xhs-compiler-workspaces") || "[]",
      ) as LocalWorkspace[];
      if (Array.isArray(saved) && saved.length) {
        const normalized = saved.map((workspace) => {
          const sentences = normalizeSourceSentences(
            workspace.sourceSentences,
            workspace.project.originalText,
          );
          const {
            editorMode: legacyEditorMode,
            exports: _removedExportRecords,
            ...workspaceWithoutLegacyMode
          } = workspace as LocalWorkspace & { exports?: unknown };
          return {
            ...workspaceWithoutLegacyMode,
            project: {
              ...workspace.project,
              outputMode: normalizeOutputMode(
                workspace.project.outputMode,
                legacyEditorMode,
              ),
            },
            sourceSentences: sentences,
            insights: normalizeInsightSources(
              workspace.insights || [],
              sentences,
            ),
            versions: normalizeVersions(workspace.versions),
          };
        });
        const first = normalized[0];
        setWorkspaces(normalized);
        setActiveWorkspaceId(first.id);
        setProject(first.project);
        setInsights(first.insights || []);
        setSourceSentences(first.sourceSentences || []);
        setAnalysisMode(first.analysisMode || "local-fallback");
        setAnalysisDirty(first.analysisDirty === true);
        setCards(normalizeCards(first.cards));
        setTheme(first.theme || "research-light");
        setDensity(first.density || "standard");
        setEditorPane(
          first.editorPane || (first.cards?.length ? "cards" : "structure"),
        );
        setVersions(first.versions || []);
        setAnalysisState(first.insights?.length ? "done" : "idle");
      } else if (
        Array.isArray(saved) &&
        localStorage.getItem("xhs-compiler-workspaces")
      ) {
        setWorkspaces([]);
        setActiveWorkspaceId("");
        setProject(createEmptyProject());
        setInsights([]);
        setSourceSentences([]);
        setCards([]);
        setVersions([]);
        setAnalysisState("idle");
        setStep("projects");
      }
    } catch {
      localStorage.removeItem("xhs-compiler-workspaces");
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady || !activeWorkspaceId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async () => {
      const currentWorkspace: LocalWorkspace = {
        id: activeWorkspaceId,
        project,
        insights,
        sourceSentences,
        analysisMode,
        analysisDirty,
        cards,
        theme,
        density,
        editorPane,
        versions,
        updatedAt: "刚刚",
      };
      setWorkspaces((list) => {
        const next = list.some((item) => item.id === activeWorkspaceId)
          ? list.map((item) =>
              item.id === activeWorkspaceId ? currentWorkspace : item,
            )
          : [currentWorkspace, ...list];
        localStorage.setItem("xhs-compiler-workspaces", JSON.stringify(next));
        return next;
      });
      setSaveState("saved");
    }, 700);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [
    project,
    insights,
    sourceSentences,
    analysisMode,
    analysisDirty,
    cards,
    theme,
    density,
    editorPane,
    versions,
    activeWorkspaceId,
    storageReady,
  ]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }
  function persistActiveVersions(nextVersions: Version[]) {
    if (!activeWorkspaceId) return;
    const snapshot: LocalWorkspace = {
      id: activeWorkspaceId,
      project,
      insights,
      sourceSentences,
      analysisMode,
      analysisDirty,
      cards,
      theme,
      density,
      editorPane,
      versions: nextVersions,
      updatedAt: "刚刚",
    };
    setWorkspaces((list) => {
      const next = list.some((item) => item.id === activeWorkspaceId)
        ? list.map((item) => (item.id === activeWorkspaceId ? snapshot : item))
        : [snapshot, ...list];
      localStorage.setItem("xhs-compiler-workspaces", JSON.stringify(next));
      return next;
    });
  }

  function updateProject<K extends keyof ProjectState>(
    key: K,
    value: ProjectState[K],
  ) {
    const invalidatesGeneration = key === "originalText";
    setProject((current) => {
      const next = { ...current, [key]: value };
      if (!invalidatesGeneration) return next;
      return {
        ...next,
        generatedModes: [],
        generatedSourceKey: undefined,
        analysisRequestedMode: undefined,
        publicationTone: undefined,
        summaryGeneration: undefined,
        summaryWasRewritten: undefined,
      };
    });
    if (invalidatesGeneration) {
      setAnalysisState("idle");
      setAnalysisDirty(false);
    }
  }

  function rememberContentType(
    value = project.contentType || project.eventType,
  ) {
    const normalized = value.trim();
    if (normalized.length < 2 || normalized.length > 40) return;
    setRecentContentTypes((current) => {
      const next = [
        normalized,
        ...current.filter((item) => item !== normalized),
      ].slice(0, 20);
      localStorage.setItem(RECENT_CONTENT_TYPES_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function updateCardMedia(index: number, file?: File) {
    const current = normalizeCards(cards)[index];
    if (!current) return false;
    if (!file) {
      if (current.media)
        await deleteCardMedia(current.media).catch(() => undefined);
      setCards((list) =>
        normalizeCards(list).map((card, cardIndex) =>
          cardIndex === index ? { ...card, media: undefined } : card,
        ),
      );
      notify("已移除这张卡片的图片");
      return true;
    }
    try {
      const media = await saveCardMedia(file);
      if (current.media)
        await deleteCardMedia(current.media).catch(() => undefined);
      setCards((list) =>
        normalizeCards(list).map((card, cardIndex) =>
          cardIndex === index ? { ...card, media } : card,
        ),
      );
      notify("图片已保存在当前浏览器，可随卡片一起导出");
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "图片上传失败，请重试");
      return false;
    }
  }

  async function enhanceCard(card: Card, kind: "lead" | "ending") {
    const text = [card.title, card.body, ...(card.bullets || [])]
      .filter(Boolean)
      .join("\n");
    const result = await generateCardEnhancementFn({ data: { kind, text } });
    if (result.text) {
      notify(
        result.mode === "model"
          ? "\u5df2\u751f\u6210\u5c0f\u5b57\u5efa\u8bae"
          : "\u6a21\u578b\u4e0d\u53ef\u7528\uff0c\u5df2\u4f7f\u7528\u672c\u5730\u5efa\u8bae",
      );
      return result.text;
    }
    notify(
      "\u672a\u80fd\u751f\u6210\u5c0f\u5b57\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5",
    );
    return undefined;
  }

  async function refineInsight(block: Insight) {
    const ids = new Set(block.sourceIds);
    const result = await refineCardUnitFn({
      data: {
        unitId: block.id,
        title: block.title,
        sourceSentenceIds: block.sourceIds,
        sourceSentences: sourceSentences.filter((sentence) =>
          ids.has(sentence.id),
        ),
        density: project.outputMode === "image-card" ? "compact" : "relaxed",
      },
    });
    if (!result.units?.length) {
      notify(
        "\u672a\u80fd\u4f18\u5316\u5f53\u524d\u5355\u5143\uff0c\u8bf7\u6539\u4e3a\u624b\u5de5\u62c6\u5206",
      );
      return undefined;
    }
    notify(
      result.mode === "model"
        ? "\u5df2\u4ec5\u5bf9\u5f53\u524d\u5355\u5143\u91cd\u65b0\u5206\u5757"
        : "\u6a21\u578b\u4e0d\u53ef\u7528\uff0c\u5df2\u751f\u6210\u53ef\u7ee7\u7eed\u68c0\u67e5\u7684\u5b89\u5168\u62c6\u5206",
    );
    return result.units.map((unit, index) => ({
      id: crypto.randomUUID(),
      title: unit.title,
      summary:
        "\u7531\u5f53\u524d\u5355\u5143\u5c40\u90e8\u4f18\u5316\u751f\u6210",
      sourceIds: unit.sourceSentenceIds,
      role: unit.role === "ending" ? "ending" : "content",
      status: "manual" as const,
      sourceRevision: block.sourceRevision,
      structureRevision: (block.structureRevision || 1) + 1,
      titleOrigin:
        result.mode === "model" ? ("model" as const) : ("rule" as const),
      note: index === 0 ? "\u5c40\u90e8 AI \u4f18\u5316" : undefined,
    }));
  }

  async function retitleInsight(block: Insight) {
    const ids = new Set(block.sourceIds);
    const text = sourceSentences
      .filter((sentence) => ids.has(sentence.id))
      .map((sentence) => sentence.text)
      .join("\n");
    const result = await regenerateUnitTitleFn({
      data: { text, currentTitle: block.title },
    });
    if (result.title) {
      notify(
        result.mode === "model"
          ? "已由模型生成新的概括标题"
          : "模型不可用，已使用规则建议标题",
      );
      return result.title;
    }
    notify("未能生成新标题，请稍后重试");
    return undefined;
  }
  function createLocalProject() {
    const current: LocalWorkspace = {
      id: activeWorkspaceId,
      project,
      insights,
      sourceSentences,
      analysisMode,
      analysisDirty,
      cards,
      theme,
      density,
      editorPane,
      versions,
      updatedAt: "刚刚",
    };
    const id = crypto.randomUUID();
    const nextNumber =
      workspaces.filter((item) => item.project.name.startsWith("新内容项目"))
        .length + 1;
    const empty: LocalWorkspace = {
      id,
      project: createEmptyProject(`新内容项目 ${nextNumber}`),
      insights: [],
      cards: [],
      theme: "research-light",
      density: "standard",
      editorPane: "structure",
      updatedAt: "刚刚创建",
      sourceSentences: [],
      analysisMode: "local-fallback",
      versions: [],
    };
    const preserved = activeWorkspaceId
      ? [current, ...workspaces.filter((item) => item.id !== activeWorkspaceId)]
      : workspaces;
    const next = [empty, ...preserved];
    setWorkspaces(next);
    localStorage.setItem("xhs-compiler-workspaces", JSON.stringify(next));
    setActiveWorkspaceId(id);
    setProject(empty.project);
    setInsights(empty.insights);
    setSourceSentences([]);
    setAnalysisMode("local-fallback");
    setAnalysisDirty(false);
    setCards(empty.cards);
    setVersions([]);
    setActiveCard(0);
    setTheme(empty.theme);
    setDensity(empty.density);
    setEditorPane("structure");
    setAnalysisState("idle");
    setEvidenceId(null);
    setStep("projects");
    setMobileNav(false);
    notify(`已创建“${empty.project.name}”，原项目内容保持不变`);
  }

  function openWorkspace(workspace: LocalWorkspace) {
    const current: LocalWorkspace = {
      id: activeWorkspaceId,
      project,
      insights,
      sourceSentences,
      analysisMode,
      analysisDirty,
      cards,
      theme,
      density,
      editorPane,
      versions,
      updatedAt: "刚刚",
    };
    const nextSourceSentences = normalizeSourceSentences(
      workspace.sourceSentences,
      workspace.project.originalText,
    );
    setWorkspaces((list) => {
      const next = list.map((item) =>
        item.id === activeWorkspaceId ? current : item,
      );
      localStorage.setItem("xhs-compiler-workspaces", JSON.stringify(next));
      return next;
    });
    setActiveWorkspaceId(workspace.id);
    setProject({
      ...workspace.project,
      outputMode: normalizeOutputMode(
        workspace.project.outputMode,
        workspace.editorMode,
      ),
    });
    setInsights(
      normalizeInsightSources(workspace.insights, nextSourceSentences),
    );
    setSourceSentences(nextSourceSentences);
    setAnalysisMode(workspace.analysisMode || "local-fallback");
    setAnalysisDirty(workspace.analysisDirty === true);
    setCards(normalizeCards(workspace.cards));
    setTheme(workspace.theme);
    setDensity(workspace.density);
    setEditorPane(
      workspace.editorPane || (workspace.cards.length ? "cards" : "structure"),
    );
    setVersions(normalizeVersions(workspace.versions));
    setActiveCard(0);
    setAnalysisState(workspace.insights.length ? "done" : "idle");
    setEvidenceId(null);
    setStep("input");
    setMobileNav(false);
    notify(
      `已切换到${workspace.project.name ? `“${workspace.project.name}”` : "未命名项目"}`,
    );
  }

  function deleteWorkspace(workspace: LocalWorkspace) {
    const name = workspace.project.name || "未命名项目";
    if (
      !window.confirm(
        `确定删除“${name}”吗？\n\n该项目在当前浏览器中的输入、解析结果、卡片和版本都会被永久删除，且无法恢复。`,
      )
    )
      return;
    void Promise.all(
      normalizeCards(workspace.cards).map((card) =>
        deleteCardMedia(card.media).catch(() => undefined),
      ),
    );
    const current: LocalWorkspace = {
      id: activeWorkspaceId,
      project,
      insights,
      sourceSentences,
      analysisMode,
      analysisDirty,
      cards,
      theme,
      density,
      editorPane,
      versions,
      updatedAt: "刚刚",
    };
    const remaining = workspaces
      .map((item) => (item.id === activeWorkspaceId ? current : item))
      .filter((item) => item.id !== workspace.id);
    setWorkspaces(remaining);
    localStorage.setItem("xhs-compiler-workspaces", JSON.stringify(remaining));
    if (workspace.id === activeWorkspaceId) {
      const next = remaining[0];
      if (next) {
        const nextSourceSentences = normalizeSourceSentences(
          next.sourceSentences,
          next.project.originalText,
        );
        setActiveWorkspaceId(next.id);
        setProject({
          ...next.project,
          outputMode: normalizeOutputMode(
            next.project.outputMode,
            next.editorMode,
          ),
        });
        setInsights(
          normalizeInsightSources(next.insights || [], nextSourceSentences),
        );
        setSourceSentences(nextSourceSentences);
        setAnalysisMode(next.analysisMode || "local-fallback");
        setAnalysisDirty(next.analysisDirty === true);
        setCards(normalizeCards(next.cards));
        setTheme(next.theme || "research-light");
        setDensity(next.density || "standard");
        setEditorPane(
          next.editorPane || (next.cards?.length ? "cards" : "structure"),
        );
        setVersions(normalizeVersions(next.versions));
        setAnalysisState(next.insights?.length ? "done" : "idle");
      } else {
        setActiveWorkspaceId("");
        setProject(createEmptyProject());
        setInsights([]);
        setSourceSentences([]);
        setCards([]);
        setVersions([]);
        setAnalysisState("idle");
      }
    }
    setActiveCard(0);
    setAnalysisDirty(false);
    setEvidenceId(null);
    setStep("projects");
    notify(`已删除“${name}”及其本地数据`);
  }

  async function runAnalysis(options: { stayInEditor?: boolean } = {}) {
    if (!project.originalText.trim()) return notify("请先输入活动内容");
    if (charCount > 10000) return notify("原文超过 10000 字符，请先精简");
    const protectedCards = normalizeCards(cards).filter(
      (card) =>
        card.manualTitle ||
        card.manualBody ||
        Boolean(card.addedLead || card.addedEnding) ||
        Boolean(
          card.enhancement?.leadEnabled || card.enhancement?.endingEnabled,
        ) ||
        Boolean(card.media),
    );
    if (protectedCards.length) {
      const confirmed = window.confirm(
        "\u91cd\u65b0\u89e3\u6790\u4f1a\u6e05\u7a7a\u5f53\u524d\u5361\u7247\u7ed3\u6784\u3002\u5176\u4e2d " +
          protectedCards.length +
          " \u5f20\u542b\u6709\u624b\u5de5\u4fee\u6539\u3001\u5c0f\u5b57\u6216\u672c\u5730\u56fe\u7247\uff1b\u7ee7\u7eed\u540e\u5c06\u653e\u5f03\u5f53\u524d\u5361\u7247\u5bf9\u5e94\u5173\u7cfb\uff0c\u662f\u5426\u7ee7\u7eed\uff1f",
      );
      if (!confirmed) return;
    }
    const requestedSourceKey = generationSourceKey(project);
    setAnalysisState("loading");
    setEditorPane("structure");
    setStep("editor");
    try {
      const result = (await analyzeCardsFn({
        data: project,
      })) as SemanticApiResponse;
      if (!result.ok) throw new Error(result.error || "语义解析失败");
      const nextSourceSentences = normalizeSourceSentences(
        result.sourceSentences,
        project.originalText,
      );
      const returnedModes = (result.generatedModes || []).filter(
        (mode): mode is GeneratedMode => mode === "summary" || mode === "card",
      );
      const generatedModes = returnedModes.filter((mode) =>
        mode === "summary"
          ? Boolean(result.summary?.trim() && result.summaryGeneration)
          : false,
      );
      const blockInsights: Insight[] = (
        result.units ||
        result.semanticBlocks ||
        []
      ).map((block, index) => ({
        id: block.id || `block-${index + 1}`,
        title: block.title || `语义块 ${index + 1}`,
        summary:
          block.summary ||
          `包含 ${block.sourceSentenceIds.length} 个原文句子，对应 1 张内容卡。`,
        sourceIds: resolveSourceIds(
          block.sourceSentenceIds,
          nextSourceSentences,
        ),
        role: block.role === "ending" ? "ending" : "content",
        status: "draft",
        sourceRevision: requestedSourceKey,
        structureRevision: 1,
        titleOrigin: result.mode === "model" ? "model" : "rule",
      }));
      setInsights(blockInsights);
      setSourceSentences(nextSourceSentences);
      setAnalysisMode(result.mode || "local-fallback");
      setAnalysisDirty(false);
      setEvidenceId(blockInsights[0]?.id || null);
      setCards((current) =>
        normalizeCards(current).map((card) => ({ ...card, stale: true })),
      );
      setProject((current) => ({
        ...current,
        title: result.title || "",
        summary: result.summary || "",
        tags: result.tags || "",
        publicationTone: result.publicationTone,
        summaryGeneration: result.summaryGeneration,
        summaryWasRewritten: result.summaryWasRewritten,
        generatedModes,
        generatedSourceKey: generatedModes.length
          ? requestedSourceKey
          : undefined,
        analysisRequestedMode:
          result.analysisRequestedMode || project.outputMode,
        planningVersion: result.planningVersion,
      }));
      setActiveCard(0);
      setAnalysisState("done");
      notify(
        result.mode === "model"
          ? `内容结构与精华文案已生成 · ${result.publicationTone || "自然真诚"}`
          : `已生成保真结构草稿${result.warning ? `：${result.warning}` : ""}`,
      );
    } catch (error) {
      setAnalysisState("error");
      notify(error instanceof Error ? error.message : "解析失败，请重试");
    }
  }

  function continueFromAnalysis() {
    const counts = new Map<string, number>();
    insights.forEach((block) =>
      block.sourceIds.forEach((id) =>
        counts.set(id, (counts.get(id) || 0) + 1),
      ),
    );
    const missing = sourceSentences.filter(
      (sentence) => !counts.has(sentence.id),
    ).length;
    const duplicates = [...counts.values()].filter((count) => count > 1).length;
    if (missing || duplicates) {
      notify(`请先处理分块完整性：${missing} 句遗漏，${duplicates} 句重复`);
      return;
    }
    const compiledCards = buildCardsFromBlocks(
      project,
      insights,
      sourceSentences,
      cards,
    );
    setCards(compiledCards);
    setProject((current) => ({
      ...current,
      generatedModes: [
        ...new Set([
          ...(current.generatedModes || []).filter(
            (mode) => mode === "summary",
          ),
          "card",
        ]),
      ],
      generatedSourceKey: generationSourceKey(current),
    }));
    setAnalysisDirty(false);
    setActiveCard(0);
    setEditorPane("cards");
    setStep("editor");
    notify("结构已确认，已按单卡内容单元编排卡片");
  }

  function openExportReview() {
    if (project.outputMode === "summary" && !summaryReady) {
      notify("请先生成当前原文对应的精华版文案");
      return;
    }
    if (
      project.outputMode === "image-card" &&
      project.requireImageMedia &&
      cards.some((card) => card.pageRole !== "cover" && !card.media)
    ) {
      notify(
        "\u8bf7\u5148\u4e3a\u6bcf\u5f20\u5185\u5bb9\u5361\u4e0a\u4f20\u56fe\u7247\uff0c\u6216\u5141\u8bb8\u4f7f\u7528\u5360\u4f4d\u56fe\u5bfc\u51fa",
      );
      return;
    }
    if (isCardOutputMode(project.outputMode) && !cardsReady) {
      notify("请先生成当前原文对应的卡片内容");
      return;
    }
    if (project.outputMode === "summary" && publicationOverLimit) {
      notify(
        `精华版超出发布限制 ${publicationCount - SUMMARY_PUBLICATION_LIMIT} 字，请先精简`,
      );
      return;
    }
    setStep("export");
  }

  async function saveVersion(entity: "analysis" | "summary" | "deck") {
    const snapshot =
      entity === "analysis"
        ? { insights, sourceSentences }
        : entity === "summary"
          ? {
              title: project.title,
              summary: project.summary,
              tags: project.tags,
            }
          : cards;
    const item = {
      id: crypto.randomUUID(),
      label: `手动保存 · ${entity === "analysis" ? "解析结果" : entity === "summary" ? "精华正文" : "卡片稿"}`,
      entity,
      at: historyTimestamp(),
      sourceKey: generationSourceKey(project),
      snapshot,
    };
    const nextVersions = [item, ...versions];
    setVersions(nextVersions);
    persistActiveVersions(nextVersions);
    notify("已保存内容版本到当前浏览器");
  }

  function restoreVersion(version: Version) {
    const currentSourceKey = generationSourceKey(project);
    if (!version.sourceKey) {
      notify(
        "\u65e7\u7248\u672c\u7f3a\u5c11\u539f\u6587\u6807\u8bc6\uff0c\u4e3a\u907f\u514d\u8986\u76d6\u5f53\u524d\u5185\u5bb9\uff0c\u65e0\u6cd5\u5b89\u5168\u6062\u590d",
      );
      return;
    }
    if (version.sourceKey !== currentSourceKey) {
      notify(
        "\u8be5\u7248\u672c\u5bf9\u5e94\u7684\u539f\u6587\u4e0e\u5f53\u524d\u5185\u5bb9\u4e0d\u4e00\u81f4\uff0c\u5df2\u963b\u6b62\u6062\u590d",
      );
      return;
    }
    if (version.snapshot) {
      if (version.entity === "analysis") {
        const snapshot = version.snapshot as {
          insights?: Insight[];
          sourceSentences?: SourceSentence[];
        };
        setInsights(snapshot.insights || []);
        setSourceSentences(snapshot.sourceSentences || []);
        setCards([]);
        setEditorPane("structure");
        setAnalysisDirty(true);
      }
      if (version.entity === "summary")
        setProject((p) => ({
          ...p,
          ...(version.snapshot as Partial<ProjectState>),
        }));
      if (version.entity === "deck") setCards(normalizeCards(version.snapshot));
    }
    setVersionOpen(false);
    notify(`\u5df2\u6062\u590d\uff1a${version.label}`);
  }

  async function exportPackage() {
    if (exporting) return;
    if (project.outputMode === "summary" && !summaryReady) {
      notify("精华版尚未生成，请返回编辑器生成后再导出");
      return;
    }
    if (
      project.outputMode === "image-card" &&
      project.requireImageMedia &&
      cards.some((card) => card.pageRole !== "cover" && !card.media)
    ) {
      notify(
        "\u8bf7\u5148\u4e3a\u6bcf\u5f20\u5185\u5bb9\u5361\u4e0a\u4f20\u56fe\u7247\uff0c\u6216\u5141\u8bb8\u4f7f\u7528\u5360\u4f4d\u56fe\u5bfc\u51fa",
      );
      return;
    }
    if (isCardOutputMode(project.outputMode) && !cardsReady) {
      notify("卡片内容尚未生成，请重新解析后再导出");
      return;
    }
    if (project.outputMode === "summary" && publicationOverLimit) {
      notify(`精华版总字数必须控制在 ${SUMMARY_PUBLICATION_LIMIT} 字以内`);
      return;
    }
    setExporting(true);
    notify(
      project.outputMode === "summary"
        ? "正在整理可直接发布的精华文案…"
        : `正在生成 ${cards.length} 张高清图片…`,
    );
    try {
      const { blob } = await buildImagePackage(
        project,
        cards,
        theme,
        density,
        insights,
        paragraphs,
        sourceSentences,
      );
      const fileName = `${safeFileName(project.name)}-${Date.now()}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(
        project.outputMode === "summary"
          ? "精华版发布文案包已下载"
          : "PNG 图片发布包已下载",
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "图片生成失败，请重试");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">小</div>
          <div>
            <strong>内容编译器</strong>
            <span>XHS COMPILER</span>
          </div>
          <button className="mobile-close" onClick={() => setMobileNav(false)}>
            <X size={18} />
          </button>
        </div>
        <button
          type="button"
          className="new-project"
          onClick={createLocalProject}
        >
          <Plus size={16} /> 新建内容项目
        </button>
        <nav className="main-nav">
          <p>工作区</p>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={step === item.id ? "active" : ""}
              onClick={() => {
                item.id === "export" ? openExportReview() : setStep(item.id);
                setMobileNav(false);
              }}
            >
              <item.icon size={17} />
              {item.number && <i>{item.number}</i>}
              <span>{item.label}</span>
              {item.id !== "projects" && (
                <Check size={13} className="nav-check" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-projects">
          <p>最近项目</p>
          {workspaces.map((workspace, index) => (
            <button
              type="button"
              key={workspace.id}
              className={`project-mini ${workspace.id === activeWorkspaceId ? "active" : ""}`}
              onClick={() => openWorkspace(workspace)}
            >
              <span className={`project-dot ${index % 2 ? "amber" : "blue"}`} />
              <div>
                <b>{workspace.project.name || "未命名项目"}</b>
                <small>
                  {normalizeOutputMode(
                    workspace.project.outputMode,
                    workspace.editorMode,
                  ) === "summary"
                    ? "精华版"
                    : normalizeOutputMode(
                          workspace.project.outputMode,
                          workspace.editorMode,
                        ) === "image-card"
                      ? "带图片卡片"
                      : "卡片版"}{" "}
                  · {workspace.updatedAt}
                </small>
              </div>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <button>
            <BookOpenCheck size={16} />
            <span>使用指南</span>
            <em>实际功能待开发</em>
          </button>
          <button>
            <Settings2 size={16} />
            <span>偏好设置</span>
            <em>实际功能待开发</em>
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileNav(true)}>
            <Menu size={19} />
          </button>
          <div className="crumb">
            <span>内容项目</span>
            <ChevronRight size={14} />
            <b>{project.name || "未命名项目"}</b>
          </div>
          <div className="top-actions">
            <span className={`save-indicator ${saveState}`}>
              <span />
              {saveState === "saving" ? "保存中…" : "已自动保存"}
            </span>
            <button
              className="version-button"
              onClick={() => setVersionOpen(true)}
            >
              <History size={16} /> 版本 <span>{versions.length}</span>
            </button>
            <span className="test-mode-badge">本地测试模式</span>
          </div>
        </header>

        {step === "projects" && (
          <ProjectsView
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            onOpen={openWorkspace}
            onDelete={deleteWorkspace}
            onCreate={createLocalProject}
          />
        )}
        {step === "input" && (
          <InputView
            project={project}
            update={updateProject}
            charCount={charCount}
            estimatedCards={estimatedCards}
            recentContentTypes={recentContentTypes}
            onContentTypeCommit={rememberContentType}
            onAnalyze={() => runAnalysis()}
            notify={notify}
          />
        )}
        {step === "editor" && (
          <EditorView
            editorPane={editorPane}
            setEditorPane={setEditorPane}
            structureReview={
              <ContentBlockReview
                embedded
                state={analysisState}
                blocks={insights}
                setBlocks={setInsights}
                sourceSentences={sourceSentences}
                selectedId={evidenceId}
                setSelectedId={setEvidenceId}
                analysisMode={analysisMode}
                presentation={
                  project.outputMode === "image-card" ? "image-card" : "card"
                }
                onRetry={() => runAnalysis()}
                onRetitle={retitleInsight}
                onRefine={refineInsight}
                onContinue={continueFromAnalysis}
                onVersion={() => saveVersion("analysis")}
                onStructureChange={() => setAnalysisDirty(true)}
                notify={notify}
              />
            }
            mode={project.outputMode}
            setMode={(mode: OutputMode) => updateProject("outputMode", mode)}
            project={project}
            update={updateProject}
            summaryReady={summaryReady}
            cardsReady={cardsReady}
            completeCardCount={completeCardCount}
            imageCardCount={imageCardCount}
            generationLoading={analysisState === "loading"}
            onGenerateSummary={() => runAnalysis({ stayInEditor: true })}
            publicationCount={publicationCount}
            publicationOverLimit={publicationOverLimit}
            cards={cards}
            setCards={setCards}
            theme={theme}
            setTheme={setTheme}
            density={density}
            setDensity={setDensity}
            activeCard={activeCard}
            setActiveCard={setActiveCard}
            mediaUrls={mediaUrls}
            onMediaChange={updateCardMedia}
            onEnhance={enhanceCard}
            onVersion={() =>
              saveVersion(project.outputMode === "summary" ? "summary" : "deck")
            }
            onExport={openExportReview}
            notify={notify}
          />
        )}
        {step === "export" && (
          <ExportView
            project={project}
            theme={theme}
            cards={cards}
            publicationCount={publicationCount}
            publicationOverLimit={publicationOverLimit}
            onExport={exportPackage}
            exporting={exporting}
          />
        )}
      </main>

      {toast && (
        <div className="toast">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {versionOpen && (
        <VersionDrawer
          versions={versions}
          onRestore={restoreVersion}
          onClose={() => setVersionOpen(false)}
        />
      )}
    </div>
  );
}

function SectionTitle({
  kicker,
  title,
  description,
  actions,
}: {
  kicker: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <span>{kicker}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="section-actions">{actions}</div>}
    </div>
  );
}

function ProjectsView({
  workspaces,
  activeWorkspaceId,
  onOpen,
  onDelete,
  onCreate,
}: any) {
  const incomplete = workspaces.filter(
    (workspace: LocalWorkspace) => !workspace.project.originalText.trim(),
  ).length;
  return (
    <div className="page">
      <SectionTitle
        kicker="项目工作台"
        title="内容项目"
        description="每个项目拥有独立的输入、解析、卡片与导出空间，测试数据保存在当前浏览器。"
        actions={
          <button className="primary" onClick={onCreate}>
            <Plus size={16} /> 新建内容项目
          </button>
        }
      />
      <div className="stats-row">
        <Stat
          label="内容项目"
          value={String(workspaces.length)}
          note="独立保存"
        />
        <Stat
          label="待完善"
          value={String(incomplete)}
          note="尚未输入原文"
          tone="warn"
        />
      </div>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>全部项目</h2>
            <p>点击项目进入其独立内容空间</p>
          </div>
          <span className="tag">当前共 {workspaces.length} 个</span>
        </div>
        <div className="project-table">
          <div className="table-head">
            <span>项目</span>
            <span>模式</span>
            <span>状态</span>
            <span>更新时间</span>
            <span>操作</span>
          </div>
          {workspaces.length === 0 ? (
            <div className="empty-projects">
              <FileText size={30} />
              <b>还没有内容项目</b>
              <span>点击左侧“新建内容项目”开始创建</span>
            </div>
          ) : (
            workspaces.map((workspace: LocalWorkspace, index: number) => {
              const isEmpty = !workspace.project.originalText.trim();
              const isActive = workspace.id === activeWorkspaceId;
              const outputMode = normalizeOutputMode(
                workspace.project.outputMode,
                workspace.editorMode,
              );
              return (
                <div
                  key={workspace.id}
                  className={`table-row ${isActive ? "active" : ""}`}
                >
                  <button
                    type="button"
                    className="project-row-main"
                    onClick={() => onOpen(workspace)}
                  >
                    <div className="project-name">
                      <div className={`file-icon ${index % 2 ? "warm" : ""}`}>
                        <FileText size={18} />
                      </div>
                      <span>
                        <b>
                          {workspace.project.name || "未命名项目"}{" "}
                          {isActive && <em>当前</em>}
                        </b>
                        <small>
                          {workspace.project.eventName || "等待填写活动信息"}
                        </small>
                      </span>
                    </div>
                    <span className="tag">
                      {outputMode === "summary"
                        ? "精华版"
                        : outputMode === "image-card"
                          ? "带图片卡片"
                          : "完整卡片版"}
                    </span>
                    <span className={`status ${isEmpty ? "draft" : "ready"}`}>
                      <i />
                      {isEmpty ? "待输入" : "编辑中"}
                    </span>
                    <span>{workspace.updatedAt}</span>
                  </button>
                  <button
                    type="button"
                    className="delete-project"
                    aria-label={`删除${workspace.project.name || "未命名项目"}`}
                    title="删除项目"
                    onClick={() => onDelete(workspace)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, note, tone }: any) {
  return (
    <div className="stat">
      <span>{label}</span>
      <div>
        <strong>{value}</strong>
        <small className={tone}>{note}</small>
      </div>
    </div>
  );
}

function InputView({
  project,
  update,
  charCount,
  estimatedCards,
  recentContentTypes,
  onContentTypeCommit,
  onAnalyze,
  notify,
}: any) {
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkedAt, setCheckedAt] = useState("");
  const checkPanelRef = useRef<HTMLDivElement | null>(null);
  const over = charCount > 10000;
  const paragraphs = project.originalText
    .split(/\n\s*\n/)
    .filter(Boolean).length;
  const checkItems = [
    {
      label: "项目名称",
      ok: !!project.name.trim(),
      message: project.name.trim() ? "已填写" : "请填写项目名称",
    },
    {
      label: "主题/场景名称",
      ok: !!project.eventName.trim(),
      message: project.eventName.trim() ? "已填写" : "请填写主题或场景名称",
    },
    {
      label: "内容类型",
      ok: !!(project.contentType || project.eventType || "").trim(),
      message: (project.contentType || project.eventType || "").trim()
        ? "已填写"
        : "请填写内容类型",
    },
    {
      label: "原始长文",
      ok: !!project.originalText.trim() && !over,
      message: !project.originalText.trim()
        ? "请粘贴活动内容"
        : over
          ? `超出限制 ${charCount - 10000} 字符`
          : `${charCount.toLocaleString()} 字符，${paragraphs} 个自然段`,
    },
  ];
  const requiredReady =
    checkItems[0].ok &&
    checkItems[1].ok &&
    checkItems[2].ok &&
    checkItems[3].ok;
  const allReady = checkItems.every((item) => item.ok);

  useEffect(() => {
    if (!checkOpen) return;
    const frame = window.requestAnimationFrame(() =>
      checkPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [checkOpen, checkedAt]);

  function runInputCheck() {
    if (checkOpen) {
      setCheckOpen(false);
      return;
    }
    setCheckedAt(
      new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    setCheckOpen(true);
    notify(
      allReady
        ? "输入检查通过，可以开始解析"
        : requiredReady
          ? "输入检查完成，还有建议项待补充"
          : "输入检查完成，发现需要处理的阻断项",
    );
  }

  return (
    <div className="page input-page">
      <SectionTitle
        kicker="步骤 01 / 04"
        title="输入内容"
        description="粘贴完整笔记；系统会先理解，再进行平台化编排。"
        actions={
          <>
            <button
              type="button"
              className={`secondary ${checkOpen ? "active-check" : ""}`}
              onClick={runInputCheck}
              aria-expanded={checkOpen}
              aria-controls="input-check-results"
            >
              <Eye size={16} /> {checkOpen ? "收起检查" : "输入检查"}
            </button>
            <button type="button" className="primary" onClick={onAnalyze}>
              <Sparkles size={16} /> 开始结构化解析
            </button>
          </>
        }
      />
      {checkOpen && (
        <div
          ref={checkPanelRef}
          id="input-check-results"
          className={`input-check-panel ${allReady ? "passed" : "attention"}`}
          role="status"
          aria-live="polite"
        >
          <div className="input-check-summary">
            {allReady ? <CheckCircle2 size={20} /> : <CircleAlert size={20} />}
            <div>
              <b>
                {allReady
                  ? "输入检查通过，可以开始解析"
                  : requiredReady
                    ? "基础输入有效，还有建议项待补充"
                    : "发现阻断项，请先完成必填内容"}
              </b>
              <span>
                本次检查仅验证输入完整性与字符限制，不会调用 AI。
                {checkedAt && ` · ${checkedAt} 完成`}
              </span>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭输入检查"
              onClick={() => setCheckOpen(false)}
            >
              <X size={15} />
            </button>
          </div>
          <div className="input-check-list">
            {checkItems.map((item) => (
              <div className={item.ok ? "ok" : "issue"} key={item.label}>
                {item.ok ? (
                  <CheckCircle2 size={15} />
                ) : (
                  <CircleAlert size={15} />
                )}
                <span>
                  <b>{item.label}</b>
                  <small>{item.message}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="input-grid">
        <div className="panel form-panel">
          <div className="panel-head compact">
            <div>
              <h2>基础信息</h2>
              <p>用于项目命名、卡片页眉与内容语境</p>
            </div>
            <span className="required-note">* 必填项</span>
          </div>
          <div className="form-grid">
            <label>
              <span>项目名称 *</span>
              <input
                value={project.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </label>
            <label>
              <span>主题/场景名称 *</span>
              <input
                value={project.eventName}
                onChange={(e) => update("eventName", e.target.value)}
                placeholder="例如：一次开发复盘、一本书或一个项目"
              />
            </label>
            <label>
              <span>内容类型 *</span>
              <input
                list="recent-content-types"
                value={project.contentType ?? project.eventType}
                onChange={(e) => update("contentType", e.target.value)}
                onBlur={(e) => onContentTypeCommit(e.target.value)}
                placeholder="例如：项目总结、读书感悟"
              />
              <datalist id="recent-content-types">
                {recentContentTypes.map((item: string) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
              <small className="field-hint">
                可输入新类型，也可从已使用的类型中选择
              </small>
            </label>
            <label>
              <span>输出模式 *</span>
              <div className="segmented">
                <button
                  type="button"
                  className={project.outputMode === "summary" ? "active" : ""}
                  onClick={() => update("outputMode", "summary")}
                >
                  精华版
                </button>
                <button
                  type="button"
                  className={project.outputMode === "card" ? "active" : ""}
                  onClick={() => update("outputMode", "card")}
                >
                  完整卡片版
                </button>
                <button
                  type="button"
                  className={
                    project.outputMode === "image-card" ? "active" : ""
                  }
                  onClick={() => update("outputMode", "image-card")}
                >
                  带图片卡片
                </button>
              </div>
              <small className={`mode-hint ${project.outputMode}`}>
                {project.outputMode === "summary"
                  ? charCount > SUMMARY_REWRITE_THRESHOLD
                    ? `原文超过 ${SUMMARY_REWRITE_THRESHOLD} 字，将调用模型压缩并匹配个性化口吻`
                    : "生成可直接发布的个性化文案，总字数不超过 1000 字"
                  : project.outputMode === "image-card"
                    ? "固定紧凑密度，为每张内容卡的上半部分预留用户图片位置"
                    : "完整保留原文，按语义拆成可编辑图片卡片"}
              </small>
            </label>
          </div>
          <div className="divider" />
          <div className="textarea-label">
            <div>
              <b>原始长文 *</b>
              <span>支持 Markdown，将保留标题、列表与引用结构</span>
            </div>
            <button
              className="text-button"
              onClick={() => update("originalText", "")}
            >
              <Trash2 size={14} /> 清空
            </button>
          </div>
          <div className={`editor-textarea ${over ? "error" : ""}`}>
            <textarea
              value={project.originalText}
              onChange={(e) => update("originalText", e.target.value)}
              placeholder="粘贴你的笔记、复盘、感悟或项目总结…"
            />
            <div className="textarea-footer">
              <span>
                <CheckCircle2 size={14} /> 已识别 {paragraphs} 个自然段
              </span>
              <strong className={over ? "over" : ""}>
                {charCount.toLocaleString()} / 10,000
              </strong>
            </div>
          </div>
        </div>
        <aside className="input-side">
          <div className="panel">
            <div className="panel-head compact">
              <div>
                <h2>输入状态</h2>
                <p>实时检查，不调用模型</p>
              </div>
              <span className="live-dot">实时</span>
            </div>
            <div className="metrics">
              <Metric
                label="当前字符"
                value={charCount.toLocaleString()}
                note={over ? "已超限" : "符合限制"}
                ok={!over}
              />
              <Metric
                label="预计卡片"
                value={`${estimatedCards} 张`}
                note="按舒展密度估算"
              />
              <Metric label="预计解析" value="约 1 秒" note="测试功能已开放" />
            </div>
            <div className="recognized">
              <b>可识别内容结构</b>
              <div>
                <span>
                  <Check />
                  内容背景
                </span>
                <span>
                  <Check />
                  核心观点
                </span>
                <span>
                  <Check />
                  真实案例
                </span>
                <span>
                  <Check />
                  个人感悟
                </span>
                <span>
                  <Check />
                  行动建议
                </span>
                <span>
                  <Check />
                  开放问题
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value, note, ok }: any) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small className={ok === false ? "bad" : ""}>
        {ok === true && <CheckCircle2 size={12} />} {note}
      </small>
    </div>
  );
}

function EditorView({
  editorPane,
  setEditorPane,
  structureReview,
  mode,
  setMode,
  project,
  update,
  summaryReady,
  cardsReady,
  completeCardCount,
  imageCardCount,
  generationLoading,
  onGenerateSummary,
  publicationCount,
  publicationOverLimit,
  cards,
  setCards,
  theme,
  setTheme,
  density,
  setDensity,
  activeCard,
  setActiveCard,
  mediaUrls,
  onMediaChange,
  onEnhance,
  onVersion,
  onExport,
  notify,
}: any) {
  const safeCards = normalizeCards(cards);
  const current = normalizeCard(safeCards[activeCard], activeCard);
  const hasCards = cardsReady && safeCards.length > 0;
  const contentReady = mode === "summary" ? summaryReady : hasCards;
  const imageCardMode = mode === "image-card";
  const effectiveDensity: Density = imageCardMode ? "compact" : density;
  const validationHostRef = useRef<HTMLDivElement>(null);
  const [cardLayouts, setCardLayouts] = useState<CardLayoutStatus[]>([]);
  const [enhancingKind, setEnhancingKind] = useState<"lead" | "ending" | null>(
    null,
  );
  const [mediaStatus, setMediaStatus] = useState<
    "idle" | "processing" | "failed"
  >("idle");

  function updateCardEnhancement(
    kind: "lead" | "ending",
    enabled: boolean,
    value?: string,
  ) {
    const textKey = kind === "lead" ? "addedLead" : "addedEnding";
    const enabledKey = kind === "lead" ? "leadEnabled" : "endingEnabled";
    setCards((list: Card[]) =>
      normalizeCards(list).map((card, index) => {
        if (index !== activeCard) return card;
        return {
          ...card,
          ...(value === undefined ? {} : { [textKey]: value.slice(0, 36) }),
          enhancement: {
            ...card.enhancement,
            [enabledKey]: enabled,
            source: "manual",
          },
        };
      }),
    );
  }

  async function handleMediaChange(file?: File) {
    setMediaStatus("processing");
    const success = await onMediaChange(activeCard, file);
    setMediaStatus(success ? "idle" : "failed");
  }

  async function generateEnhancement(kind: "lead" | "ending") {
    if (enhancingKind || !onEnhance) return;
    setEnhancingKind(kind);
    try {
      const value = await onEnhance(current, kind);
      if (value) updateCardEnhancement(kind, true, value);
    } finally {
      setEnhancingKind(null);
    }
  }

  useEffect(() => {
    if (!hasCards) {
      setCardLayouts([]);
      return;
    }

    let cancelled = false;
    let frame = 0;
    let settleTimer = 0;
    const measure = () => {
      if (cancelled) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nodes = Array.from(
          validationHostRef.current?.querySelectorAll<HTMLElement>(
            ".card-preview",
          ) || [],
        );
        const next = nodes.map(measureCardLayout);
        setCardLayouts((previous) =>
          previous.length === next.length &&
          previous.every(
            (item, index) =>
              item.overflow === next[index]?.overflow &&
              item.contentClipped === next[index]?.contentClipped &&
              item.utilization === next[index]?.utilization &&
              item.horizontalOverflow === next[index]?.horizontalOverflow &&
              item.verticalOverflow === next[index]?.verticalOverflow,
          )
            ? previous
            : next,
        );
      });
    };

    measure();
    settleTimer = window.setTimeout(measure, 240);
    document.fonts?.ready.then(measure);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    if (validationHostRef.current) observer?.observe(validationHostRef.current);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      observer?.disconnect();
    };
  }, [cards, effectiveDensity, hasCards, imageCardMode, theme]);

  const layoutChecking = hasCards && cardLayouts.length !== safeCards.length;
  const overflowCount = cardLayouts.filter((item) => item.overflow).length;
  const clippedCount = cardLayouts.filter((item) => item.contentClipped).length;
  const overflowSummary = cardLayouts
    .flatMap((item, index) => {
      if (!item.overflow) return [];
      return [`第 ${index + 1} 页横向溢出`];
    })
    .join("；");
  const currentLayout = cardLayouts[activeCard];
  const currentOverflowLabel = currentLayout?.horizontalOverflow
    ? "当前页横向溢出"
    : "当前页内容已隐藏";
  const currentUtilizationLabel = currentLayout?.contentClipped
    ? "100%+"
    : `${currentLayout?.utilization ?? 0}%`;
  const cardExportBlocked =
    isCardOutputMode(mode) && (layoutChecking || overflowCount > 0);
  return (
    <div className="page editor-page">
      <SectionTitle
        kicker="步骤 02 / 04"
        title={
          editorPane === "structure"
            ? "结构解析与卡片规划"
            : "卡片编辑与实时预览"
        }
        description={
          editorPane === "structure"
            ? "确认每个单卡内容单元的主题与来源；原文顺序保持不变。"
            : "编辑文字与视觉；预览、校验和 PNG 使用同一套版式。"
        }
        actions={
          <>
            <button
              className="secondary"
              disabled={!contentReady}
              onClick={onVersion}
            >
              <Save size={16} /> 保存版本
            </button>
            <button
              className="primary"
              disabled={!contentReady || cardExportBlocked}
              title={
                overflowCount > 0
                  ? `${overflowSummary}，请调整内容或密度`
                  : layoutChecking
                    ? "正在校验卡片排版"
                    : undefined
              }
              onClick={onExport}
            >
              导出检查 <ChevronRight size={16} />
            </button>
          </>
        }
      />
      <div
        className="editor-pane-tabs"
        role="tablist"
        aria-label="内容编辑阶段"
      >
        <button
          type="button"
          className={editorPane === "structure" ? "active" : ""}
          onClick={() => setEditorPane("structure")}
          role="tab"
          aria-selected={editorPane === "structure"}
        >
          <ListChecks size={16} /> 结构解析
        </button>
        <button
          type="button"
          className={editorPane === "cards" ? "active" : ""}
          onClick={() => setEditorPane("cards")}
          role="tab"
          aria-selected={editorPane === "cards"}
        >
          <PanelRight size={16} /> 卡片编辑{" "}
          {cardsReady && <span>{safeCards.length}</span>}
        </button>
      </div>
      {editorPane === "structure" ? (
        structureReview
      ) : (
        <>
          <div className="editor-tabs">
            <button
              className={mode === "summary" ? "active" : ""}
              onClick={() => setMode("summary")}
            >
              <FileText size={16} /> 精华版
            </button>
            <button
              className={mode === "card" ? "active" : ""}
              onClick={() => setMode("card")}
            >
              <PanelRight size={16} /> 完整卡片版{" "}
              <span>{completeCardCount}</span>
            </button>
            <button
              className={mode === "image-card" ? "active" : ""}
              onClick={() => setMode("image-card")}
            >
              <ImagePlus size={16} /> 带图片卡片 <span>{imageCardCount}</span>
            </button>
          </div>
          {mode === "summary" ? (
            summaryReady ? (
              <SummaryEditor
                project={project}
                update={update}
                publicationCount={publicationCount}
                publicationOverLimit={publicationOverLimit}
                notify={notify}
              />
            ) : (
              <GenerationEmptyState
                mode="summary"
                loading={generationLoading}
                onGenerate={onGenerateSummary}
              />
            )
          ) : !hasCards ? (
            <GenerationEmptyState
              mode="card"
              loading={generationLoading}
              onGenerate={onGenerateSummary}
            />
          ) : (
            <div className="card-workbench">
              <section className="block-editor panel">
                <div className="panel-head compact">
                  <div>
                    <h2>卡片内容</h2>
                    <p>第 {activeCard + 1} 页 · 一个页面表达一个主题</p>
                  </div>
                </div>
                <label>
                  <span>页面标识（仅编辑器显示）</span>
                  <input
                    value={current.eyebrow}
                    onChange={(e) =>
                      setCards((list: Card[]) =>
                        normalizeCards(list).map((x, i) =>
                          i === activeCard
                            ? { ...x, eyebrow: e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  <span>AI 小标题</span>
                  <textarea
                    className="title-input"
                    value={current.title}
                    onChange={(e) =>
                      setCards((list: Card[]) =>
                        normalizeCards(list).map((x, i) =>
                          i === activeCard
                            ? { ...x, title: e.target.value, manualTitle: true }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
                <label className="body-field">
                  <span>正文</span>
                  <textarea
                    className="body-input"
                    value={current.body}
                    onChange={(e) =>
                      setCards((list: Card[]) =>
                        normalizeCards(list).map((x, i) =>
                          i === activeCard
                            ? { ...x, body: e.target.value, manualBody: true }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
                {current.pageRole !== "cover" && (
                  <div className="card-enhancement-editor">
                    {(["lead", "ending"] as const).map((kind) => {
                      const isLead = kind === "lead";
                      const enabled = isLead
                        ? current.enhancement?.leadEnabled === true
                        : current.enhancement?.endingEnabled === true;
                      const value = isLead
                        ? current.addedLead || ""
                        : current.addedEnding || "";
                      return (
                        <div className="card-enhancement-row" key={kind}>
                          <div className="card-enhancement-head">
                            <label className="inline-toggle">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(event) =>
                                  updateCardEnhancement(
                                    kind,
                                    event.target.checked,
                                  )
                                }
                              />
                              <span>
                                {isLead
                                  ? "\u4e3a\u672c\u9875\u52a0\u4e00\u53e5\u5f00\u573a\uff08\u53ef\u9009\uff09"
                                  : "\u4e3a\u672c\u9875\u6536\u4e2a\u5c3e\uff08\u53ef\u9009\uff09"}
                              </span>
                            </label>
                            <button
                              type="button"
                              className="text-button"
                              disabled={enhancingKind !== null}
                              onClick={() => void generateEnhancement(kind)}
                            >
                              <Sparkles size={14} />
                              {enhancingKind === kind
                                ? "\u6b63\u5728\u751f\u6210\u2026"
                                : isLead
                                  ? "AI \u5e2e\u6211\u5199\u5bfc\u8bed"
                                  : "AI \u5e2e\u6211\u5199\u6536\u5c3e"}
                            </button>
                          </div>
                          {enabled && (
                            <textarea
                              maxLength={36}
                              value={value}
                              placeholder={
                                isLead
                                  ? "\u7528\u4e00\u53e5\u8bdd\u5e26\u8bfb\u8005\u8fdb\u5165\u672c\u9875\u4e3b\u9898"
                                  : "\u7528\u4e00\u53e5\u8bdd\u603b\u7ed3\u672c\u9875\u91cd\u70b9\uff0c\u6216\u81ea\u7136\u8854\u63a5\u4e0b\u4e00\u9875"
                              }
                              onChange={(event) =>
                                updateCardEnhancement(
                                  kind,
                                  true,
                                  event.target.value,
                                )
                              }
                            />
                          )}
                        </div>
                      );
                    })}
                    <small>
                      {
                        "\u53ef\u9009\u6dfb\u52a0\u8f85\u52a9\u6587\u5b57\uff0c\u8ba9\u8bfb\u8005\u66f4\u5bb9\u6613\u8fdb\u5165\u4e3b\u9898\u6216\u7406\u89e3\u91cd\u70b9\uff1b\u6b63\u6587\u5185\u5bb9\u4e0d\u4f1a\u88ab\u6539\u52a8\u3002\u6bcf\u6bb5\u6700\u591a 36 \u4e2a\u5b57\uff0c\u542f\u7528\u540e\u4f1a\u5360\u7528\u672c\u9875\u6392\u7248\u7a7a\u95f4\u3002"
                      }
                    </small>
                  </div>
                )}
                {imageCardMode && current.pageRole !== "cover" && (
                  <div className="card-media-editor">
                    <div>
                      <b>本页图片</b>
                      <small>
                        {mediaStatus === "processing"
                          ? "\u56fe\u7247\u5904\u7406\u4e2d\u2026"
                          : mediaStatus === "failed"
                            ? "\u4e0a\u4f20\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9\u56fe\u7247"
                            : current.media
                              ? "\u5df2\u4e0a\u4f20\uff0c\u53ef\u66ff\u6362\u6216\u79fb\u9664"
                              : "\u672a\u4e0a\u4f20\u65f6\u5c06\u4fdd\u7559\u56fe\u7247\u5360\u4f4d\u533a"}
                      </small>
                      <small className="media-crop-note">
                        {
                          "\u56fe\u7247\u663e\u793a\u533a\uff1a3:4 \u5361\u7247\u4e0a\u90e8 39%\uff0c\u81ea\u9002\u5e94\u8986\u76d6\u88c1\u5207"
                        }
                      </small>
                    </div>
                    <div className="card-media-actions">
                      <label className="secondary upload-media-button">
                        <ImagePlus size={15} />{" "}
                        {current.media ? "替换图片" : "上传图片"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (file) void handleMediaChange(file);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                      {current.media && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void handleMediaChange()}
                        >
                          移除图片
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {current.bullets && (
                  <label>
                    <span>列表项</span>
                    <textarea
                      value={current.bullets.join("\n")}
                      onChange={(e) =>
                        setCards((list: Card[]) =>
                          normalizeCards(list).map((x, i) =>
                            i === activeCard
                              ? { ...x, bullets: e.target.value.split("\n") }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                )}
              </section>
              <section className="preview-stage">
                <div className="preview-toolbar">
                  <div className="preview-controls">
                    <div className="density-control" aria-label="卡片排版密度">
                      <span>密度</span>
                      {imageCardMode ? (
                        <b className="fixed-density">紧凑（图片卡固定）</b>
                      ) : (
                        densityOptions.map((option) => (
                          <button
                            type="button"
                            aria-pressed={density === option.id}
                            title={option.description}
                            className={density === option.id ? "active" : ""}
                            key={option.id}
                            onClick={() => setDensity(option.id)}
                          >
                            {option.label}
                          </button>
                        ))
                      )}
                    </div>
                    {imageCardMode && (
                      <label className="image-export-policy">
                        <input
                          type="checkbox"
                          checked={!project.requireImageMedia}
                          onChange={(event) =>
                            update("requireImageMedia", !event.target.checked)
                          }
                        />
                        <span>
                          {
                            "\u5141\u8bb8\u672a\u4e0a\u4f20\u56fe\u7247\u65f6\u4f7f\u7528\u5360\u4f4d\u56fe\u5bfc\u51fa"
                          }
                        </span>
                      </label>
                    )}
                    {layoutChecking ? (
                      <span className="capacity-indicator checking">
                        <LoaderCircle className="spin" />
                        正在测量
                      </span>
                    ) : currentLayout ? (
                      <span
                        className={`capacity-indicator ${currentLayout.overflow ? "overflow" : currentLayout.contentClipped ? "clipped" : ""}`}
                      >
                        {currentLayout.overflow ||
                        currentLayout.contentClipped ? (
                          <CircleAlert />
                        ) : (
                          <CheckCircle2 />
                        )}
                        {currentLayout.contentClipped
                          ? "本页内容已隐藏 · 占用 100%+"
                          : `本页占用 ${currentUtilizationLabel}`}
                      </span>
                    ) : null}
                  </div>
                  <span className="preview-size">1080 × 1440 · 3:4</span>
                </div>
                <CardPreview
                  card={current}
                  theme={theme}
                  density={effectiveDensity}
                  page={activeCard + 1}
                  total={safeCards.length}
                  overflow={currentLayout?.overflow}
                  presentation={mode}
                  mediaUrl={mediaUrls[String(activeCard)]}
                />
                <div className="page-nav">
                  <button
                    disabled={activeCard === 0}
                    onClick={() => setActiveCard((n: number) => n - 1)}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <div>
                    {safeCards.map((_: Card, i: number) => (
                      <button
                        key={i}
                        className={i === activeCard ? "active" : ""}
                        onClick={() => setActiveCard(i)}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                  <button
                    disabled={activeCard === safeCards.length - 1}
                    onClick={() => setActiveCard((n: number) => n + 1)}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              </section>
              <aside className="theme-panel panel">
                <div className="panel-head compact">
                  <div>
                    <h2>
                      <Palette size={17} /> 模板
                    </h2>
                    <p>全套卡片统一应用</p>
                  </div>
                </div>
                <div className="theme-list">
                  {themes.map((t) => (
                    <button
                      key={t.id}
                      className={theme === t.id ? "active" : ""}
                      onClick={() => setTheme(t.id)}
                    >
                      <div className="swatches">
                        {t.swatches.map((c) => (
                          <i key={c} style={{ background: c }} />
                        ))}
                      </div>
                      <span>
                        <b>{t.name}</b>
                        <small>{t.desc}</small>
                      </span>
                      {theme === t.id && <CheckCircle2 size={16} />}
                    </button>
                  ))}
                </div>
                <div className="layout-check">
                  <b>分页校验</b>
                  {layoutChecking ? (
                    <span className="pending">
                      <LoaderCircle className="spin" />
                      正在按导出尺寸测量
                    </span>
                  ) : overflowCount > 0 ? (
                    <span className="warning">
                      <CircleAlert />
                      {overflowSummary}
                    </span>
                  ) : clippedCount > 0 ? (
                    <span className="clipped">
                      <CircleAlert />有 {clippedCount} 页正文已裁切，仍可导出
                    </span>
                  ) : (
                    <span>
                      <CheckCircle2 />
                      全部 {safeCards.length} 页完整显示
                    </span>
                  )}
                  <span
                    className={
                      currentLayout?.overflow
                        ? "warning"
                        : currentLayout?.contentClipped
                          ? "clipped"
                          : ""
                    }
                  >
                    {currentLayout?.overflow ||
                    currentLayout?.contentClipped ? (
                      <CircleAlert />
                    ) : (
                      <CheckCircle2 />
                    )}
                    {currentLayout?.overflow || currentLayout?.contentClipped
                      ? currentOverflowLabel
                      : `当前页占用 ${currentLayout ? currentUtilizationLabel : "待测量"}`}
                  </span>
                  <span>
                    <CheckCircle2 />
                    密度已同步到预览与导出
                  </span>
                  <span>
                    <CheckCircle2 />
                    页码连续
                  </span>
                </div>
              </aside>
              <div
                className="card-validation-host"
                ref={validationHostRef}
                aria-hidden="true"
              >
                {safeCards.map((card: Card, index: number) => (
                  <CardPreview
                    key={index}
                    card={card}
                    theme={theme}
                    density={effectiveDensity}
                    page={index + 1}
                    total={safeCards.length}
                    presentation={mode}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GenerationEmptyState({
  mode,
  loading,
  onGenerate,
}: {
  mode: GeneratedMode;
  loading: boolean;
  onGenerate: () => void;
}) {
  const summaryMode = mode === "summary";
  return (
    <div className="panel generation-empty" role="status" aria-live="polite">
      <div className="generation-empty-icon">
        {loading ? (
          <LoaderCircle className="spin" size={25} />
        ) : summaryMode ? (
          <FileText size={25} />
        ) : (
          <PanelRight size={25} />
        )}
      </div>
      <span className="generation-empty-kicker">
        {summaryMode ? "精华版尚未生成" : "完整卡片尚未生成"}
      </span>
      <h2>
        {summaryMode
          ? "生成一份可直接发布的精华文案"
          : "重新解析当前原文并生成卡片"}
      </h2>
      <p>
        {summaryMode
          ? "当前没有与这份原文匹配的精华内容。系统不会使用完整原文代替，生成后会同时更新卡片结果。"
          : "现有卡片与当前原文不匹配。重新生成后，精华文案也会同步更新。"}
      </p>
      <button
        type="button"
        className="primary"
        disabled={loading}
        onClick={onGenerate}
      >
        {loading ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Sparkles size={16} />
        )}
        {loading
          ? "正在同时生成两种内容…"
          : summaryMode
            ? "生成精华版"
            : "重新生成两种内容"}
      </button>
      <small>事实严格来自原文 · 一次调用同时生成精华版与完整卡片版</small>
    </div>
  );
}

function ExportView({
  project,
  theme,
  cards,
  publicationCount,
  publicationOverLimit,
  onExport,
  exporting,
}: any) {
  const summaryMode = project.outputMode === "summary";
  const imageCardMode = project.outputMode === "image-card";
  const disabled = exporting || (summaryMode && publicationOverLimit);
  const actionLabel = summaryMode ? "导出发布文案包" : "导出 PNG 图片包";
  return (
    <div className="page">
      <SectionTitle
        kicker="步骤 04 / 04"
        title="内容导出"
        description={
          summaryMode
            ? "导出可直接粘贴到小红书发布页的标题、正文和标签。"
            : "将全部卡片生成 1080 × 1440 PNG 图片并打包下载。"
        }
        actions={
          <button className="primary" disabled={disabled} onClick={onExport}>
            {exporting ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Download size={16} />
            )}{" "}
            {exporting ? "正在生成…" : actionLabel}
          </button>
        }
      />
      {summaryMode && publicationOverLimit && (
        <div className="export-limit-warning">
          <CircleAlert size={17} />
          <span>
            <b>精华版暂时无法导出</b>
            <small>
              当前共 {publicationCount} 字，超出发布限制{" "}
              {publicationCount - SUMMARY_PUBLICATION_LIMIT}{" "}
              字，请返回编辑器精简。
            </small>
          </span>
        </div>
      )}
      <div className="export-layout">
        <div className="export-main">
          <div className="panel package-files">
            <div className="panel-head">
              <div>
                <h2>发布包内容</h2>
                <p>生成后直接下载到当前设备</p>
              </div>
              <span>{summaryMode ? 6 : cards.length + 5} 个文件</span>
            </div>
            <div className="file-grid">
              <FileItem name="manifest.json" meta="资源清单与生成信息" />
              <FileItem
                name="title.txt"
                meta={`${[...project.title].length} 字符`}
              />
              <FileItem
                name="content.txt"
                meta={`${[...project.summary].length} 字符`}
              />
              <FileItem
                name="tags.txt"
                meta={`${[...project.tags].length} 字符`}
              />
              {summaryMode ? (
                <FileItem
                  name="publish-ready.txt"
                  meta={`合并成稿 · ${publicationCount} / ${SUMMARY_PUBLICATION_LIMIT} 字`}
                />
              ) : (
                <FileItem
                  name="cards/*.png"
                  meta={`${cards.length} 张 · 1080 × 1440`}
                />
              )}
              <FileItem name="source/" meta="原文与结构化数据" />
            </div>
          </div>
        </div>
        <aside className="export-side">
          <div className="panel export-summary">
            <h2>导出摘要</h2>
            <div className="export-cover">
              <span>
                {summaryMode
                  ? "精华版 · 可直接发布"
                  : imageCardMode
                    ? "带图片卡片"
                    : "完整卡片版"}
              </span>
              <b>{project.title}</b>
              <small>
                {summaryMode
                  ? project.publicationTone || "自然真诚"
                  : project.eventName}
              </small>
            </div>
            <dl>
              <div>
                <dt>输出模式</dt>
                <dd>
                  {summaryMode
                    ? "精华版"
                    : imageCardMode
                      ? "带图片卡片"
                      : "完整卡片版"}
                </dd>
              </div>
              {summaryMode ? (
                <div>
                  <dt>发布总字数</dt>
                  <dd className={publicationOverLimit ? "over" : ""}>
                    {publicationCount} / {SUMMARY_PUBLICATION_LIMIT}
                  </dd>
                </div>
              ) : (
                <>
                  <div>
                    <dt>模板</dt>
                    <dd>{themes.find((t) => t.id === theme)?.name}</dd>
                  </div>
                  <div>
                    <dt>卡片数量</dt>
                    <dd>{cards.length} 张</dd>
                  </div>
                  <div>
                    <dt>图片规格</dt>
                    <dd>1080 × 1440</dd>
                  </div>
                  {imageCardMode && (
                    <div>
                      <dt>卡片密度</dt>
                      <dd>紧凑（固定）</dd>
                    </div>
                  )}
                </>
              )}
            </dl>
            <div className="final-checks">
              <b>导出校验</b>
              {summaryMode ? (
                <>
                  <span className={publicationOverLimit ? "pending" : ""}>
                    {publicationOverLimit ? <CircleAlert /> : <CheckCircle2 />}
                    总字数
                    {publicationOverLimit ? "超出 1000 字" : "符合发布限制"}
                  </span>
                  <span>
                    <CheckCircle2 />
                    标题、正文和标签已合并
                  </span>
                  <span>
                    <CheckCircle2 />
                    已生成可直接复制的文本文件
                  </span>
                </>
              ) : (
                <>
                  <span>
                    <CheckCircle2 />
                    卡片数量已确认
                  </span>
                  <span>
                    <CheckCircle2 />
                    图片资源已就绪
                  </span>
                  <span>
                    <CheckCircle2 />
                    页码连续
                  </span>
                </>
              )}
            </div>
            <button
              className="primary wide"
              disabled={disabled}
              onClick={onExport}
            >
              {exporting ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <FileArchive size={17} />
              )}{" "}
              {exporting ? "正在生成…" : actionLabel}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function FileItem({ name, meta }: any) {
  return (
    <div>
      <div className="file-type">
        <FileText size={17} />
      </div>
      <span>
        <b>{name}</b>
        <small>{meta}</small>
      </span>
      <CheckCircle2 size={15} />
    </div>
  );
}

function VersionDrawer({ versions, onRestore, onClose }: any) {
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="version-drawer">
        <div className="drawer-head">
          <div>
            <h2>
              <History size={18} /> 内容版本
            </h2>
            <p>恢复不会删除其他历史记录</p>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="version-timeline">
          {versions.map((v: Version, i: number) => (
            <div key={v.id}>
              <i className={i === 0 ? "latest" : ""} />
              <span>
                <small>{v.at}</small>
                <b>{v.label}</b>
                <em>{v.entity}</em>
              </span>
              <button onClick={() => onRestore(v)}>
                <ArchiveRestore size={14} /> 恢复
              </button>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
