import { createFileRoute } from '@tanstack/react-router'
import { createServerFn, useServerFn } from '@tanstack/react-start'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArchiveRestore, BookOpenCheck, Check, CheckCircle2, ChevronLeft, ChevronRight,
  CircleAlert, Download, Eye, FileArchive, FileText,
  History, LayoutDashboard, ListChecks, LoaderCircle, Menu,
  MoreHorizontal, Palette, PanelRight, Plus, RefreshCw, Save, Search, Settings2,
  Sparkles, Trash2, X,
} from 'lucide-react'
import { toBlob } from 'html-to-image'
import JSZip from 'jszip'
import { ContentBlockReview, type ContentBlock } from '../components/content-block-review'
import { SummaryEditor } from '../components/summary-editor'
import {
  generationSourceKey,
  hasCurrentGeneration,
  type GeneratedMode,
} from '../lib/generation-state'
import {
  publicationCharacterCount,
  publicationText,
  SUMMARY_PUBLICATION_LIMIT,
  SUMMARY_REWRITE_THRESHOLD,
} from '../lib/publication-limits'
import { buildSourceSentences, resolveSourceIds, type SourceSentence } from '../lib/source-segmentation'
import { analyzeSemanticProject } from '../semantic-cards.server'

export const Route = createFileRoute('/')({ component: Home })

type Step = 'projects' | 'input' | 'analysis' | 'editor' | 'export'
type Density = 'relaxed' | 'standard' | 'compact'
type ThemeId = 'research-light' | 'ai-dark' | 'warm-reflection' | 'structured-notes'
type Insight = ContentBlock
type Card = {
  title: string
  eyebrow: string
  body: string
  bullets?: string[]
  addedLead?: string
  addedEnding?: string
  semanticBlockId?: string
  pageRole?: string
  sourceSentenceIds?: string[]
}
type Version = { id: string; label: string; entity: string; at: string; snapshot?: unknown }
type ExportRecord = { id: string; fileName: string; theme: ThemeId; chars: number; cards: number; at: string; storagePath?: string }
type LocalWorkspace = {
  id: string; project: ProjectState; insights: Insight[]; cards: Card[]
  theme: ThemeId; density: Density; editorMode?: 'summary' | 'card'; updatedAt: string
  sourceSentences?: SourceSentence[]; analysisMode?: 'model' | 'local-fallback'
}

type ProjectState = {
  id?: string; name: string; eventName: string; eventType: string; originalText: string
  outputMode: 'summary' | 'card'; title: string; summary: string; tags: string
  publicationTone?: string
  summaryGeneration?: 'model' | 'local-fallback'
  summaryWasRewritten?: boolean
  generatedModes?: GeneratedMode[]
  generatedSourceKey?: string
  analysisRequestedMode?: GeneratedMode
}

type SemanticApiResponse = {
  ok: boolean
  mode?: 'model' | 'local-fallback'
  warning?: string
  error?: string
  title?: string
  summary?: string
  tags?: string
  publicationTone?: string
  publicationCharacterCount?: number
  summaryGeneration?: 'model' | 'local-fallback'
  summaryWasRewritten?: boolean
  generatedModes?: GeneratedMode[]
  analysisRequestedMode?: GeneratedMode
  cards?: Card[]
  sourceSentences?: SourceSentence[]
  semanticBlocks?: Array<{ id: string; title: string; summary?: string; sourceSentenceIds: string[]; estimatedCardCount?: number }>
}

const analyzeSemanticCards = createServerFn({ method: 'POST' })
  .validator((data: ProjectState) => data)
  .handler(async ({ data, context }) => {
    return analyzeSemanticProject(data, (context as { env?: Record<string, unknown> }).env) as Promise<SemanticApiResponse>
  })

const sampleText = `上周参加了一场关于 AI Agent 产品落地的圆桌讨论。相比模型能力本身，现场更多人关注的是 Agent 如何真正进入业务流程。

第一个共识是：Agent 的价值不在于“会聊天”，而在于能否在清晰边界内持续完成任务。工具调用、上下文管理和失败恢复，决定了它是不是一个可靠产品。

一位创业者分享了客服 Agent 的案例。早期团队追求全自动，结果因为异常场景太多，用户反而失去信任。后来他们把产品改成“默认执行、关键节点确认”，完成率和满意度同时提高。

我最大的认知变化是，Agent 产品设计不是不断增加自主性，而是设计合适的人机协作颗粒度。哪些步骤可以自动做，哪些决策必须解释，哪些风险需要用户确认，这些比 Demo 的惊艳程度更重要。

接下来我会用三个问题重新检查自己的产品：任务边界是否明确？失败后是否可恢复？用户是否随时知道系统正在做什么？这可能才是 Agent 从玩具走向工具的关键。`

const initialSourceSentences = buildSourceSentences(sampleText)
const initialSentenceIds = (paragraphId: string) => initialSourceSentences
  .filter(sentence => sentence.paragraphId === paragraphId)
  .map(sentence => sentence.id)

const initialProject: ProjectState = {
  name: 'AI Agent 圆桌复盘', eventName: 'AI Agent 产品落地圆桌', eventType: 'Roundtable Discussion',
  originalText: sampleText, outputMode: 'card',
  title: '参加一场 AI 圆桌后，我重新理解了 Agent 产品',
  summary: '上周参加了一场关于 AI Agent 产品落地的圆桌。现场最重要的共识，不是模型又变强了，而是 Agent 如何真正进入业务流程。\n\n01｜价值不在“会聊天”\nAgent 能否在清晰边界内持续完成任务，取决于工具调用、上下文管理和失败恢复。\n\n02｜全自动不等于好产品\n一个客服 Agent 从全自动改为“默认执行、关键节点确认”后，完成率和满意度反而同时提高。\n\n03｜重新设计人机协作颗粒度\n哪些步骤可以自动做，哪些决策必须解释，哪些风险需要用户确认，比 Demo 的惊艳程度更重要。\n\n接下来我会用三个问题检查产品：任务边界是否明确？失败后是否可恢复？用户是否随时知道系统正在做什么？',
  tags: '#AI产品 #AIAgent #产品经理 #创业思考 #活动复盘',
  publicationTone: '严谨有思考',
  summaryGeneration: 'model',
  summaryWasRewritten: false,
  generatedModes: ['summary', 'card'],
  generatedSourceKey: generationSourceKey({
    name: 'AI Agent 圆桌复盘',
    eventName: 'AI Agent 产品落地圆桌',
    eventType: 'Roundtable Discussion',
    originalText: sampleText,
  }),
  analysisRequestedMode: 'card',
}

function createEmptyProject(name = '新内容项目'): ProjectState {
  return {
    name, eventName: '', eventType: 'Roundtable Discussion', originalText: '',
    outputMode: 'card', title: '', summary: '', tags: '',
  }
}

function normalizeOutputMode(value: unknown, fallback: unknown = 'card'): 'summary' | 'card' {
  if (value === 'summary' || value === 'card') return value
  return fallback === 'summary' ? 'summary' : 'card'
}

const initialInsights: Insight[] = [
  { id: 'insight-1', title: '圆桌讨论的关注点', summary: '讨论从模型能力转向 Agent 如何真正进入业务流程。', sourceIds: initialSentenceIds('P01') },
  { id: 'insight-2', title: 'Agent 的价值不在“会聊天”', summary: '能否在清晰边界内持续完成任务，才是 Agent 成为可靠产品的关键。', sourceIds: initialSentenceIds('P02') },
  { id: 'insight-3', title: '全自动不等于更好的体验', summary: '默认执行、关键节点确认，让完成率与用户信任同时提升。', sourceIds: initialSentenceIds('P03') },
  { id: 'insight-4', title: '设计人机协作的颗粒度', summary: '自主性不是越多越好，解释、确认与风险边界同样重要。', sourceIds: initialSentenceIds('P04') },
  { id: 'insight-5', title: '用三个问题检查 Agent 产品', summary: '任务边界、失败恢复、过程可见性，决定 Agent 能否从玩具走向工具。', sourceIds: initialSentenceIds('P05') },
]

