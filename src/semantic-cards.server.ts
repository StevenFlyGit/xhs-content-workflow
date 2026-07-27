type RuntimeEnv = Record<string, unknown>

type ProjectPayload = {
  name?: string
  eventName?: string
  originalText?: string
}

type SourceSentence = {
  id: string
  paragraphId: string
  text: string
  index: number
}

type SemanticCard = {
  eyebrow: string
  title: string
  body: string
  addedLead?: string
  addedEnding?: string
  semanticBlockId?: string
  pageRole?: string
  sourceSentenceIds?: string[]
}

type ModelBlock = {
  id: string
  title: string
  summary?: string
  sourceSentenceIds: string[]
  estimatedCardCount?: number
}

type ModelCardPlan = {
  blockId: string
  pageRole: 'cover' | 'block-start' | 'content' | 'content-continued' | 'block-summary' | 'ending'
  title: string
  addedLead?: string
  addedEnding?: string
  sourceSentenceIds: string[]
}

type ModelPlan = {
  deckTitle?: string
  deckSubtitle?: string
  semanticBlocks: ModelBlock[]
  cards: ModelCardPlan[]
}

function envString(env: RuntimeEnv | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = env?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function splitParagraphIntoSentences(text: string, paragraphIndex: number) {
  const trimmed = text.trim()
  if (!trimmed) return []
  const units = trimmed.match(/[^。！？!?；;\n]+[。！？!?；;]?|[^。！？!?；;\n]+$/g) || [trimmed]
  return units.map((unit, index) => ({
    id: `S${String(paragraphIndex + 1).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`,
    paragraphId: `P${String(paragraphIndex + 1).padStart(2, '0')}`,
    text: unit.trim(),
    index,
  })).filter(item => item.text)
}

function buildSourceSentences(originalText: string): SourceSentence[] {
  return originalText
    .split(/\n\s*\n/)
    .flatMap((paragraph, paragraphIndex) => splitParagraphIntoSentences(paragraph, paragraphIndex))
}

function compactJsonFromModel(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型返回不是 JSON')
  return JSON.parse(raw.slice(start, end + 1)) as ModelPlan
}

function cardBudgetForText(text: string) {
  const len = [...text].length
  if (len <= 150) return '舒展'
  if (len <= 270) return '标准'
  return '紧凑'
}

function compactTitle(value: string) {
  return value.replace(/[。！？!?，,；;：:\s]/g, '').replace(/[.。…]+$/g, '').slice(0, 14)
}

function titleLooksCopied(title: string, body: string) {
  const cleanTitle = compactTitle(title)
  const cleanBody = compactTitle(body).slice(0, Math.max(8, cleanTitle.length))
  if (!cleanTitle) return true
  if (cleanTitle.includes('…') || cleanTitle.includes('...') || /第?\d+页|·\s*\d+$/.test(title)) return true
  if (cleanTitle.length > 16) return true
  return cleanBody.length >= 8 && (cleanBody.startsWith(cleanTitle.slice(0, 8)) || cleanTitle.startsWith(cleanBody.slice(0, 8)))
}

function makeFallbackTitle(index: number, blockTitle?: string, role?: string) {
  const base = compactTitle(blockTitle || '')
  if (base && base.length <= 14 && !/内容块|原文|第\d+页/.test(base)) return base
  if (role === 'ending') return '最后的思考'
  if (role === 'block-start') return `观察重点${String(index + 1).padStart(2, '0')}`
  return `内容小节${String(index + 1).padStart(2, '0')}`
}

function safeGeneratedTitle(title: string, body: string, index: number, blockTitle?: string, role?: string) {
  return titleLooksCopied(title, body) ? makeFallbackTitle(index, blockTitle, role) : compactTitle(title)
}

function buildBodyFromIds(sentences: SourceSentence[], ids: string[]) {
  const set = new Set(ids)
  return sentences.filter(sentence => set.has(sentence.id)).map(sentence => sentence.text).join('')
}

function fallbackPlan(project: ProjectPayload, sentences: SourceSentence[]): { semanticBlocks: ModelBlock[]; cards: SemanticCard[]; title: string; summary: string; tags: string } {
  const blockMap = new Map<string, SourceSentence[]>()
  sentences.forEach(sentence => {
    const list = blockMap.get(sentence.paragraphId) || []
    list.push(sentence)
    blockMap.set(sentence.paragraphId, list)
  })
  const semanticBlocks: ModelBlock[] = [...blockMap.entries()].map(([paragraphId, list], index) => {
    return {
      id: `B${String(index + 1).padStart(2, '0')}`,
      title: `内容小节${String(index + 1).padStart(2, '0')}`,
      summary: '按自然段生成的本地回退分块，配置模型后会生成语义小标题',
      sourceSentenceIds: list.map(item => item.id),
      estimatedCardCount: Math.max(1, Math.ceil([...list.map(item => item.text).join('')].length / 240)),
    }
  })
  const cards: SemanticCard[] = []
  cards.push({
    eyebrow: project.eventName || '完整原文卡片',
    title: project.name || project.eventName || '内容整理',
    body: '以下内容按原文顺序拆分为可阅读图片，正文区保留用户原文。',
    pageRole: 'cover',
  })
  for (const block of semanticBlocks) {
    const blockSentences = sentences.filter(sentence => block.sourceSentenceIds.includes(sentence.id))
    let buffer: SourceSentence[] = []
    let currentLength = 0
    let part = 1
    for (const sentence of blockSentences) {
      const length = [...sentence.text].length
      if (buffer.length && currentLength + length > 240) {
        cards.push({
          eyebrow: `${block.id} · ${part > 1 ? '延续' : '语义块'}`,
          title: makeFallbackTitle(part - 1, block.title, part === 1 ? 'block-start' : 'content-continued'),
          body: buffer.map(item => item.text).join(''),
          semanticBlockId: block.id,
          pageRole: part === 1 ? 'block-start' : 'content-continued',
          sourceSentenceIds: buffer.map(item => item.id),
        })
        buffer = []
        currentLength = 0
        part += 1
      }
      buffer.push(sentence)
      currentLength += length
    }
    if (buffer.length) {
      cards.push({
        eyebrow: `${block.id} · ${cardBudgetForText(buffer.map(item => item.text).join(''))}`,
        title: makeFallbackTitle(part - 1, block.title, part === 1 ? 'block-start' : 'content-continued'),
        body: buffer.map(item => item.text).join(''),
        semanticBlockId: block.id,
        pageRole: part === 1 ? 'block-start' : 'content-continued',
        sourceSentenceIds: buffer.map(item => item.id),
      })
    }
  }
  const title = project.name || project.eventName || '完整内容卡片'
  return {
    semanticBlocks,
    cards,
    title,
    summary: sentences.map(sentence => sentence.text).join(''),
    tags: '#小红书图文 #内容整理 #完整原文',
  }
}

function normalizePlan(project: ProjectPayload, sentences: SourceSentence[], plan: ModelPlan) {
  const validIds = new Set(sentences.map(sentence => sentence.id))
  const used = new Set<string>()
  const blocks = Array.isArray(plan.semanticBlocks) ? plan.semanticBlocks.map((block, index) => ({
    id: block.id || `B${String(index + 1).padStart(2, '0')}`,
    title: String(block.title || `语义块 ${index + 1}`).slice(0, 30),
    summary: block.summary || '',
    sourceSentenceIds: (block.sourceSentenceIds || []).filter(id => validIds.has(id)),
    estimatedCardCount: block.estimatedCardCount || 1,
  })).filter(block => block.sourceSentenceIds.length) : []

  const cards: SemanticCard[] = []
  cards.push({
    eyebrow: project.eventName || '完整原文卡片',
    title: String(plan.deckTitle || project.name || project.eventName || '内容整理').slice(0, 36),
    body: String(plan.deckSubtitle || '按语义顺序拆成一组可阅读、可发布的小红书图片。').slice(0, 90),
    pageRole: 'cover',
  })

  for (const item of Array.isArray(plan.cards) ? plan.cards : []) {
    const ids = (item.sourceSentenceIds || []).filter(id => validIds.has(id) && !used.has(id))
    if (!ids.length) continue
    ids.forEach(id => used.add(id))
    const block = blocks.find(value => value.id === item.blockId)
    const body = buildBodyFromIds(sentences, ids)
    cards.push({
      eyebrow: `${item.blockId || block?.id || '语义块'} · ${item.pageRole === 'content-continued' ? '延续' : '原文'}`,
      title: safeGeneratedTitle(String(item.title || ''), body, cards.length - 1, block?.title, item.pageRole),
      addedLead: item.addedLead ? String(item.addedLead).slice(0, 60) : undefined,
      addedEnding: item.addedEnding ? String(item.addedEnding).slice(0, 60) : undefined,
      body,
      semanticBlockId: item.blockId,
      pageRole: item.pageRole,
      sourceSentenceIds: ids,
    })
  }

  const missing = sentences.filter(sentence => !used.has(sentence.id))
  if (missing.length) {
    const fallback = fallbackPlan(project, missing).cards.filter(card => card.pageRole !== 'cover')
    cards.push(...fallback)
  }

  return {
    semanticBlocks: blocks,
    cards,
    title: plan.deckTitle || project.name || project.eventName || '完整内容卡片',
    summary: sentences.map(sentence => sentence.text).join(''),
    tags: '#小红书图文 #完整原文 #内容整理',
  }
}

async function callOpenAICompatible(env: RuntimeEnv | undefined, project: ProjectPayload, sentences: SourceSentence[]) {
  const baseUrl = envString(env, 'MODEL_BASE_URL', 'model_base_url').replace(/\/$/, '') || 'https://api.openai.com/v1'
  const apiKey = envString(env, 'MODEL_KEY', 'model_key', 'OPENAI_API_KEY')
  const model = envString(env, 'MODEL_NAME', 'model_name') || 'gpt-4.1-mini'
  if (!apiKey) throw new Error('缺少模型密钥')

  const prompt = `你是一个中文内容编辑系统。任务：将用户提交的完整文段，按语义顺序拆成若干张可阅读、可发布的小红书图片。\n\n硬性规则：\n1. 图片正文必须完整保留用户原文，不得改写、删减、总结、替换原文句子。\n2. 你只能返回句子 ID 的分组、每页标题、少量导语/结束语。\n3. 标题不能直接截取正文开头，需概括本页原文。\n4. 每张内容卡尽量 120-280 个中文字符；过长语义块拆成连续的 2-4 张卡。\n5. 不要在语义强相关的句子中间强行断开；同一语义块的卡片必须连续。\n6. 所有句子 ID 必须且只能出现一次；若确实无法判断，也要按原顺序分配。\n7. 每张卡的 title 必须是你根据本页内容生成的“小标题”，控制在 6-14 个汉字；禁止直接复制原文开头，禁止使用省略号，禁止追加“· 2 / 第2页”等页码。\n8. 如果原文开头是“一楼的H1-1展区主要是……”这类句子，标题应概括为“展区里的模型信号”“未来会走向何处”这类短标题，而不是照搬正文。\n\n用户背景：\n项目：${project.name || ''}\n活动：${project.eventName || ''}\n\n句子列表：\n${sentences.map(sentence => `${sentence.id}: ${sentence.text}`).join('\n')}\n\n只返回 JSON，不要解释。格式：\n{\n  "deckTitle": "整组图片标题",\n  "deckSubtitle": "一句封面副标题",\n  "semanticBlocks": [{"id":"B01","title":"语义块标题","summary":"块说明","sourceSentenceIds":["S01-01"],"estimatedCardCount":2}],\n  "cards": [{"blockId":"B01","pageRole":"block-start","title":"本页标题","addedLead":"可选短导语","addedEnding":"可选短结束语","sourceSentenceIds":["S01-01"]}]\n}`

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '你只输出合法 JSON。不要改写用户原文主体。title 必须是原创概括小标题，不能复制正文开头，不能包含省略号或页码。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`模型接口调用失败：${response.status} ${detail.slice(0, 180)}`)
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('模型未返回内容')
  return compactJsonFromModel(content)
}

export async function analyzeSemanticProject(project: ProjectPayload, env?: RuntimeEnv) {
  const originalText = project.originalText || ''
  if (!originalText.trim()) {
    return { ok: false, error: '请先输入原文' }
  }
  const sentences = buildSourceSentences(originalText)
  if (!sentences.length) {
    return { ok: false, error: '未识别到可分页文本' }
  }

  try {
    const plan = await callOpenAICompatible(env, project, sentences)
    return { ok: true, mode: 'model', sourceSentences: sentences, ...normalizePlan(project, sentences, plan) }
  } catch (modelError) {
    const fallback = fallbackPlan(project, sentences)
    return {
      ok: true,
      mode: 'local-fallback',
      warning: modelError instanceof Error ? modelError.message : '模型调用失败，已使用本地回退',
      sourceSentences: sentences,
      ...fallback,
    }
  }
}

export async function handleSemanticCardsRequest(request: Request, env?: RuntimeEnv) {
  const url = new URL(request.url)
  if (url.pathname !== '/api/semantic-cards') return null
  if (request.method !== 'POST') return Response.json({ ok: false, error: 'Method Not Allowed' }, { status: 405 })
  try {
    const project = await request.json() as ProjectPayload
    const result = await analyzeSemanticProject(project, env)
    return Response.json(result, { status: result.ok ? 200 : 400 })
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : '语义解析失败' }, { status: 500 })
  }
}
