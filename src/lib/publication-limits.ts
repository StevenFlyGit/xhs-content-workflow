export const SUMMARY_PUBLICATION_LIMIT = 1000
export const SUMMARY_REWRITE_THRESHOLD = 950
export const SUMMARY_GENERATION_TARGET = 900

export type PublicationDraft = {
  title: string
  body: string
  tags: string
}

export function publicationText(draft: PublicationDraft) {
  return [draft.title.trim(), draft.body.trim(), draft.tags.trim()].filter(Boolean).join('\n\n')
}

export function publicationCharacterCount(draft: PublicationDraft) {
  return [...publicationText(draft)].length
}

function clipAtNaturalBoundary(text: string, maxLength: number) {
  if (maxLength <= 0) return ''
  if ([...text].length <= maxLength) return text
  const clipped = [...text].slice(0, Math.max(1, maxLength - 1)).join('')
  const searchStart = Math.floor(clipped.length * 0.72)
  const tail = clipped.slice(searchStart)
  const matches = [...tail.matchAll(/[。！？!?；;\n]/g)]
  const lastBoundary = matches.at(-1)
  if (lastBoundary?.index != null) return `${clipped.slice(0, searchStart + lastBoundary.index + 1).trim()}`
  return `${clipped.trim()}…`
}

export function fitPublicationDraft(draft: PublicationDraft, limit = SUMMARY_PUBLICATION_LIMIT): PublicationDraft {
  const normalized = {
    title: [...draft.title.trim()].slice(0, 60).join(''),
    body: draft.body.trim(),
    tags: [...draft.tags.trim()].slice(0, 180).join(''),
  }
  if (publicationCharacterCount(normalized) <= limit) return normalized
  const fixedCount = publicationCharacterCount({ ...normalized, body: '' })
  const separators = normalized.title && normalized.tags ? 2 : normalized.title || normalized.tags ? 2 : 0
  const bodyBudget = Math.max(0, limit - fixedCount - separators)
  return { ...normalized, body: clipAtNaturalBoundary(normalized.body, bodyBudget) }
}