const initialCards: Card[] = [
  { eyebrow: 'AI AGENT ROUNDTABLE', title: '我重新理解了\nAgent 产品', body: '一场圆桌讨论后，关于任务边界、用户信任与人机协作的 4 个关键认知。' },
  { eyebrow: '01 · 核心共识', title: '价值不在\n“会聊天”', body: 'Agent 能否在清晰边界内持续完成任务，取决于它是不是一个可靠的执行系统。', bullets: ['工具调用是否稳定', '上下文是否连续', '失败后是否可恢复'] },
  { eyebrow: '02 · 真实案例', title: '全自动，未必是\n更好的产品', body: '客服 Agent 从“完全自动”调整为“默认执行、关键节点确认”后，完成率和满意度同时提高。' },
  { eyebrow: '03 · 认知变化', title: '设计协作颗粒度', body: '哪些步骤可以自动做，哪些决策必须解释，哪些风险需要用户确认，比 Demo 是否惊艳更重要。' },
  { eyebrow: '04 · 行动清单', title: '重新检查产品', body: '下一次设计 Agent 时，先回答这三个问题。', bullets: ['任务边界是否明确？', '失败之后是否可恢复？', '用户是否知道系统在做什么？'] },
  { eyebrow: 'SUMMARY', title: '从玩具走向工具', body: '真正的 Agent 产品，不是不断增加自主性，而是在自动执行与用户控制之间建立可持续的信任。' },
]

function normalizeCard(card: Partial<Card> | undefined, index = 0): Card {
  return {
    eyebrow: typeof card?.eyebrow === 'string' && card.eyebrow.trim() ? card.eyebrow : `${String(index + 1).padStart(2, '0')} · 原文卡片`,
    title: typeof card?.title === 'string' && card.title.trim() ? card.title : `第 ${index + 1} 页`,
    body: typeof card?.body === 'string' ? card.body : '',
    bullets: Array.isArray(card?.bullets) ? card.bullets.filter(item => typeof item === 'string') : undefined,
    addedLead: typeof card?.addedLead === 'string' ? card.addedLead : undefined,
    addedEnding: typeof card?.addedEnding === 'string' ? card.addedEnding : undefined,
    semanticBlockId: typeof card?.semanticBlockId === 'string' ? card.semanticBlockId : undefined,
    pageRole: typeof card?.pageRole === 'string' ? card.pageRole : undefined,
    sourceSentenceIds: Array.isArray(card?.sourceSentenceIds) ? card.sourceSentenceIds.filter(item => typeof item === 'string') : undefined,
  }
}

function normalizeCards(value: unknown): Card[] {
  return Array.isArray(value) ? value.map((item, index) => normalizeCard(item as Partial<Card>, index)) : []
}

function normalizeInsightSources(insights: Insight[], sentences: SourceSentence[]): Insight[] {
  return insights.map(insight => ({
    id: insight.id,
    title: insight.title,
    summary: insight.summary || '',
    sourceIds: resolveSourceIds(Array.isArray(insight.sourceIds) ? insight.sourceIds : [], sentences),
  }))
}

function joinSourceText(sentences: SourceSentence[]) {
  return sentences.map((sentence, index) => {
    const previous = sentences[index - 1]
    return `${previous && previous.paragraphId !== sentence.paragraphId ? '\n\n' : ''}${sentence.text}`
  }).join('')
}

function buildCardsFromBlocks(project: ProjectState, blocks: Insight[], sentences: SourceSentence[], existingCards: Card[]): Card[] {
  const existingCover = normalizeCards(existingCards)[0]
  const cover: Card = existingCover ? { ...existingCover, pageRole: 'cover', semanticBlockId: undefined, sourceSentenceIds: [] } : {
    eyebrow: project.eventName || '完整原文卡片',
    title: project.title || project.name || project.eventName || '内容整理',
    body: `以下内容已按 ${blocks.length} 个主题分块，正文完整保留原文。`,
    pageRole: 'cover',
    sourceSentenceIds: [],
  }
  const contentCards = blocks.flatMap((block, blockIndex) => {
    const ids = new Set(block.sourceIds)
    const blockSources = sentences.filter(sentence => ids.has(sentence.id))
    const groups: SourceSentence[][] = []
    let current: SourceSentence[] = []
    let currentLength = 0
    blockSources.forEach(sentence => {
      const length = [...sentence.text].length
      if (current.length && currentLength + length > 240) {
        groups.push(current)
        current = []
        currentLength = 0
      }
      current.push(sentence)
      currentLength += length
    })
    if (current.length) groups.push(current)
    return groups.map((group, groupIndex) => ({
      eyebrow: `${String(blockIndex + 1).padStart(2, '0')} · ${groupIndex ? '内容延续' : '主题内容'}`,
      title: groupIndex ? `${block.title}（续）` : block.title,
      body: joinSourceText(group),
      semanticBlockId: block.id,
      pageRole: groupIndex ? 'content-continued' : 'block-start',
      sourceSentenceIds: group.map(sentence => sentence.id),
    }))
  })
  return [cover, ...contentCards]
}

const themes: { id: ThemeId; name: string; desc: string; swatches: string[] }[] = [
  { id: 'research-light', name: 'Research Light', desc: '清晰 · 理性', swatches: ['#ffffff', '#2563eb', '#111827'] },
  { id: 'ai-dark', name: 'AI Dark', desc: '技术 · 高对比', swatches: ['#111827', '#8b5cf6', '#f8fafc'] },
  { id: 'warm-reflection', name: 'Warm Reflection', desc: '温暖 · 叙事', swatches: ['#fffaf0', '#c56a3d', '#3f342f'] },
  { id: 'structured-notes', name: 'Structured Notes', desc: '冷灰 · 墨绿', swatches: ['#f3f4f6', '#0f766e', '#1f2937'] },
]

const navItems: { id: Step; label: string; icon: typeof LayoutDashboard; number?: number }[] = [
  { id: 'projects', label: '项目工作台', icon: LayoutDashboard },
  { id: 'input', label: '内容输入', icon: FileText, number: 1 },
  { id: 'analysis', label: '结构化解析', icon: ListChecks, number: 2 },
  { id: 'editor', label: '内容编辑器', icon: PanelRight, number: 3 },
  { id: 'export', label: '导出与记录', icon: FileArchive, number: 4 },
]

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80) || '内容卡片'
}

async function renderCardPng(card: Card, theme: ThemeId, density: Density, page: number, total: number) {
  const host = document.createElement('div')
  host.className = 'export-render-host'
  const root = document.createElement('div')
  host.appendChild(root)
  document.body.appendChild(host)
  const { createRoot } = await import('react-dom/client')
  const reactRoot = createRoot(root)
  reactRoot.render(<CardPreview card={card} theme={theme} density={density} page={page} total={total}/>)
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  try {
    const node = root.querySelector('.card-preview') as HTMLElement | null
    if (!node) throw new Error('卡片渲染失败')
    const blob = await toBlob(node, {
      width: 410,
      height: 546.6667,
      canvasWidth: 1080,
      canvasHeight: 1440,
      pixelRatio: 1,
      cacheBust: true,
      backgroundColor: theme === 'ai-dark' ? '#111827' : theme === 'warm-reflection' ? '#fffaf0' : theme === 'structured-notes' ? '#f3f4f6' : '#ffffff',
      style: { width: '410px', height: '546.6667px', boxShadow: 'none' },
    })
    if (!blob) throw new Error('图片编码失败')
    return blob
  } finally {
    reactRoot.unmount()
    host.remove()
  }
}

