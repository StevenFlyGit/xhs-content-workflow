export type SourceSentence = {
  id: string
  paragraphId: string
  text: string
  index: number
}

function splitParagraphIntoSentences(text: string, paragraphIndex: number): SourceSentence[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const units = trimmed.match(/[^。！？!?；;\n]+[。！？!?；;]?|[^。！？!?；;\n]+$/g) || [trimmed]
  return units
    .map((unit, index) => ({
      id: `S${String(paragraphIndex + 1).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`,
      paragraphId: `P${String(paragraphIndex + 1).padStart(2, '0')}`,
      text: unit.trim(),
      index,
    }))
    .filter(item => item.text)
}

export function buildSourceSentences(originalText: string): SourceSentence[] {
  return originalText
    .split(/\n\s*\n/)
    .flatMap((paragraph, paragraphIndex) => splitParagraphIntoSentences(paragraph, paragraphIndex))
}

export function resolveSourceIds(sourceIds: string[], sentences: SourceSentence[]): string[] {
  const sentenceIds = new Set(sentences.map(sentence => sentence.id))
  const resolved = sourceIds.flatMap(id => {
    if (sentenceIds.has(id)) return [id]
    return sentences.filter(sentence => sentence.paragraphId === id).map(sentence => sentence.id)
  })
  return [...new Set(resolved)]
}
