import { describe, expect, it } from 'vitest'
import { buildSourceSentences, resolveSourceIds } from './source-segmentation'

describe('source segmentation', () => {
  const text = '第一句话。第二句话！\n\n第三段只有一句。'

  it('creates stable sentence and paragraph ids', () => {
    expect(buildSourceSentences(text)).toEqual([
      { id: 'S01-01', paragraphId: 'P01', text: '第一句话。', index: 0 },
      { id: 'S01-02', paragraphId: 'P01', text: '第二句话！', index: 1 },
      { id: 'S02-01', paragraphId: 'P02', text: '第三段只有一句。', index: 0 },
    ])
  })

  it('migrates legacy paragraph ids to sentence ids without duplicates', () => {
    const sentences = buildSourceSentences(text)
    expect(resolveSourceIds(['P01', 'S01-02'], sentences)).toEqual(['S01-01', 'S01-02'])
  })
})