async function buildImagePackage(project: ProjectState, cards: Card[], theme: ThemeId, density: Density, insights: Insight[], paragraphs: { id: string; text: string }[], sourceSentences: SourceSentence[]) {
  const zip = new JSZip()
  const generatedAt = new Date().toISOString()
  const characterCount = publicationCharacterCount({ title: project.title, body: project.summary, tags: project.tags })
  const exportedCardCount = project.outputMode === 'card' ? cards.length : 0
  const manifest = {
    projectName: project.name,
    mode: project.outputMode,
    generatedModes: project.generatedModes || [],
    analysisRequestedMode: project.analysisRequestedMode || null,
    generatedSourceKey: project.generatedSourceKey || null,
    title: project.title,
    characterCount,
    cardCount: exportedCardCount,
    template: theme,
    density,
    imageSize: project.outputMode === 'card' ? '1080x1440' : null,
    imageFormat: project.outputMode === 'card' ? 'png' : null,
    generatedAt,
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file('title.txt', project.title)
  zip.file('content.txt', project.summary)
  zip.file('tags.txt', project.tags)
  if (project.outputMode === 'summary') {
    zip.file('publish-ready.txt', publicationText({ title: project.title, body: project.summary, tags: project.tags }))
  }
  zip.file('source/original.txt', project.originalText)
  zip.file('source/structured-content.json', JSON.stringify({ contentBlocks: insights, sourceParagraphs: paragraphs, sourceSentences }, null, 2))
  if (project.outputMode === 'card') {
    for (let index = 0; index < cards.length; index += 1) {
      const png = await renderCardPng(cards[index], theme, density, index + 1, cards.length)
      zip.file(`cards/card-${String(index + 1).padStart(2, '0')}.png`, png)
    }
  }
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }), manifest }
}

