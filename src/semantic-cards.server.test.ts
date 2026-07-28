import { describe, expect, it } from 'vitest'
import { publicationCharacterCount, SUMMARY_PUBLICATION_LIMIT } from './lib/publication-limits'
import { analyzeSemanticProject } from './semantic-cards.server'

describe('summary mode fallback', () => {
  it('keeps a long publication draft within the hard limit when the model is unavailable', async () => {
    const result = await analyzeSemanticProject({
      name: '一段生活记录',
      outputMode: 'summary',
      originalText: '今天发生了一件值得记录的小事。'.repeat(90),
    }, {})

    expect(result.ok).toBe(true)
    expect(result.mode).toBe('local-fallback')
    expect(result.summaryGeneration).toBe('local-fallback')
    expect(result.generatedModes).toEqual(['summary', 'card'])
    expect(publicationCharacterCount({
      title: result.title,
      body: result.summary,
      tags: result.tags,
    })).toBeLessThanOrEqual(SUMMARY_PUBLICATION_LIMIT)
  })

  it('returns cards and a publication draft even when card mode initiated the analysis', async () => {
    const result = await analyzeSemanticProject({
      name: '开发者社区活动',
      outputMode: 'card',
      originalText: '今天参加了一场开发者社区活动，现场交流很轻松，也记录了不少真实体会。'.repeat(50),
    }, {})

    expect(result.ok).toBe(true)
    expect(result.analysisRequestedMode).toBe('card')
    expect(result.generatedModes).toEqual(['summary', 'card'])
    expect(result.cards.length).toBeGreaterThan(0)
    expect(result.summaryGeneration).toBe('local-fallback')
    expect(result.summary).not.toBe(result.sourceSentences.map(sentence => sentence.text).join(''))
    expect(publicationCharacterCount({
      title: result.title,
      body: result.summary,
      tags: result.tags,
    })).toBeLessThanOrEqual(SUMMARY_PUBLICATION_LIMIT)
  })
})
