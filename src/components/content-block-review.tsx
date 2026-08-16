import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Combine,
  FileText,
  RefreshCw,
  Scissors,
  Sparkles,
} from "lucide-react";
import type { SourceSentence } from "../lib/source-segmentation";
import {
  CardPreview,
  measureCardLayout,
  type CardLayoutStatus,
} from "./card-preview";

export type ContentBlock = {
  id: string;
  title: string;
  summary: string;
  sourceIds: string[];
  role?: "content" | "ending";
  status?: "draft" | "ready" | "overflow" | "manual" | "stale";
  sourceRevision?: string;
  structureRevision?: number;
  titleOrigin?: "model" | "rule" | "manual";
  note?: string;
};

type ReviewState = "idle" | "loading" | "done" | "error";

type ContentBlockReviewProps = {
  state: ReviewState;
  blocks: ContentBlock[];
  setBlocks: React.Dispatch<React.SetStateAction<ContentBlock[]>>;
  sourceSentences: SourceSentence[];
  selectedId: string | null;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  analysisMode?: "model" | "local-fallback";
  analysisWarning?: string;
  onRetry: () => void;
  onRetitle?: (block: ContentBlock) => Promise<string | undefined>;
  onRefine?: (block: ContentBlock) => Promise<ContentBlock[] | undefined>;
  onContinue: () => void;
  onStructureChange: () => void;
  notify: (message: string) => void;
  embedded?: boolean;
};

function blockSentences(
  block: ContentBlock | undefined,
  sourceSentences: SourceSentence[],
) {
  if (!block) return [];
  const ids = new Set(block.sourceIds);
  return sourceSentences.filter((sentence) => ids.has(sentence.id));
}

function textLength(sentences: SourceSentence[]) {
  return [...sentences.map((sentence) => sentence.text).join("")].length;
}

function suggestedTitle(sentences: SourceSentence[]) {
  const source = sentences.map((sentence) => sentence.text).join("");
  if (
    /\u95ee\u9898|\u62a5\u9519|\u5931\u8d25|\u98ce\u9669|\u9650\u5236/.test(
      source,
    )
  )
    return "\u95ee\u9898\u4e0e\u5e94\u5bf9";
  if (
    /\u6b65\u9aa4|\u914d\u7f6e|\u5b89\u88c5|\u90e8\u7f72|\u64cd\u4f5c/.test(
      source,
    )
  )
    return "\u64cd\u4f5c\u6b65\u9aa4";
  if (
    /\u603b\u7ed3|\u7ed3\u8bba|\u6536\u83b7|\u601d\u8003|\u542f\u53d1/.test(
      source,
    )
  )
    return "\u603b\u7ed3\u4e0e\u6536\u83b7";
  if (/\u6848\u4f8b|\u5b9e\u8df5|\u7ecf\u9a8c/.test(source))
    return "\u5b9e\u8df5\u7ecf\u9a8c";
  return "\u672c\u9875\u6838\u5fc3\u5185\u5bb9";
}

function sourceText(sentences: SourceSentence[]) {
  return sentences
    .map(
      (sentence, index) =>
        `${index > 0 && sentences[index - 1]?.paragraphId !== sentence.paragraphId ? "\n\n" : ""}${sentence.text}`,
    )
    .join("");
}

function qualityFor(
  layout: CardLayoutStatus | undefined,
  sentenceCount: number,
) {
  if (!sentenceCount) return { label: "缺少内容", tone: "danger" };
  if (!layout) return { label: "正在按舒展密度校验", tone: "warning" };
  if (layout.horizontalOverflow)
    return { label: "横向溢出，需处理", tone: "danger" };
  if (layout.contentClipped)
    return { label: "正文将裁切，可拆分", tone: "warning" };
  return { label: `舒展占用 ${layout.utilization}%`, tone: "success" };
}