function Home() {
  const analyzeCardsFn = useServerFn(analyzeSemanticCards)
  const [step, setStep] = useState<Step>('input')
  const [project, setProject] = useState<ProjectState>(initialProject)
  const [insights, setInsights] = useState<Insight[]>(initialInsights)
  const [sourceSentences, setSourceSentences] = useState<SourceSentence[]>(initialSourceSentences)
  const [analysisMode, setAnalysisMode] = useState<'model' | 'local-fallback'>('model')
  const [analysisDirty, setAnalysisDirty] = useState(false)
  const [cards, setCards] = useState<Card[]>(initialCards)
  const [theme, setTheme] = useState<ThemeId>('research-light')
  const [density, setDensity] = useState<Density>('standard')
  const [activeCard, setActiveCard] = useState(0)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('sample-project')
  const [storageReady, setStorageReady] = useState(false)
  const [workspaces, setWorkspaces] = useState<LocalWorkspace[]>([{
    id: 'sample-project', project: initialProject, insights: initialInsights, cards: initialCards,
    theme: 'research-light', density: 'standard', updatedAt: '刚刚',
    sourceSentences: initialSourceSentences, analysisMode: 'model',
  }])
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved')
  const [analysisState, setAnalysisState] = useState<'idle' | 'loading' | 'done' | 'error'>('done')
  const [toast, setToast] = useState('')
  const [evidenceId, setEvidenceId] = useState<string | null>(null)
  const [versions, setVersions] = useState<Version[]>([
    { id: 'v3', label: '调整卡片结构', entity: '卡片稿', at: '今天 15:42' },
    { id: 'v2', label: '确认核心观点', entity: '解析结果', at: '今天 15:18' },
    { id: 'v1', label: '首次生成', entity: '精华正文', at: '今天 14:56' },
  ])
  const [exports, setExports] = useState<ExportRecord[]>([
    { id: 'e1', fileName: 'AI-Agent-圆桌复盘-v2.zip', theme: 'structured-notes', chars: 486, cards: 6, at: '今天 16:04' },
    { id: 'e0', fileName: 'AI-Agent-圆桌复盘-v1.zip', theme: 'research-light', chars: 512, cards: 7, at: '昨天 21:32' },
  ])
  const [mobileNav, setMobileNav] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const paragraphs = useMemo(() => project.originalText.split(/\n\s*\n/).filter(Boolean).map((text, i) => ({ id: `P${String(i + 1).padStart(2, '0')}`, text })), [project.originalText])
  const charCount = [...project.originalText].length
  const publicationCount = publicationCharacterCount({ title: project.title, body: project.summary, tags: project.tags })
  const publicationOverLimit = publicationCount > SUMMARY_PUBLICATION_LIMIT
  const estimatedCards = Math.max(3, Math.min(12, Math.ceil(charCount / 230)))
  const summaryReady = hasCurrentGeneration(project, 'summary')
    && Boolean(project.summaryGeneration && project.summary.trim())
  const cardsReady = hasCurrentGeneration(project, 'card') && cards.length > 0

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('xhs-compiler-workspaces') || '[]') as LocalWorkspace[]
      if (Array.isArray(saved) && saved.length) {
        const normalized = saved.map(workspace => {
          const sentences = workspace.sourceSentences?.length ? workspace.sourceSentences : buildSourceSentences(workspace.project.originalText)
          const { editorMode: legacyEditorMode, ...workspaceWithoutLegacyMode } = workspace
          return {
            ...workspaceWithoutLegacyMode,
            project: {
              ...workspace.project,
              outputMode: normalizeOutputMode(workspace.project.outputMode, legacyEditorMode),
            },
            sourceSentences: sentences,
            insights: normalizeInsightSources(workspace.insights || [], sentences),
          }
        })
        const first = normalized[0]
        setWorkspaces(normalized)
        setActiveWorkspaceId(first.id)
        setProject(first.project)
        setInsights(first.insights || [])
        setSourceSentences(first.sourceSentences || [])
        setAnalysisMode(first.analysisMode || 'local-fallback')
        setCards(normalizeCards(first.cards))
        setTheme(first.theme || 'research-light')
        setDensity(first.density || 'standard')
        setAnalysisState(first.insights?.length ? 'done' : 'idle')
      } else if (Array.isArray(saved) && localStorage.getItem('xhs-compiler-workspaces')) {
        setWorkspaces([])
        setActiveWorkspaceId('')
        setProject(createEmptyProject())
        setInsights([])
        setSourceSentences([])
        setCards([])
        setAnalysisState('idle')
        setStep('projects')
      }
    } catch {
      localStorage.removeItem('xhs-compiler-workspaces')
    } finally {
      setStorageReady(true)
    }
  }, [])

  useEffect(() => {
    if (!storageReady || !activeWorkspaceId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveState('saving')
    saveTimer.current = setTimeout(async () => {
      const currentWorkspace: LocalWorkspace = { id: activeWorkspaceId, project, insights, sourceSentences, analysisMode, cards, theme, density, updatedAt: '刚刚' }
      setWorkspaces(list => {
        const next = list.some(item => item.id === activeWorkspaceId)
          ? list.map(item => item.id === activeWorkspaceId ? currentWorkspace : item)
          : [currentWorkspace, ...list]
        localStorage.setItem('xhs-compiler-workspaces', JSON.stringify(next))
        return next
      })
      setSaveState('saved')
    }, 700)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [project, insights, sourceSentences, analysisMode, cards, theme, density, activeWorkspaceId, storageReady])

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(''), 2600) }
  function updateProject<K extends keyof ProjectState>(key: K, value: ProjectState[K]) {
    const invalidatesGeneration = key === 'name' || key === 'eventName' || key === 'eventType' || key === 'originalText'
    setProject(current => {
      const next = { ...current, [key]: value }
      if (!invalidatesGeneration) return next
      return {
        ...next,
        generatedModes: [],
        generatedSourceKey: undefined,
        analysisRequestedMode: undefined,
        publicationTone: undefined,
        summaryGeneration: undefined,
        summaryWasRewritten: undefined,
      }
    })
    if (invalidatesGeneration) {
      setAnalysisState('idle')
      setAnalysisDirty(false)
    }
  }

  function createLocalProject() {
    const current: LocalWorkspace = { id: activeWorkspaceId, project, insights, sourceSentences, analysisMode, cards, theme, density, updatedAt: '刚刚' }
    const id = crypto.randomUUID()
    const nextNumber = workspaces.filter(item => item.project.name.startsWith('新内容项目')).length + 1
    const empty: LocalWorkspace = {
      id, project: createEmptyProject(`新内容项目 ${nextNumber}`), insights: [], cards: [], theme: 'research-light',
      density: 'standard', updatedAt: '刚刚创建', sourceSentences: [], analysisMode: 'local-fallback',
    }
    const preserved = activeWorkspaceId ? [current, ...workspaces.filter(item => item.id !== activeWorkspaceId)] : workspaces
    const next = [empty, ...preserved]
    setWorkspaces(next)
    localStorage.setItem('xhs-compiler-workspaces', JSON.stringify(next))
    setActiveWorkspaceId(id)
    setProject(empty.project)
    setInsights(empty.insights)
    setSourceSentences([])
    setAnalysisMode('local-fallback')
    setAnalysisDirty(false)
    setCards(empty.cards)
    setActiveCard(0)
    setTheme(empty.theme)
    setDensity(empty.density)
    setAnalysisState('idle')
    setEvidenceId(null)
    setStep('projects')
    setMobileNav(false)
    notify(`已创建“${empty.project.name}”，原项目内容保持不变`)
  }

  function openWorkspace(workspace: LocalWorkspace) {
    const current: LocalWorkspace = { id: activeWorkspaceId, project, insights, sourceSentences, analysisMode, cards, theme, density, updatedAt: '刚刚' }
    const nextSourceSentences = workspace.sourceSentences?.length ? workspace.sourceSentences : buildSourceSentences(workspace.project.originalText)
    setWorkspaces(list => list.map(item => item.id === activeWorkspaceId ? current : item))
    setActiveWorkspaceId(workspace.id)
    setProject({ ...workspace.project, outputMode: normalizeOutputMode(workspace.project.outputMode, workspace.editorMode) })
    setInsights(normalizeInsightSources(workspace.insights, nextSourceSentences))
    setSourceSentences(nextSourceSentences)
    setAnalysisMode(workspace.analysisMode || 'local-fallback')
    setAnalysisDirty(false)
    setCards(normalizeCards(workspace.cards))
    setTheme(workspace.theme)
    setDensity(workspace.density)
    setActiveCard(0)
    setAnalysisState(workspace.insights.length ? 'done' : 'idle')
    setEvidenceId(null)
    setStep('input')
    setMobileNav(false)
    notify(`已切换到${workspace.project.name ? `“${workspace.project.name}”` : '未命名项目'}`)
  }

  function deleteWorkspace(workspace: LocalWorkspace) {
    const name = workspace.project.name || '未命名项目'
    if (!window.confirm(`确定删除“${name}”吗？\n\n该项目在当前浏览器中的输入、解析结果和卡片数据都会被永久删除，且无法恢复。`)) return
    const remaining = workspaces.filter(item => item.id !== workspace.id)
    setWorkspaces(remaining)
    localStorage.setItem('xhs-compiler-workspaces', JSON.stringify(remaining))
    if (workspace.id === activeWorkspaceId) {
      const next = remaining[0]
      if (next) {
        const nextSourceSentences = next.sourceSentences?.length ? next.sourceSentences : buildSourceSentences(next.project.originalText)
        setActiveWorkspaceId(next.id)
        setProject({ ...next.project, outputMode: normalizeOutputMode(next.project.outputMode, next.editorMode) })
        setInsights(normalizeInsightSources(next.insights || [], nextSourceSentences))
        setSourceSentences(nextSourceSentences)
        setAnalysisMode(next.analysisMode || 'local-fallback')
        setCards(normalizeCards(next.cards))
        setTheme(next.theme || 'research-light')
        setDensity(next.density || 'standard')
        setAnalysisState(next.insights?.length ? 'done' : 'idle')
      } else {
        setActiveWorkspaceId('')
        setProject(createEmptyProject())
        setInsights([])
        setSourceSentences([])
        setCards([])
        setAnalysisState('idle')
      }
    }
    setActiveCard(0)
    setAnalysisDirty(false)
    setEvidenceId(null)
    setStep('projects')
    notify(`已删除“${name}”及其本地数据`)
  }

  async function runAnalysis(options: { stayInEditor?: boolean } = {}) {
    if (!project.originalText.trim()) return notify('请先输入活动内容')
    if (charCount > 10000) return notify('原文超过 10000 字符，请先精简')
    const requestedSourceKey = generationSourceKey(project)
    setAnalysisState('loading')
    if (!options.stayInEditor) setStep('analysis')
    try {
      const result = await analyzeCardsFn({ data: project }) as SemanticApiResponse
      if (!result.ok) throw new Error(result.error || '语义解析失败')
      const nextCards = normalizeCards(result.cards)
      const nextSourceSentences = result.sourceSentences?.length ? result.sourceSentences : buildSourceSentences(project.originalText)
      const returnedModes = (result.generatedModes || []).filter((mode): mode is GeneratedMode => mode === 'summary' || mode === 'card')
      const generatedModes = returnedModes.filter(mode => mode === 'summary'
        ? Boolean(result.summary?.trim() && result.summaryGeneration)
        : nextCards.length > 0)
      const blockInsights: Insight[] = (result.semanticBlocks || []).map((block, index) => ({
        id: block.id || `block-${index + 1}`,
        title: block.title || `语义块 ${index + 1}`,
        summary: block.summary || `包含 ${block.sourceSentenceIds.length} 个原文句子，预计 ${block.estimatedCardCount || 1} 张图片。`,
        sourceIds: resolveSourceIds(block.sourceSentenceIds, nextSourceSentences),
      }))
      setInsights(blockInsights)
      setSourceSentences(nextSourceSentences)
      setAnalysisMode(result.mode || 'local-fallback')
      setAnalysisDirty(false)
      setEvidenceId(blockInsights[0]?.id || null)
      setCards(nextCards)
      setProject(current => ({
        ...current,
        title: result.title || '',
        summary: result.summary || '',
        tags: result.tags || '',
        publicationTone: result.publicationTone,
        summaryGeneration: result.summaryGeneration,
        summaryWasRewritten: result.summaryWasRewritten,
        generatedModes,
        generatedSourceKey: generatedModes.length ? requestedSourceKey : undefined,
        analysisRequestedMode: result.analysisRequestedMode || project.outputMode,
      }))
      setActiveCard(0)
      setAnalysisState('done')
      if (options.stayInEditor) setStep('editor')
      notify(result.mode === 'model'
        ? `卡片与精华文案已同时生成 · ${result.publicationTone || '自然真诚'}`
        : `已同时生成卡片与保真兜底稿${result.warning ? `：${result.warning}` : ''}`)
    } catch (error) {
      setAnalysisState('error')
      if (options.stayInEditor) setStep('editor')
      notify(error instanceof Error ? error.message : '解析失败，请重试')
    }
  }

  function continueFromAnalysis() {
    const counts = new Map<string, number>()
    insights.forEach(block => block.sourceIds.forEach(id => counts.set(id, (counts.get(id) || 0) + 1)))
    const missing = sourceSentences.filter(sentence => !counts.has(sentence.id)).length
    const duplicates = [...counts.values()].filter(count => count > 1).length
    if (missing || duplicates) {
      notify(`请先处理分块完整性：${missing} 句遗漏，${duplicates} 句重复`)
      return
    }
    if (analysisDirty) {
      setCards(buildCardsFromBlocks(project, insights, sourceSentences, cards))
      notify('已按调整后的内容结构重新生成卡片')
    }
    setAnalysisDirty(false)
    setStep('editor')
  }

  function openExportReview() {
    if (project.outputMode === 'summary' && !summaryReady) {
      notify('请先生成当前原文对应的精华版文案')
      return
    }
    if (project.outputMode === 'card' && !cardsReady) {
      notify('请先生成当前原文对应的完整卡片')
      return
    }
    if (project.outputMode === 'summary' && publicationOverLimit) {
      notify(`精华版超出发布限制 ${publicationCount - SUMMARY_PUBLICATION_LIMIT} 字，请先精简`)
      return
    }
    setStep('export')
  }

  async function saveVersion(entity: 'analysis' | 'summary' | 'deck') {
    const snapshot = entity === 'analysis' ? insights : entity === 'summary' ? { title: project.title, summary: project.summary, tags: project.tags } : cards
    const item = { id: crypto.randomUUID(), label: `手动保存 · ${entity === 'analysis' ? '解析结果' : entity === 'summary' ? '精华正文' : '卡片稿'}`, entity, at: '刚刚', snapshot }
    setVersions(v => [item, ...v])
    notify('已保存内容版本到当前浏览器')
  }

  function restoreVersion(version: Version) {
    if (version.snapshot) {
      if (version.entity === 'analysis') setInsights(version.snapshot as Insight[])
      if (version.entity === 'summary') setProject(p => ({ ...p, ...(version.snapshot as Partial<ProjectState>) }))
      if (version.entity === 'deck') setCards(normalizeCards(version.snapshot))
    }
    setVersionOpen(false); notify(`已恢复：${version.label}`)
  }

  async function exportPackage() {
    if (exporting) return
    if (project.outputMode === 'summary' && !summaryReady) {
      notify('精华版尚未生成，请返回编辑器生成后再导出')
      return
    }
    if (project.outputMode === 'card' && !cardsReady) {
      notify('完整卡片版尚未生成，请重新解析后再导出')
      return
    }
    if (project.outputMode === 'summary' && publicationOverLimit) {
      notify(`精华版总字数必须控制在 ${SUMMARY_PUBLICATION_LIMIT} 字以内`)
      return
    }
    setExporting(true)
    notify(project.outputMode === 'summary' ? '正在整理可直接发布的精华文案…' : `正在生成 ${cards.length} 张高清图片…`)
    try {
      const { blob } = await buildImagePackage(project, cards, theme, density, insights, paragraphs, sourceSentences)
      const fileName = `${safeFileName(project.name)}-${Date.now()}.zip`
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fileName; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setExports(v => [{ id: crypto.randomUUID(), fileName, theme, chars: publicationCount, cards: project.outputMode === 'card' ? cards.length : 0, at: '刚刚' }, ...v])
      notify(project.outputMode === 'summary' ? '精华版发布文案包已下载' : 'PNG 图片发布包已下载')
    } catch (error) {
      notify(error instanceof Error ? error.message : '图片生成失败，请重试')
    } finally {
      setExporting(false)
    }
  }

  async function redownload(record: ExportRecord) {
    if (exporting) return
    if (project.outputMode === 'summary' && !summaryReady) {
      notify('当前原文尚未生成精华版，无法重新导出')
      return
    }
    if (project.outputMode === 'card' && !cardsReady) {
      notify('当前原文尚未生成完整卡片，无法重新导出')
      return
    }
    if (project.outputMode === 'summary' && publicationOverLimit) {
      notify(`精华版总字数必须控制在 ${SUMMARY_PUBLICATION_LIMIT} 字以内`)
      return
    }
    setExporting(true)
    notify(project.outputMode === 'summary' ? '正在重新整理发布文案…' : '正在重新生成高清图片…')
    try {
      const { blob } = await buildImagePackage(project, cards, record.theme || theme, density, insights, paragraphs, sourceSentences)
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = record.fileName.replace(/\.(json|zip)$/i, '.zip'); a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      notify(project.outputMode === 'summary' ? '已重新生成精华版文案包' : '已重新生成并下载 PNG 图片发布包')
    } catch (error) {
      notify(error instanceof Error ? error.message : '重新生成失败，请重试')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="brand"><div className="brand-mark">小</div><div><strong>内容编译器</strong><span>XHS COMPILER</span></div><button className="mobile-close" onClick={() => setMobileNav(false)}><X size={18}/></button></div>
        <button type="button" className="new-project" onClick={createLocalProject}><Plus size={16}/> 新建内容项目</button>
        <nav className="main-nav">
          <p>工作区</p>
          {navItems.map(item => <button key={item.id} className={step === item.id ? 'active' : ''} onClick={() => { item.id === 'export' ? openExportReview() : setStep(item.id); setMobileNav(false) }}><item.icon size={17}/>{item.number && <i>{item.number}</i>}<span>{item.label}</span>{item.id !== 'projects' && <Check size={13} className="nav-check"/>}</button>)}
        </nav>
        <div className="sidebar-projects"><p>最近项目</p>{workspaces.map((workspace, index) => <button type="button" key={workspace.id} className={`project-mini ${workspace.id === activeWorkspaceId ? 'active' : ''}`} onClick={() => openWorkspace(workspace)}><span className={`project-dot ${index % 2 ? 'amber' : 'blue'}`}/><div><b>{workspace.project.name || '未命名项目'}</b><small>{normalizeOutputMode(workspace.project.outputMode, workspace.editorMode) === 'card' ? '卡片版' : '精华版'} · {workspace.updatedAt}</small></div></button>)}</div>
        <div className="sidebar-bottom"><button><BookOpenCheck size={16}/><span>使用指南</span><em>实际功能待开发</em></button><button><Settings2 size={16}/><span>偏好设置</span><em>实际功能待开发</em></button></div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileNav(true)}><Menu size={19}/></button>
          <div className="crumb"><span>内容项目</span><ChevronRight size={14}/><b>{project.name || '未命名项目'}</b></div>
          <div className="top-actions">
            <span className={`save-indicator ${saveState}`}><span/>{saveState === 'saving' ? '保存中…' : '已自动保存'}</span>
            <button className="icon-button" aria-label="搜索"><Search size={17}/></button>
            <button className="version-button" onClick={() => setVersionOpen(true)}><History size={16}/> 版本 <span>{versions.length}</span></button>
            <span className="test-mode-badge">本地测试模式</span>
          </div>
        </header>

        {step === 'projects' && <ProjectsView workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} exports={exports} onOpen={openWorkspace} onDelete={deleteWorkspace} onCreate={createLocalProject}/>} 
        {step === 'input' && <InputView project={project} update={updateProject} charCount={charCount} estimatedCards={estimatedCards} onAnalyze={() => runAnalysis()} notify={notify}/>}
        {step === 'analysis' && <ContentBlockReview state={analysisState} blocks={insights} setBlocks={setInsights} sourceSentences={sourceSentences} selectedId={evidenceId} setSelectedId={setEvidenceId} analysisMode={analysisMode} onRetry={() => runAnalysis()} onContinue={continueFromAnalysis} onVersion={() => saveVersion('analysis')} onStructureChange={() => setAnalysisDirty(true)} notify={notify}/>}
        {step === 'editor' && <EditorView mode={project.outputMode} setMode={(mode: 'summary' | 'card') => updateProject('outputMode', mode)} project={project} update={updateProject} summaryReady={summaryReady} cardsReady={cardsReady} generationLoading={analysisState === 'loading'} onGenerateSummary={() => runAnalysis({ stayInEditor: true })} publicationCount={publicationCount} publicationOverLimit={publicationOverLimit} cards={cards} setCards={setCards} theme={theme} setTheme={setTheme} density={density} setDensity={setDensity} activeCard={activeCard} setActiveCard={setActiveCard} onVersion={() => saveVersion(project.outputMode === 'summary' ? 'summary' : 'deck')} onExport={openExportReview} notify={notify}/>}
        {step === 'export' && <ExportView project={project} theme={theme} cards={cards} publicationCount={publicationCount} publicationOverLimit={publicationOverLimit} exports={exports} onExport={exportPackage} onRedownload={redownload} exporting={exporting}/>}
      </main>

      {toast && <div className="toast"><CheckCircle2 size={17}/>{toast}</div>}
      {versionOpen && <VersionDrawer versions={versions} onRestore={restoreVersion} onClose={() => setVersionOpen(false)}/>} 
    </div>
  )
}

