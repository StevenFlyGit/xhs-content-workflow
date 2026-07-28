import { describe, expect, it } from 'vitest'
import {
  fitPublicationDraft,
  publicationCharacterCount,
  publicationText,
  SUMMARY_PUBLICATION_LIMIT,
} from './publication-limits'

describe('summary publication limits', () => {
  it('counts exactly the text copied to the publish page', () => {
    const draft = { title: '标题', body: '正文', tags: '#标签' }
    expect(publicationText(draft)).toBe('标题\n\n正文\n\n#标签')
    expect(publicationCharacterCount(draft)).toBe(11)
  })

  it('keeps the final title, body and tags within 1000 characters', () => {
    const draft = fitPublicationDraft({
      title: '一次值得记录的活动'.repeat(10),
      body: `开场很自然。${'这是一段需要压缩的真实感受。'.repeat(100)}`,
      tags: '#生活记录 #活动体验'.repeat(100),
    })
    expect(publicationCharacterCount(draft)).toBeLessThanOrEqual(SUMMARY_PUBLICATION_LIMIT)
    expect([...draft.title].length).toBeLessThanOrEqual(60)
    expect([...draft.tags].length).toBeLessThanOrEqual(180)
    expect(draft.body.endsWith('。') || draft.body.endsWith('…')).toBe(true)
  })
})