export function ContentBlockReview({
  state,
  blocks,
  setBlocks,
  sourceSentences,
  selectedId,
  setSelectedId,
  analysisMode,
  analysisWarning,
  onRetry,
  onRetitle,
  onRefine,
  onContinue,
  onStructureChange,
  notify,
  embedded = false,
}: ContentBlockReviewProps) {
  useEffect(() => {
    if (
      state === "done" &&
      blocks.length &&
      !blocks.some((block) => block.id === selectedId)
    ) {
      setSelectedId(blocks[0].id);
    }
  }, [blocks, selectedId, setSelectedId, state]);

  const selectedIndex = blocks.findIndex((block) => block.id === selectedId);
  const selected = selectedIndex >= 0 ? blocks[selectedIndex] : blocks[0];
  const selectedSentences = useMemo(
    () => blockSentences(selected, sourceSentences),
    [selected, sourceSentences],
  );
  const candidateHostRef = useRef<HTMLDivElement>(null);
  const [candidateLayouts, setCandidateLayouts] = useState<CardLayoutStatus[]>(
    [],
  );
  const [retitling, setRetitling] = useState(false);
  const [refining, setRefining] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let settleTimer = 0;
    const measure = () => {
      if (cancelled) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nodes = Array.from(
          candidateHostRef.current?.querySelectorAll<HTMLElement>(
            ".card-preview",
          ) || [],
        );
        const next = nodes.map(measureCardLayout);
        setCandidateLayouts((previous) =>
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
    if (candidateHostRef.current) observer?.observe(candidateHostRef.current);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      observer?.disconnect();
    };
  }, [blocks, sourceSentences]);
  const coverage = useMemo(() => {
    const occurrences = new Map<string, number>();
    blocks.forEach((block) =>
      block.sourceIds.forEach((id) =>
        occurrences.set(id, (occurrences.get(id) || 0) + 1),
      ),
    );
    const missing = sourceSentences.filter(
      (sentence) => !occurrences.has(sentence.id),
    ).length;
    const duplicates = [...occurrences.values()].filter(
      (count) => count > 1,
    ).length;
    return { missing, duplicates, covered: sourceSentences.length - missing };
  }, [blocks, sourceSentences]);

  if (state === "loading") {
    return (
      <div className="center-state">
        <div className="analysis-loader">
          <Sparkles />
          <span />
          <span />
        </div>
        <h2>正在理解原文结构</h2>
        <p>系统正在识别主题边界，并确保每句话都被完整收录…</p>
        <div className="progress-track">
          <i />
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="center-state">
        <CircleAlert size={42} />
        <h2>内容分块未完成</h2>
        <p>原始内容已安全保留，可以直接重试。</p>
        <button className="primary" onClick={onRetry}>
          <RefreshCw size={16} /> 重新解析
        </button>
      </div>
    );
  }

  function commit(next: ContentBlock[], nextSelectedId = selected?.id) {
    setBlocks(next);
    setSelectedId(nextSelectedId || next[0]?.id || null);
    onStructureChange();
  }

  function updateSelected(patch: Partial<ContentBlock>) {
    if (!selected) return;
    const normalizedPatch =
      patch.title === undefined
        ? patch
        : {
            ...patch,
            status: "manual" as const,
            titleOrigin: "manual" as const,
          };
    commit(
      blocks.map((block) =>
        block.id === selected.id ? { ...block, ...normalizedPatch } : block,
      ),
      selected.id,
    );
  }

  function merge(direction: -1 | 1) {
    if (!selected) return;
    const neighborIndex = selectedIndex + direction;
    if (neighborIndex < 0 || neighborIndex >= blocks.length) return;
    const neighbor = blocks[neighborIndex];
    const mergedIds = new Set([...selected.sourceIds, ...neighbor.sourceIds]);
    const orderedIds = sourceSentences
      .filter((sentence) => mergedIds.has(sentence.id))
      .map((sentence) => sentence.id);
    const keep = direction < 0 ? neighbor : selected;
    const removeId = direction < 0 ? selected.id : neighbor.id;
    const merged = {
      ...keep,
      sourceIds: orderedIds,
      status: "manual" as const,
    };
    const next = blocks
      .filter((block) => block.id !== removeId)
      .map((block) => (block.id === keep.id ? merged : block));
    commit(next, keep.id);
    notify(direction < 0 ? "已并入上一块" : "已与下一块合并");
  }

  function splitAfter(sentenceId: string) {
    if (!selected) return;
    const boundary = selectedSentences.findIndex(
      (sentence) => sentence.id === sentenceId,
    );
    if (boundary < 0 || boundary >= selectedSentences.length - 1) return;
    const left = selectedSentences.slice(0, boundary + 1);
    const right = selectedSentences.slice(boundary + 1);
    const newBlock: ContentBlock = {
      id: crypto.randomUUID(),
      title: suggestedTitle(right),
      summary: "从原分块中拆分出的独立内容",
      sourceIds: right.map((sentence) => sentence.id),
      status: "manual",
      titleOrigin: "rule",
    };
    const next = [...blocks];
    next.splice(
      selectedIndex,
      1,
      {
        ...selected,
        sourceIds: left.map((sentence) => sentence.id),
        status: "manual",
      },
      newBlock,
    );
    commit(next, newBlock.id);
    notify("已从所选位置拆成两个内容块");
  }

  async function regenerateSelectedTitle() {
    if (!selected || retitling) return;
    setRetitling(true);
    try {
      const nextTitle = onRetitle
        ? await onRetitle(selected)
        : suggestedTitle(selectedSentences);
      if (!nextTitle) return;
      updateSelected({ title: nextTitle });
      if (!onRetitle) notify("已生成规则建议标题");
    } finally {
      setRetitling(false);
    }
  }
  async function refineSelected() {
    if (!selected || refining || !onRefine || selectedSentences.length < 2)
      return;
    setRefining(true);
    try {
      const refined = await onRefine(selected);
      if (!refined?.length) return;
      const next = blocks.flatMap((block) =>
        block.id === selected.id ? refined : [block],
      );
      commit(next, refined[0].id);
    } finally {
      setRefining(false);
    }
  }

  function continueWithLayoutCheck() {

    const horizontal = candidateLayouts.filter(
      (layout) => layout.horizontalOverflow,
    ).length;
    const clipped = candidateLayouts.filter(
      (layout) => layout.contentClipped,
    ).length;
    if (horizontal) {
      notify(`有 ${horizontal} 个单元横向溢出，请先调整标题或内容后再确认`);
      return;
    }
    if (
      clipped &&
      !window.confirm(
        `有 ${clipped} 个单元在舒展密度下会裁切正文。确认后仍可在卡片编辑器中拆分或改写，是否继续？`,
      )
    )
      return;
    onContinue();
  }

  const selectedChars = textLength(selectedSentences);
  const coverageReady = coverage.missing === 0 && coverage.duplicates === 0;

  return (
    <div
      className={`${embedded ? "analysis-page analysis-page-embedded" : "page analysis-page"}`}
    >
      {!embedded && (
        <div className="section-title">
          <div>
            <span>内容编辑器 · 结构解析</span>
            <h1>检查单卡内容结构</h1>
            <p>
              每一项对应一张内容卡；可在完整句子或列表项边界拆分、合并相邻单元，原文顺序始终保持不变。
            </p>
          </div>
          <div className="section-actions">
            <button className="primary" onClick={continueWithLayoutCheck}>
              确认结构并生成内容 <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
      {embedded && (
        <div className="embedded-structure-head">
          <div>
            <b>单卡内容结构</b>
            <span>确认后，每个单元恰好生成一张内容卡。</span>
          </div>
          <div>
            <button className="primary" onClick={continueWithLayoutCheck}>
              确认结构并进入卡片编辑 <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      <div
        className={`coverage-bar ${coverageReady ? "ready" : "attention"}`}
        role="status"
      >
        <div>
          {coverageReady ? (
            <CheckCircle2 size={18} />
          ) : (
            <CircleAlert size={18} />
          )}
          <span>
            <b>{blocks.length} 个内容块</b>
            <small>
              {analysisMode === "local-fallback"
                ? "模型接口本次未返回可用规划，当前按连续段落或同级列表进行本地初步分组；可继续手动调整或点击重新解析。"
                : "已按单卡结构草案与实际卡片容量校验；如有裁切，可手动拆分或按需使用 AI 优化。"}
            </small>
          </span>
        </div>
        <dl>
          <div>
            <dt>原文覆盖</dt>
            <dd>
              {coverage.covered} / {sourceSentences.length} 句
            </dd>
          </div>
          <div>
            <dt>遗漏</dt>
            <dd>{coverage.missing}</dd>
          </div>
          <div>
            <dt>重复</dt>
            <dd>{coverage.duplicates}</dd>
          </div>
        </dl>
      </div>

      {analysisMode === "local-fallback" && analysisWarning && (
        <div className="analysis-fallback-notice" role="status">
          <CircleAlert size={17} />
          <span>
            <b>本次使用本地规则分组</b>
            <small>{analysisWarning}</small>
          </span>
          <button type="button" className="text-button" onClick={onRetry}>
            <RefreshCw size={14} /> 重新解析
          </button>
        </div>
      )}

      <div className="analysis-layout">
        <section className="panel block-outline">
          <div className="panel-head">
            <div>
              <h2>
                单卡内容结构 <em>{blocks.length}</em>
              </h2>
              <p>选择单元查看来源原文；每项确认后生成一张内容卡</p>
            </div>
          </div>
          <div className="block-outline-list">
            {blocks.map((block, index) => {
              const sentences = blockSentences(block, sourceSentences);
              const chars = textLength(sentences);
              const quality = qualityFor(
                candidateLayouts[index],
                sentences.length,
              );
              const preview = sentences
                .map((sentence) => sentence.text)
                .join("")
                .slice(0, 68);
              return (
                <button
                  key={block.id}
                  type="button"
                  className={`block-outline-item ${selected?.id === block.id ? "selected" : ""}`}
                  aria-pressed={selected?.id === block.id}
                  onClick={() => setSelectedId(block.id)}
                >
                  <span className="block-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="block-outline-copy">
                    <b>{block.title}</b>
                    <small>{preview || "当前分块没有可显示的原文内容"}</small>
                    <span className="block-meta">
                      <i>{chars} 字</i>
                      <i>{sentences.length} 句</i>
                      <i>1 张内容卡</i>
                      <i className={quality.tone}>{quality.label}</i>
                    </span>
                  </span>
                  <ChevronRight size={16} />
                </button>
              );
            })}
          </div>
        </section>

        <aside className="panel block-inspector">
          {selected ? (
            <>
              <div className="block-inspector-head">
                <div>
                  <span>当前分块</span>
                  <input
                    aria-label="分块标题"
                    value={selected.title}
                    onChange={(event) =>
                      updateSelected({ title: event.target.value })
                    }
                  />
                </div>
                <button
                  className="secondary small"
                  disabled={retitling}
                  onClick={() => void regenerateSelectedTitle()}
                >
                  <Sparkles size={14} /> {retitling ? "正在生成…" : "重拟标题"}
                </button>
              </div>
              <div className="block-inspector-meta">
                <span>
                  <FileText size={14} />
                  {selectedChars} 字
                </span>
                <span>{selectedSentences.length} 句</span>
                <span>对应 1 张内容卡</span>
                {candidateLayouts[selectedIndex] && (
                  <span>
                    {candidateLayouts[selectedIndex].contentClipped
                      ? "舒展模式将裁切"
                      : `舒展占用 ${candidateLayouts[selectedIndex].utilization}%`}
                  </span>
                )}
              </div>
              <div className="block-content" aria-label="当前分块包含的原文">
                {selectedSentences.length ? (
                  selectedSentences.map((sentence, index) => (
                    <div className="review-sentence" key={sentence.id}>
                      <p>{sentence.text}</p>
                      {index < selectedSentences.length - 1 && (
                        <button
                          className="split-point"
                          onClick={() => splitAfter(sentence.id)}
                        >
                          <span />
                          <Scissors size={13} /> 从这里拆分
                          <span />
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="empty-block">
                    <FileText size={30} />
                    <b>没有匹配到原文内容</b>
                    <span>请重新解析，或将该分块与相邻内容合并。</span>
                  </div>
                )}
              </div>
              <div className="block-inspector-actions">
                <div>
                  <small>来源归属仅可在完整句子或列表项边界调整</small>
                </div>
                <div>
                  <button
                    className="secondary small"
                    disabled={refining || selectedSentences.length < 2}
                    onClick={() => void refineSelected()}
                    title={
                      selectedSentences.length < 2
                        ? "\u5f53\u524d\u5355\u5143\u53ea\u6709\u4e00\u4e2a\u5b8c\u6574\u539f\u6587\u539f\u5b50\uff0c\u65e0\u6cd5\u518d\u5b89\u5168\u62c6\u5206"
                        : undefined
                    }
                  >
                    <Sparkles size={14} />
                    {refining
                      ? "\u6b63\u5728\u4f18\u5316\u2026"
                      : "AI \u4f18\u5316\u6b64\u5355\u5143"}
                  </button>
                  <button
                    disabled={selectedIndex <= 0}
                    onClick={() => merge(-1)}
                  >
                    <ChevronLeft size={14} />
                    <Combine size={14} /> 并入上一单元
                  </button>
                  <button
                    disabled={selectedIndex >= blocks.length - 1}
                    onClick={() => merge(1)}
                  >
                    <Combine size={14} /> 与下一单元合并
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-block inspector-empty">
              <FileText size={34} />
              <b>还没有内容分块</b>
              <span>返回内容输入页，完成解析后即可在这里检查。</span>
            </div>
          )}
        </aside>
      </div>
      <div
        className="card-validation-host"
        ref={candidateHostRef}
        aria-hidden="true"
      >
        {blocks.map((block, index) => (
          <CardPreview
            key={block.id}
            card={{
              title: block.title,
              body: sourceText(blockSentences(block, sourceSentences)),
              pageRole: "content",
            }}
            theme="research-light"
            density="relaxed"
            page={index + 1}
            total={blocks.length}
          />
        ))}
      </div>
    </div>
  );
}