function SectionTitle({ kicker, title, description, actions }: { kicker: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="section-title"><div><span>{kicker}</span><h1>{title}</h1><p>{description}</p></div>{actions && <div className="section-actions">{actions}</div>}</div>
}

function ProjectsView({ workspaces, activeWorkspaceId, exports, onOpen, onDelete, onCreate }: any) {
  const incomplete = workspaces.filter((workspace: LocalWorkspace) => !workspace.project.originalText.trim()).length
  return <div className="page"><SectionTitle kicker="项目工作台" title="内容项目" description="每个项目拥有独立的输入、解析、卡片与导出空间，测试数据保存在当前浏览器。" actions={<button className="primary" onClick={onCreate}><Plus size={16}/> 新建内容项目</button>}/><div className="stats-row"><Stat label="内容项目" value={String(workspaces.length)} note="独立保存"/><Stat label="待完善" value={String(incomplete)} note="尚未输入原文" tone="warn"/><Stat label="已导出" value={String(exports.length)} note="最近 7 天"/></div><div className="panel"><div className="panel-head"><div><h2>全部项目</h2><p>点击项目进入其独立内容空间</p></div><span className="tag">当前共 {workspaces.length} 个</span></div><div className="project-table"><div className="table-head"><span>项目</span><span>模式</span><span>状态</span><span>更新时间</span><span>操作</span></div>{workspaces.length === 0 ? <div className="empty-projects"><FileText size={30}/><b>还没有内容项目</b><span>点击左侧“新建内容项目”开始创建</span></div> : workspaces.map((workspace: LocalWorkspace, index: number) => { const isEmpty = !workspace.project.originalText.trim(); const isActive = workspace.id === activeWorkspaceId; const outputMode = normalizeOutputMode(workspace.project.outputMode, workspace.editorMode); return <div key={workspace.id} className={`table-row ${isActive ? 'active' : ''}`}><button type="button" className="project-row-main" onClick={() => onOpen(workspace)}><div className="project-name"><div className={`file-icon ${index % 2 ? 'warm' : ''}`}><FileText size={18}/></div><span><b>{workspace.project.name || '未命名项目'} {isActive && <em>当前</em>}</b><small>{workspace.project.eventName || '等待填写活动信息'}</small></span></div><span className="tag">{outputMode === 'card' ? '完整卡片版' : '精华版'}</span><span className={`status ${isEmpty ? 'draft' : 'ready'}`}><i/>{isEmpty ? '待输入' : '编辑中'}</span><span>{workspace.updatedAt}</span></button><button type="button" className="delete-project" aria-label={`删除${workspace.project.name || '未命名项目'}`} title="删除项目" onClick={() => onDelete(workspace)}><Trash2 size={16}/></button></div> })}</div></div></div>
}

function Stat({ label, value, note, tone }: any) { return <div className="stat"><span>{label}</span><div><strong>{value}</strong><small className={tone}>{note}</small></div></div> }

function InputView({ project, update, charCount, estimatedCards, onAnalyze, notify }: any) {
  const [checkOpen, setCheckOpen] = useState(false)
  const [checkedAt, setCheckedAt] = useState('')
  const checkPanelRef = useRef<HTMLDivElement | null>(null)
  const over = charCount > 10000
  const paragraphs = project.originalText.split(/\n\s*\n/).filter(Boolean).length
  const checkItems = [
    { label: '项目名称', ok: !!project.name.trim(), message: project.name.trim() ? '已填写' : '请填写项目名称' },
    { label: '活动名称', ok: !!project.eventName.trim(), message: project.eventName.trim() ? '已填写' : '请填写活动名称' },
    { label: '原始长文', ok: !!project.originalText.trim() && !over, message: !project.originalText.trim() ? '请粘贴活动内容' : over ? `超出限制 ${charCount - 10000} 字符` : `${charCount.toLocaleString()} 字符，${paragraphs} 个自然段` },
  ]
  const requiredReady = checkItems[0].ok && checkItems[1].ok && checkItems[2].ok
  const allReady = checkItems.every(item => item.ok)

  useEffect(() => {
    if (!checkOpen) return
    const frame = window.requestAnimationFrame(() => checkPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
    return () => window.cancelAnimationFrame(frame)
  }, [checkOpen, checkedAt])

  function runInputCheck() {
    if (checkOpen) {
      setCheckOpen(false)
      return
    }
    setCheckedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    setCheckOpen(true)
    notify(allReady ? '输入检查通过，可以开始解析' : requiredReady ? '输入检查完成，还有建议项待补充' : '输入检查完成，发现需要处理的阻断项')
  }

  return <div className="page input-page"><SectionTitle kicker="步骤 01 / 04" title="输入活动内容" description="粘贴完整笔记；系统会先理解，再进行平台化编排。" actions={<><button type="button" className={`secondary ${checkOpen ? 'active-check' : ''}`} onClick={runInputCheck} aria-expanded={checkOpen} aria-controls="input-check-results"><Eye size={16}/> {checkOpen ? '收起检查' : '输入检查'}</button><button type="button" className="primary" onClick={onAnalyze}><Sparkles size={16}/> 开始结构化解析</button></>}/>{checkOpen && <div ref={checkPanelRef} id="input-check-results" className={`input-check-panel ${allReady ? 'passed' : 'attention'}`} role="status" aria-live="polite"><div className="input-check-summary">{allReady ? <CheckCircle2 size={20}/> : <CircleAlert size={20}/>}<div><b>{allReady ? '输入检查通过，可以开始解析' : requiredReady ? '基础输入有效，还有建议项待补充' : '发现阻断项，请先完成必填内容'}</b><span>本次检查仅验证输入完整性与字符限制，不会调用 AI。{checkedAt && ` · ${checkedAt} 完成`}</span></div><button type="button" className="icon-button" aria-label="关闭输入检查" onClick={() => setCheckOpen(false)}><X size={15}/></button></div><div className="input-check-list">{checkItems.map(item => <div className={item.ok ? 'ok' : 'issue'} key={item.label}>{item.ok ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}<span><b>{item.label}</b><small>{item.message}</small></span></div>)}</div></div>}<div className="input-grid"><div className="panel form-panel"><div className="panel-head compact"><div><h2>基础信息</h2><p>用于项目命名、卡片页眉与内容语境</p></div><span className="required-note">* 必填项</span></div><div className="form-grid"><label><span>项目名称 *</span><input value={project.name} onChange={e => update('name', e.target.value)}/></label><label><span>活动名称 *</span><input value={project.eventName} onChange={e => update('eventName', e.target.value)}/></label><label><span>活动类型 *</span><select value={project.eventType} onChange={e => update('eventType', e.target.value)}><option>Roundtable Discussion</option><option>Conference</option><option>Coffee Chat</option><option>Workshop</option><option>Community Share</option></select></label><label><span>输出模式 *</span><div className="segmented"><button type="button" className={project.outputMode === 'summary' ? 'active' : ''} onClick={() => update('outputMode', 'summary')}>精华版</button><button type="button" className={project.outputMode === 'card' ? 'active' : ''} onClick={() => update('outputMode', 'card')}>完整卡片版</button></div><small className={`mode-hint ${project.outputMode}`}>{project.outputMode === 'summary' ? charCount > SUMMARY_REWRITE_THRESHOLD ? `原文超过 ${SUMMARY_REWRITE_THRESHOLD} 字，将调用模型压缩并匹配个性化口吻` : '生成可直接发布的个性化文案，总字数不超过 1000 字' : '完整保留原文，按语义拆成可编辑图片卡片'}</small></label></div><div className="divider"/><div className="textarea-label"><div><b>原始长文 *</b><span>支持 Markdown，将保留标题、列表与引用结构</span></div><button className="text-button" onClick={() => update('originalText', '')}><Trash2 size={14}/> 清空</button></div><div className={`editor-textarea ${over ? 'error' : ''}`}><textarea value={project.originalText} onChange={e => update('originalText', e.target.value)} placeholder="粘贴你的活动笔记、复盘或心得…"/><div className="textarea-footer"><span><CheckCircle2 size={14}/> 已识别 {paragraphs} 个自然段</span><strong className={over ? 'over' : ''}>{charCount.toLocaleString()} / 10,000</strong></div></div></div><aside className="input-side"><div className="panel"><div className="panel-head compact"><div><h2>输入状态</h2><p>实时检查，不调用模型</p></div><span className="live-dot">实时</span></div><div className="metrics"><Metric label="当前字符" value={charCount.toLocaleString()} note={over ? '已超限' : '符合限制'} ok={!over}/><Metric label="预计卡片" value={`${estimatedCards} 张`} note="按标准密度估算"/><Metric label="预计解析" value="约 1 秒" note="测试功能已开放" /></div><div className="recognized"><b>可识别结构</b><div><span><Check/>活动背景</span><span><Check/>核心观点</span><span><Check/>真实案例</span><span><Check/>个人感悟</span><span><Check/>行动建议</span><span><Check/>开放问题</span></div></div></div></aside></div></div>
}

function Metric({ label, value, note, ok }: any) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small className={ok === false ? 'bad' : ''}>{ok === true && <CheckCircle2 size={12}/>} {note}</small></div> }

function EditorView({ mode, setMode, project, update, summaryReady, cardsReady, generationLoading, onGenerateSummary, publicationCount, publicationOverLimit, cards, setCards, theme, setTheme, density, setDensity, activeCard, setActiveCard, onVersion, onExport, notify }: any) {
  const safeCards = normalizeCards(cards)
  const current = normalizeCard(safeCards[activeCard], activeCard)
  const hasCards = cardsReady && safeCards.length > 0
  const contentReady = mode === 'summary' ? summaryReady : hasCards
  return (
    <div className="page editor-page">
      <SectionTitle
        kicker="步骤 03 / 04"
        title="编辑与实时预览"
        description="内容与视觉独立编辑；一次解析会同时准备精华文案与完整卡片。"
        actions={<>
          <button className="secondary" disabled={!contentReady} onClick={onVersion}><Save size={16}/> 保存版本</button>
          <button className="primary" disabled={!contentReady} onClick={onExport}>导出检查 <ChevronRight size={16}/></button>
        </>}
      />
      <div className="editor-tabs">
        <button className={mode === 'summary' ? 'active' : ''} onClick={() => setMode('summary')}><FileText size={16}/> 精华版</button>
        <button className={mode === 'card' ? 'active' : ''} onClick={() => setMode('card')}><PanelRight size={16}/> 完整卡片版 <span>{cardsReady ? safeCards.length : 0}</span></button>
      </div>
      {mode === 'summary'
        ? summaryReady
          ? <SummaryEditor project={project} update={update} publicationCount={publicationCount} publicationOverLimit={publicationOverLimit} notify={notify}/>
          : <GenerationEmptyState
              mode="summary"
              loading={generationLoading}
              onGenerate={onGenerateSummary}
            />
        : !hasCards
          ? <GenerationEmptyState
              mode="card"
              loading={generationLoading}
              onGenerate={onGenerateSummary}
            />
          : <div className="card-workbench">
              <section className="block-editor panel">
                <div className="panel-head compact"><div><h2>卡片内容</h2><p>第 {activeCard + 1} 页 · 一个页面表达一个主题</p></div><button className="icon-button"><MoreHorizontal size={17}/></button></div>
                <label><span>页面标识（仅编辑器显示）</span><input value={current.eyebrow} onChange={e => setCards((list: Card[]) => normalizeCards(list).map((x, i) => i === activeCard ? {...x, eyebrow: e.target.value} : x))}/></label>
                <label><span>AI 小标题</span><textarea className="title-input" value={current.title} onChange={e => setCards((list: Card[]) => normalizeCards(list).map((x, i) => i === activeCard ? {...x, title: e.target.value} : x))}/></label>
                <label><span>正文</span><textarea value={current.body} onChange={e => setCards((list: Card[]) => normalizeCards(list).map((x, i) => i === activeCard ? {...x, body: e.target.value} : x))}/></label>
                {current.bullets && <label><span>列表项</span><textarea value={current.bullets.join('\n')} onChange={e => setCards((list: Card[]) => normalizeCards(list).map((x, i) => i === activeCard ? {...x, bullets: e.target.value.split('\n')} : x))}/></label>}
                <div className="block-actions"><button><Plus size={14}/> 添加 Block</button><button className="danger"><Trash2 size={14}/> 删除本页</button></div>
              </section>
              <section className="preview-stage">
                <div className="preview-toolbar"><div className="density-control"><span>密度</span>{(['relaxed','standard','compact'] as Density[]).map(d => <button className={density === d ? 'active' : ''} key={d} onClick={() => setDensity(d)}>{d === 'relaxed' ? '舒展' : d === 'standard' ? '标准' : '紧凑'}</button>)}</div><span className="preview-size">1080 × 1440 · 3:4</span></div>
                <CardPreview card={current} theme={theme} density={density} page={activeCard + 1} total={safeCards.length}/>
                <div className="page-nav"><button disabled={activeCard === 0} onClick={() => setActiveCard((n: number) => n - 1)}><ChevronLeft size={17}/></button><div>{safeCards.map((_: Card, i: number) => <button key={i} className={i === activeCard ? 'active' : ''} onClick={() => setActiveCard(i)}>{i + 1}</button>)}</div><button disabled={activeCard === safeCards.length - 1} onClick={() => setActiveCard((n: number) => n + 1)}><ChevronRight size={17}/></button></div>
              </section>
              <aside className="theme-panel panel">
                <div className="panel-head compact"><div><h2><Palette size={17}/> 模板</h2><p>全套卡片统一应用</p></div></div>
                <div className="theme-list">{themes.map(t => <button key={t.id} className={theme === t.id ? 'active' : ''} onClick={() => setTheme(t.id)}><div className="swatches">{t.swatches.map(c => <i key={c} style={{background:c}}/>)}</div><span><b>{t.name}</b><small>{t.desc}</small></span>{theme === t.id && <CheckCircle2 size={16}/>}</button>)}</div>
                <div className="layout-check"><b>分页校验</b><span><CheckCircle2/>无文字溢出</span><span><CheckCircle2/>标题未孤立</span><span><CheckCircle2/>末页平衡良好</span><span><CheckCircle2/>页码连续</span></div>
              </aside>
            </div>}
    </div>
  )
}

function GenerationEmptyState({ mode, loading, onGenerate }: { mode: GeneratedMode; loading: boolean; onGenerate: () => void }) {
  const summaryMode = mode === 'summary'
  return (
    <div className="panel generation-empty" role="status" aria-live="polite">
      <div className="generation-empty-icon">{loading ? <LoaderCircle className="spin" size={25}/> : summaryMode ? <FileText size={25}/> : <PanelRight size={25}/>}</div>
      <span className="generation-empty-kicker">{summaryMode ? '精华版尚未生成' : '完整卡片尚未生成'}</span>
      <h2>{summaryMode ? '生成一份可直接发布的精华文案' : '重新解析当前原文并生成卡片'}</h2>
      <p>{summaryMode
        ? '当前没有与这份原文匹配的精华内容。系统不会使用完整原文代替，生成后会同时更新卡片结果。'
        : '现有卡片与当前原文不匹配。重新生成后，精华文案也会同步更新。'}</p>
      <button type="button" className="primary" disabled={loading} onClick={onGenerate}>
        {loading ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>}
        {loading ? '正在同时生成两种内容…' : summaryMode ? '生成精华版' : '重新生成两种内容'}
      </button>
      <small>事实严格来自原文 · 一次调用同时生成精华版与完整卡片版</small>
    </div>
  )
}

function CardPreview({ card, theme, density, page, total }: any) {
  const safeCard = normalizeCard(card, Math.max(0, page - 1))
  return <div className={`card-preview ${theme} ${density}`}><div className="card-accent"/><div className="card-head"><i>{String(page).padStart(2,'0')}</i></div><div className="card-body"><h2>{safeCard.title.split('\n').map((line: string, i: number) => <span key={i}>{line}</span>)}</h2>{safeCard.addedLead && <p className="added-text">{safeCard.addedLead}</p>}<p className="original-text">{safeCard.body}</p>{safeCard.bullets && <ul>{safeCard.bullets.map((b: string, i: number) => <li key={i}><i>{i + 1}</i><span>{b}</span></li>)}</ul>}{safeCard.addedEnding && <p className="added-text ending">{safeCard.addedEnding}</p>}</div><div className="card-foot"><span>原文保真 · 系统仅加标题/导语</span><b>{page} / {total}</b></div></div>
}

function ExportView({ project, theme, cards, publicationCount, publicationOverLimit, exports, onExport, onRedownload, exporting }: any) {
  const summaryMode = project.outputMode === 'summary'
  const disabled = exporting || (summaryMode && publicationOverLimit)
  const actionLabel = summaryMode ? '导出发布文案包' : '导出 PNG 图片包'
  return <div className="page">
    <SectionTitle kicker="步骤 04 / 04" title="导出与记录" description={summaryMode ? '导出可直接粘贴到小红书发布页的标题、正文和标签。' : '将全部卡片生成 1080 × 1440 PNG 图片并打包下载。'} actions={<button className="primary" disabled={disabled} onClick={onExport}>{exporting ? <LoaderCircle className="spin" size={16}/> : <Download size={16}/>} {exporting ? '正在生成…' : actionLabel}</button>}/>
    {summaryMode && publicationOverLimit && <div className="export-limit-warning"><CircleAlert size={17}/><span><b>精华版暂时无法导出</b><small>当前共 {publicationCount} 字，超出发布限制 {publicationCount - SUMMARY_PUBLICATION_LIMIT} 字，请返回编辑器精简。</small></span></div>}
    <div className="export-layout">
      <div className="export-main">
        <div className="panel package-files">
          <div className="panel-head"><div><h2>发布包内容</h2><p>生成后直接下载到当前设备</p></div><span>{summaryMode ? 6 : cards.length + 5} 个文件</span></div>
          <div className="file-grid">
            <FileItem name="manifest.json" meta="资源清单与生成信息"/>
            <FileItem name="title.txt" meta={`${[...project.title].length} 字符`}/>
            <FileItem name="content.txt" meta={`${[...project.summary].length} 字符`}/>
            <FileItem name="tags.txt" meta={`${[...project.tags].length} 字符`}/>
            {summaryMode ? <FileItem name="publish-ready.txt" meta={`合并成稿 · ${publicationCount} / ${SUMMARY_PUBLICATION_LIMIT} 字`}/> : <FileItem name="cards/*.png" meta={`${cards.length} 张 · 1080 × 1440`}/>}
            <FileItem name="source/" meta="原文与结构化数据"/>
          </div>
        </div>
        <div className="panel export-history">
          <div className="panel-head"><div><h2>导出记录</h2><p>历史发布包与生成配置</p></div><button className="ghost"><RefreshCw size={14}/> 刷新</button></div>
          <div className="history-list">{exports.map((record: ExportRecord) => <div key={record.id}><div className="archive-icon"><FileArchive size={18}/></div><span><b>{record.fileName}</b><small>{record.at} · {record.cards ? `${themes.find(t => t.id === record.theme)?.name} · ${record.cards} 张卡片` : '精华版文案'} · {record.chars} 字符</small></span><span className="status ready"><i/>成功</span><button className="secondary small" onClick={() => onRedownload(record)}><Download size={14}/> 再次下载</button></div>)}</div>
        </div>
      </div>
      <aside className="export-side">
        <div className="panel export-summary">
          <h2>导出摘要</h2>
          <div className="export-cover"><span>{summaryMode ? '精华版 · 可直接发布' : '完整卡片版'}</span><b>{project.title}</b><small>{summaryMode ? project.publicationTone || '自然真诚' : project.eventName}</small></div>
          <dl>
            <div><dt>输出模式</dt><dd>{summaryMode ? '精华版' : '完整卡片版'}</dd></div>
            {summaryMode ? <div><dt>发布总字数</dt><dd className={publicationOverLimit ? 'over' : ''}>{publicationCount} / {SUMMARY_PUBLICATION_LIMIT}</dd></div> : <><div><dt>模板</dt><dd>{themes.find(t => t.id === theme)?.name}</dd></div><div><dt>卡片数量</dt><dd>{cards.length} 张</dd></div><div><dt>图片规格</dt><dd>1080 × 1440</dd></div></>}
          </dl>
          <div className="final-checks"><b>导出校验</b>{summaryMode ? <><span className={publicationOverLimit ? 'pending' : ''}>{publicationOverLimit ? <CircleAlert/> : <CheckCircle2/>}总字数{publicationOverLimit ? '超出 1000 字' : '符合发布限制'}</span><span><CheckCircle2/>标题、正文和标签已合并</span><span><CheckCircle2/>已生成可直接复制的文本文件</span></> : <><span><CheckCircle2/>卡片数量已确认</span><span><CheckCircle2/>图片资源已就绪</span><span><CheckCircle2/>页码连续</span></>}</div>
          <button className="primary wide" disabled={disabled} onClick={onExport}>{exporting ? <LoaderCircle className="spin" size={17}/> : <FileArchive size={17}/>} {exporting ? '正在生成…' : actionLabel}</button>
        </div>
      </aside>
    </div>
  </div>
}

function FileItem({ name, meta }: any) { return <div><div className="file-type"><FileText size={17}/></div><span><b>{name}</b><small>{meta}</small></span><CheckCircle2 size={15}/></div> }

function VersionDrawer({ versions, onRestore, onClose }: any) {
  return <><div className="drawer-backdrop" onClick={onClose}/><aside className="version-drawer"><div className="drawer-head"><div><h2><History size={18}/> 内容版本</h2><p>恢复不会删除其他历史记录</p></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div><div className="version-timeline">{versions.map((v: Version, i: number) => <div key={v.id}><i className={i === 0 ? 'latest' : ''}/><span><small>{v.at}</small><b>{v.label}</b><em>{v.entity}</em></span><button onClick={() => onRestore(v)}><ArchiveRestore size={14}/> 恢复</button></div>)}</div></aside></>
}
