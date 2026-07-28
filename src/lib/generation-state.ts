export type GeneratedMode = 'summary' | 'card'

export type GenerationInput = {
  name?: string
  eventName?: string
  eventType?: string
  originalText?: string
}

export type GenerationRecord = GenerationInput & {
  generatedModes?: readonly GeneratedMode[]
  generatedSourceKey?: string
}

export function generationSourceKey(input: GenerationInput) {
  const source = [
    input.name || '',
    input.eventName || '',
    input.eventType || '',
    input.originalText || '',
  ].join('\u241f')
  let hash = 2166136261
  for (const character of source) {
    hash ^= character.codePointAt(0) || 0
    hash = Math.imul(hash, 16777619)
  }
  return `v1:${[...source].length}:${(hash >>> 0).toString(36)}`
}

export function hasCurrentGeneration(record: GenerationRecord, mode: GeneratedMode) {
  return record.generatedSourceKey === generationSourceKey(record)
    && record.generatedModes?.includes(mode) === true
}
