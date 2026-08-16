import { ImagePlus } from "lucide-react";

export type CardPreviewData = {
  title?: string;
  eyebrow?: string;
  body?: string;
  bullets?: string[];
  addedLead?: string;
  addedEnding?: string;
  enhancement?: {
    leadEnabled?: boolean;
    endingEnabled?: boolean;
    source?: "model" | "manual";
  };
  pageRole?: string;
  imageLayout?: boolean;
};

const technicalTokenPattern =
  /((?:https?:\/\/|www\.)[^\s]+|(?:[A-Za-z]:)?(?:[A-Za-z0-9._-]+[\\/][^\s]+)|[A-Za-z0-9][A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{15,})/g;
const technicalTokenMatcher =
  /^(?:(?:https?:\/\/|www\.)[^\s]+|(?:[A-Za-z]:)?(?:[A-Za-z0-9._-]+[\\/][^\s]+)|[A-Za-z0-9][A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{15,})$/;

/**
 * Ordinary English keeps natural word wrapping. URLs, paths, and long
 * technical identifiers use character breaks only after filling the line.
 */
function renderTextWithLineEndBreaks(text: string) {
  return text.split(technicalTokenPattern).map((part, index) => {
    if (!part) return null;
    return technicalTokenMatcher.test(part) ? (
      <span className="line-end-break" key={index}>
        {part}
      </span>
    ) : (
      part
    );
  });
}

export type CardLayoutStatus = {
  overflow: boolean;
  contentClipped: boolean;
  utilization: number;
  horizontalOverflow: boolean;
  verticalOverflow: boolean;
};

function safeCard(
  card: CardPreviewData | undefined,
  index: number,
): Required<Pick<CardPreviewData, "title" | "body">> & CardPreviewData {
  return {
    ...card,
    eyebrow:
      card?.eyebrow?.trim() ||
      `${String(index + 1).padStart(2, "0")} · 原文卡片`,
    title: card?.title?.trim() || `第 ${index + 1} 页`,
    body: card?.body || "",
    bullets: Array.isArray(card?.bullets)
      ? card!.bullets!.filter((item) => typeof item === "string")
      : undefined,
  };
}

export function measureCardLayout(node: HTMLElement): CardLayoutStatus {
  const body = node.querySelector<HTMLElement>(".card-body");
  const title = node.querySelector<HTMLElement>(".card-title");
  const head = node.querySelector<HTMLElement>(".card-head");
  const foot = node.querySelector<HTMLElement>(".card-foot");
  if (!body || !title || !head || !foot)
    return {
      overflow: false,
      contentClipped: false,
      utilization: 0,
      horizontalOverflow: false,
      verticalOverflow: false,
    };

  const nodeRect = node.getBoundingClientRect();
  const bodyRect = body.getBoundingClientRect();
  const availableHeight = Math.max(1, body.clientHeight);
  const bodyContentHeight = Math.max(body.scrollHeight, bodyRect.height);
  // Browser sub-pixel rounding can create a 1–2px delta in a hidden card.
  const layoutTolerance = 3;
  const bodyOverflowPx = Math.max(0, body.scrollHeight - body.clientHeight);
  const titleOverflowPx = Math.max(0, title.scrollHeight - title.clientHeight);
  const bodyClipped = bodyOverflowPx > layoutTolerance;
  const titleClipped = titleOverflowPx > layoutTolerance;
  const verticalOverflow = bodyClipped || titleClipped;
  const utilization = Math.max(
    0,
    Math.round((bodyContentHeight / availableHeight) * 100),
  );
  const measuredNodes = [
    node,
    title,
    head,
    body,
    foot,
    ...Array.from(body.querySelectorAll<HTMLElement>("*")),
  ];
  const horizontalOverflow =
    measuredNodes.some(
      (element) => element.scrollWidth > element.clientWidth + 1,
    ) ||
    bodyRect.left < nodeRect.left - 1 ||
    bodyRect.right > nodeRect.right + 1;

  return {
    overflow: horizontalOverflow,
    contentClipped: verticalOverflow,
    utilization,
    horizontalOverflow,
    verticalOverflow,
  };
}

export function CardPreview({
  card,
  theme,
  density,
  page,
  total,
  overflow = false,
  mediaUrl,
}: {
  card: CardPreviewData;
  theme: string;
  density: string;
  page: number;
  total: number;
  overflow?: boolean;
  mediaUrl?: string;
}) {
  const normalized = safeCard(card, Math.max(0, page - 1));
  const imageCard = normalized.imageLayout === true && normalized.pageRole !== "cover";
  const showLead =
    normalized.enhancement?.leadEnabled ?? Boolean(normalized.addedLead);
  const showEnding =
    normalized.enhancement?.endingEnabled ?? Boolean(normalized.addedEnding);
  const title = (
    <h2 className="card-title">
      {normalized.title.split("\n").map((line, index) => (
        <span key={index}>{renderTextWithLineEndBreaks(line)}</span>
      ))}
    </h2>
  );
  const pageMark = (
    <div className="card-head">
      <i>{String(page).padStart(2, "0")}</i>
    </div>
  );
  return (
    <div
      className={`card-preview ${theme} ${density}${imageCard ? " image-card" : ""}${overflow ? " layout-overflow" : ""}`}
    >
      <div className="card-accent" />
      {imageCard ? (
        <>
          <div className="card-image-header">{pageMark}</div>
          <div className={`card-media-slot ${mediaUrl ? "has-media" : ""}`}>
            {mediaUrl ? (
              <img src={mediaUrl} alt="本页卡片配图" />
            ) : (
              <span>
                <ImagePlus size={18} /> 上传图片后将在此处展示
              </span>
            )}
          </div>
          {title}
        </>
      ) : (
        <div className="card-topline">
          {title}
          {pageMark}
        </div>
      )}
      <div className="card-body">
        {showLead && normalized.addedLead && (
          <p className="added-text">
            {renderTextWithLineEndBreaks(normalized.addedLead)}
          </p>
        )}
        <p className="original-text">
          {renderTextWithLineEndBreaks(normalized.body)}
        </p>
        {normalized.bullets && (
          <ul>
            {normalized.bullets.map((item, index) => (
              <li key={index}>
                <i>{index + 1}</i>
                <span>{renderTextWithLineEndBreaks(item)}</span>
              </li>
            ))}
          </ul>
        )}
        {showEnding && normalized.addedEnding && (
          <p className="added-text ending">
            {renderTextWithLineEndBreaks(normalized.addedEnding)}
          </p>
        )}
      </div>
      <div className="card-foot">
        <span>原文保真 · 系统仅加标题/导语</span>
        <b>
          {page} / {total}
        </b>
      </div>
    </div>
  );
}
