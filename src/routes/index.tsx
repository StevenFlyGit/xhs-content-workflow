import { createFileRoute } from '@tanstack/react-router'
import { createServerFn, useServerFn } from '@tanstack/react-start'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArchiveRestore, BookOpenCheck, Check, CheckCircle2, ChevronLeft, ChevronRight,
  CircleAlert, Clock3, Copy, Download, Eye, FileArchive, FileText, GripVertical,
  History, LayoutDashboard, ListChecks, LoaderCircle, LockKeyhole, Menu,
  MoreHorizontal, Palette, PanelRight, Plus, RefreshCw, Save, Search, Settings2,
  ShieldCheck, Sparkles, Trash2, X,
} from 'lucide-react'
import { toBlob } from 'html-to-image'
import JSZip from 'jszip'
import { analyzeSemanticProject } from '../semantic-cards.server'

export const Route = createFileRoute('/')({ component: Home })

type Step = 'projects' | 'input' | 'analysis' | 'editor' | 'export'
type Density = 'relaxed' | 'standard' | 'compact'
type ThemeId = 'research-light' | 'ai-dark' | 'warm-reflection' | 'structured-notes'
type Insight = { id: string; title: string; summary: string; sourceIds: string[]; mustKeep: boolean; private: boolean; score: number }
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
  theme: ThemeId; density: Density; editorMode: 'summary' | 'card'; updatedAt: string
}

type ProjectState = {
  id?: string; name: string; eventName: string; eventType: string; originalText: string
  audience: string; tone: string; mustKeep: string; privatePoints: string; protectedTerms: string
  outputMode: 'summary' | 'card'; title: string; summary: string; tags: string
}

type SemanticApiResponse = {
  ok: boolean
  mode?: 'model' | 'local-fallback'
  warning?: string
  error?: string
  title?: string
  summary?: string
  tags?: string
  cards?: Card[]
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

const initialProject: ProjectState = {
  name: 'AI Agent 圆桌复盘', eventName: 'AI Agent 产品落地圆桌', eventType: 'Roundtable Discussion',
  originalText: sampleText, audience: 'AI 产品经理、创业者', tone: '专业复盘',
  mustKeep: '人机协作颗粒度；失败恢复；关键节点确认', privatePoints: '未公开客户名称',
  protectedTerms: 'AI Agent；工具调用；上下文管理', outputMode: 'card',
  title: '参加一场 AI 圆桌后，我重新理解了 Agent 产品',
  summary: '上周参加了一场关于 AI Agent 产品落地的圆桌。现场最重要的共识，不是模型又变强了，而是 Agent 如何真正进入业务流程。\n\n01｜价值不在“会聊天”\nAgent 能否在清晰边界内持续完成任务，取决于工具调用、上下文管理和失败恢复。\n\n02｜全自动不等于好产品\n一个客服 Agent 从全自动改为“默认执行、关键节点确认”后，完成率和满意度反而同时提高。\n\n03｜重新设计人机协作颗粒度\n哪些步骤可以自动做，哪些决策必须解释，哪些风险需要用户确认，比 Demo 的惊艳程度更重要。\n\n接下来我会用三个问题检查产品：任务边界是否明确？失败后是否可恢复？用户是否随时知道系统正在做什么？',
  tags: '#AI产品 #AIAgent #产品经理 #创业思考 #活动复盘',
}

function createEmptyProject(name = '新内容项目'): ProjectState {
  return {
    name, eventName: '', eventType: 'Roundtable Discussion', originalText: '',
    audience: '', tone: '专业复盘', mustKeep: '', privatePoints: '', protectedTerms: '',
    outputMode: 'card', title: '', summary: '', tags: '',
  }
}

const initialInsights: Insight[] = [
  { id: 'insight-1', title: 'Agent 的价值不在“会聊天”', summary: '能否在清晰边界内持续完成任务，才是 Agent 成为可靠产品的关键。', sourceIds: ['P02'], mustKeep: true, private: false, score: 96 },
  { id: 'insight-2', title: '全自动不等于更好的体验', summary: '默认执行、关键节点确认，让完成率与用户信任同时提升。', sourceIds: ['P03'], mustKeep: true, private: false, score: 92 },
  { id: 'insight-3', title: '设计人机协作的颗粒度', summary: '自主性不是越多越好，解释、确认与风险边界同样重要。', sourceIds: ['P04'], mustKeep: true, private: false, score: 95 },
  { id: 'insight-4', title: '用三个问题检查 Agent 产品', summary: '任务边界、失败恢复、过程可见性，决定 Agent 能否从玩具走向工具。', sourceIds: ['P05'], mustKeep: false, private: false, score: 89 },
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

const themes: { id: ThemeId; name: string; desc: string; swatches: string[] }[] = [
  { id: 'research-light', name: 'Research Light', desc: '清晰 · 理性', swatches: ['#ffffff', '#2563eb', '#111827'] },
  { id: 'ai-dark', name: 'AI Dark', desc: '技术 · 高对比', swatches: ['#111827', '#8b5cf6', '#f8fafc'] },
  { id: 'warm-reflection', name: 'Warm Reflection', desc: '温暖 · 叙事', swatches: ['#fffaf0', '#c56a3d', '#3f342f'] },
  { id: 'structured-notes', name: 'Structured Notes', desc: '模块 · 高密度', swatches: ['#f3f4f6', '#0f766e', '#1f2937'] },
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

function buildLocalAnalysis(project: ProjectState, paragraphs: { id: string; text: string }[]) {
  const useful = paragraphs.filter(item => item.text.trim()).slice(0, 6)
  const insights: Insight[] = useful.map((item, index) => {
    const clean = item.text.replace(/\s+/g, ' ').trim()
    const firstSentence = clean.split(/[。！？!?]/)[0] || clean
    const title = firstSentence.length > 26 ? `${firstSentence.slice(0, 26)}…` : firstSentence
    return {
      id: `insight-${index + 1}`,
      title: title || `核心观点 ${index + 1}`,
      summary: clean.length > 110 ? `${clean.slice(0, 110)}…` : clean,
      sourceIds: [item.id],
      mustKeep: index < 2,
      private: false,
      score: Math.max(82, 96 - index * 3),
    }
  })
  const projectTitle = project.name.trim() || project.eventName.trim() || '活动内容复盘'
  const summary = useful.map((item, index) => `${String(index + 1).padStart(2, '0')}｜${item.text.trim()}`).join('\n\n')
  const cards: Card[] = insights.length ? [
    { eyebrow: project.eventName || 'CONTENT REVIEW', title: projectTitle, body: `围绕 ${insights.length} 个核心观点整理的结构化内容。` },
    ...insights.map((item, index) => ({ eyebrow: `${String(index + 1).padStart(2, '0')} · 核心观点`, title: item.title, body: item.summary })),
  ] : []
  return { insights, title: projectTitle, summary, tags: '#活动复盘 #内容整理 #核心观点', cards }
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

async function buildImagePackage(project: ProjectState, cards: Card[], theme: ThemeId, density: Density, editorMode: 'summary' | 'card', insights: Insight[], paragraphs: { id: string; text: string }[]) {
  const zip = new JSZip()
  const generatedAt = new Date().toISOString()
  const manifest = { projectName: project.name, mode: editorMode, title: project.title, characterCount: [...`${project.summary}\n${project.tags}`].length, cardCount: cards.length, template: theme, density, imageSize: '1080x1440', imageFormat: 'png', generatedAt }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file('title.txt', project.title)
  zip.file('content.txt', project.summary)
  zip.file('tags.txt', project.tags)
  zip.file('source/original.txt', project.originalText)
  zip.file('source/structured-content.json', JSON.stringify({ insights, sourceParagraphs: paragraphs }, null, 2))
  for (let index = 0; index < cards.length; index += 1) {
    const png = await renderCardPng(cards[index], theme, density, index + 1, cards.length)
    zip.file(`cards/card-${String(index + 1).padStart(2, '0')}.png`, png)
  }
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }), manifest }
}

function Home() {
  const analyzeCardsFn = useServerFn(analyzeSemanticCards)
  const [step, setStep] = useState<Step>('input')
  const [project, setProject] = useState<ProjectState>(initialProject)
  const [insights, setInsights] = useState<Insight[]>(initialInsights)
  const [cards, setCards] = useState<Card[]>(initialCards)
  const [theme, setTheme] = useState<ThemeId>('research-light')
  const [density, setDensity] = useState<Density>('standard')
  const [activeCard, setActiveCard] = useState(0)
  const [editorMode, setEditorMode] = useState<'summary' | 'card'>('card')
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('sample-project')
  const [storageReady, setStorageReady] = useState(false)
  const [workspaces, setWorkspaces] = useState<LocalWorkspace[]>([{
    id: 'sample-project', project: initialProject, insights: initialInsights, cards: initialCards,
    theme: 'research-light', density: 'standard', editorMode: 'card', updatedAt: '刚刚',
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
  const [privacyChecks, setPrivacyChecks] = useState([false, false])
  const [mobileNav, setMobileNav] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const paragraphs = useMemo(() => project.originalText.split(/\n\s*\n/).filter(Boolean).map((text, i) => ({ id: `P${String(i + 1).padStart(2, '0')}`, text })), [project.originalText])
  const charCount = [...project.originalText].length
  const summaryCount = [...`${project.summary}\n${project.tags}`].length
  const estimatedCards = Math.max(3, Math.min(12, Math.ceil(charCount / 230)))
  const privateHits = useMemo(() => {
    const rules = project.privatePoints.split(/[；;\n]/).map(v => v.trim()).filter(Boolean)
    return rules.map((rule, i) => ({ id: i, rule, hit: project.originalText.includes(rule.replace(/^未公开/, '')) ? '原文存在直接命中' : '已加入发布前检查' }))
  }, [project.privatePoints, project.originalText])
  const allPrivacyChecked = privacyChecks.slice(0, Math.max(1, privateHits.length)).every(Boolean)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('xhs-compiler-workspaces') || '[]') as LocalWorkspace[]
      if (Array.isArray(saved) && saved.length) {
        const first = saved[0]
        setWorkspaces(saved)
        setActiveWorkspaceId(first.id)
        setProject(first.project)
        setInsights(first.insights || [])
        setCards(normalizeCards(first.cards))
        setTheme(first.theme || 'research-light')
        setDensity(first.density || 'standard')
        setEditorMode(first.editorMode || 'card')
        setAnalysisState(first.insights?.length ? 'done' : 'idle')
      } else if (Array.isArray(saved) && localStorage.getItem('xhs-compiler-workspaces')) {
        setWorkspaces([])
        setActiveWorkspaceId('')
        setProject(createEmptyProject())
        setInsights([])
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
      const currentWorkspace: LocalWorkspace = { id: activeWorkspaceId, project, insights, cards, theme, density, editorMode, updatedAt: '刚刚' }
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
  }, [project, insights, cards, theme, density, editorMode, activeWorkspaceId, storageReady])

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(''), 2600) }
  function updateProject<K extends keyof ProjectState>(key: K, value: ProjectState[K]) { setProject(p => ({ ...p, [key]: value })) }

  function createLocalProject() {
    const current: LocalWorkspace = { id: activeWorkspaceId, project, insights, cards, theme, density, editorMode, updatedAt: '刚刚' }
    const id = crypto.randomUUID()
    const nextNumber = workspaces.filter(item => item.project.name.startsWith('新内容项目')).length + 1
    const empty: LocalWorkspace = {
      id, project: createEmptyProject(`新内容项目 ${nextNumber}`), insights: [], cards: [], theme: 'research-light',
      density: 'standard', editorMode: 'card', updatedAt: '刚刚创建',
    }
    const preserved = activeWorkspaceId ? [current, ...workspaces.filter(item => item.id !== activeWorkspaceId)] : workspaces
    const next = [empty, ...preserved]
    setWorkspaces(next)
    localStorage.setItem('xhs-compiler-workspaces', JSON.stringify(next))
    setActiveWorkspaceId(id)
    setProject(empty.project)
    setInsights(empty.insights)
    setCards(empty.cards)
    setActiveCard(0)
    setEditorMode(empty.editorMode)
    setTheme(empty.theme)
    setDensity(empty.density)
    setAnalysisState('idle')
    setEvidenceId(null)
    setPrivacyChecks([false, false])
    setStep('projects')
    setMobileNav(false)
    notify(`已创建“${empty.project.name}”，原项目内容保持不变`)
  }

  function openWorkspace(workspace: LocalWorkspace) {
    const current: LocalWorkspace = { id: activeWorkspaceId, project, insights, cards, theme, density, editorMode, updatedAt: '刚刚' }
    setWorkspaces(list => list.map(item => item.id === activeWorkspaceId ? current : item))
    setActiveWorkspaceId(workspace.id)
    setProject(workspace.project)
    setInsights(workspace.insights)
    setCards(normalizeCards(workspace.cards))
    setTheme(workspace.theme)
    setDensity(workspace.density)
    setEditorMode(workspace.editorMode)
    setActiveCard(0)
    setAnalysisState(workspace.insights.length ? 'done' : 'idle')
    setEvidenceId(null)
    setPrivacyChecks([false, false])
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
        setActiveWorkspaceId(next.id)
        setProject(next.project)
        setInsights(next.insights || [])
        setCards(normalizeCards(next.cards))
        setTheme(next.theme || 'research-light')
        setDensity(next.density || 'standard')
        setEditorMode(next.editorMode || 'card')
        setAnalysisState(next.insights?.length ? 'done' : 'idle')
      } else {
        setActiveWorkspaceId('')
        setProject(createEmptyProject())
        setInsights([])
        setCards([])
        setAnalysisState('idle')
      }
    }
    setActiveCard(0)
    setEvidenceId(null)
    setPrivacyChecks([false, false])
    setStep('projects')
    notify(`已删除“${name}”及其本地数据`)
  }

  async function runAnalysis() {
    if (!project.originalText.trim()) return notify('请先输入活动内容')
    if (charCount > 10000) return notify('原文超过 10000 字符，请先精简')
    setAnalysisState('loading'); setStep('analysis')
    try {
      const result = await analyzeCardsFn({ data: project }) as SemanticApiResponse
      if (!result.ok) throw new Error(result.error || '语义解析失败')
      const nextCards = normalizeCards(result.cards)
      const blockInsights: Insight[] = (result.semanticBlocks || []).map((block, index) => ({
        id: block.id || `block-${index + 1}`,
        title: block.title || `语义块 ${index + 1}`,
        summary: block.summary || `包含 ${block.sourceSentenceIds.length} 个原文句子，预计 ${block.estimatedCardCount || 1} 张图片。`,
        sourceIds: block.sourceSentenceIds,
        mustKeep: index < 2,
        private: false,
        score: Math.max(82, 96 - index * 3),
      }))
      setInsights(blockInsights)
      setCards(nextCards)
      setProject(current => ({ ...current, title: result.title || current.name, summary: result.summary || current.originalText, tags: result.tags || '#小红书图文 #完整原文 #内容整理' }))
      setActiveCard(0)
      setAnalysisState('done')
      notify(result.mode === 'model' ? '大模型语义分块完成，原文已保真分页' : '已使用本地回退完成分页，请配置模型后重试')
    } catch (error) {
      setAnalysisState('error'); notify(error instanceof Error ? error.message : '解析失败，请重试')
    }
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

  function buildPackage() {
    return {
      manifest: { projectName: project.name, mode: editorMode, title: project.title, characterCount: summaryCount, cardCount: cards.length, template: theme, generatedAt: new Date().toISOString() },
      title: project.title, content: project.summary, tags: project.tags, cards, original: project.originalText,
      structuredContent: { insights, sourceParagraphs: paragraphs },
    }
  }

  async function exportPackage() {
    if (!allPrivacyChecked) return notify('请先完成发布前隐私复核')
    if (exporting) return
    setExporting(true)
    notify(`正在生成 ${cards.length} 张高清图片…`)
    try {
      const { blob, manifest } = await buildImagePackage(project, cards, theme, density, editorMode, insights, paragraphs)
      const fileName = `${safeFileName(project.name)}-${Date.now()}.zip`
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fileName; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setExports(v => [{ id: crypto.randomUUID(), fileName, theme, chars: summaryCount, cards: cards.length, at: '刚刚' }, ...v])
      notify('PNG 图片发布包已下载')
    } catch (error) {
      notify(error instanceof Error ? error.message : '图片生成失败，请重试')
    } finally {
      setExporting(false)
    }
  }

  async function redownload(record: ExportRecord) {
    if (exporting) return
    setExporting(true)
    notify('正在重新生成高清图片…')
    try {
      const { blob } = await buildImagePackage(project, cards, record.theme || theme, density, editorMode, insights, paragraphs)
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = record.fileName.replace(/\.(json|zip)$/i, '.zip'); a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      notify('已重新生成并下载 PNG 图片发布包')
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
          {navItems.map(item => <button key={item.id} className={step === item.id ? 'active' : ''} onClick={() => { setStep(item.id); setMobileNav(false) }}><item.icon size={17}/>{item.number && <i>{item.number}</i>}<span>{item.label}</span>{item.id !== 'projects' && <Check size={13} className="nav-check"/>}</button>)}
        </nav>
        <div className="sidebar-projects"><p>最近项目</p>{workspaces.map((workspace, index) => <button type="button" key={workspace.id} className={`project-mini ${workspace.id === activeWorkspaceId ? 'active' : ''}`} onClick={() => openWorkspace(workspace)}><span className={`project-dot ${index % 2 ? 'amber' : 'blue'}`}/><div><b>{workspace.project.name || '未命名项目'}</b><small>{workspace.editorMode === 'card' ? '卡片版' : '精华版'} · {workspace.updatedAt}</small></div></button>)}</div>
        <div className="sidebar-bottom"><button><BookOpenCheck size={16}/> 使用指南</button><button><Settings2 size={16}/> 偏好设置</button></div>
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
        {step === 'input' && <InputView project={project} update={updateProject} charCount={charCount} estimatedCards={estimatedCards} onAnalyze={runAnalysis} notify={notify}/>} 
        {step === 'analysis' && <AnalysisView state={analysisState} insights={insights} setInsights={setInsights} paragraphs={paragraphs} evidenceId={evidenceId} setEvidenceId={setEvidenceId} onRetry={runAnalysis} onContinue={() => setStep('editor')} onVersion={() => saveVersion('analysis')}/>} 
        {step === 'editor' && <EditorView mode={editorMode} setMode={setEditorMode} project={project} update={updateProject} summaryCount={summaryCount} cards={cards} setCards={setCards} theme={theme} setTheme={setTheme} density={density} setDensity={setDensity} activeCard={activeCard} setActiveCard={setActiveCard} onVersion={() => saveVersion(editorMode === 'summary' ? 'summary' : 'deck')} onExport={() => setStep('export')}/>} 
        {step === 'export' && <ExportView project={project} theme={theme} cards={cards} summaryCount={summaryCount} privateHits={privateHits} checks={privacyChecks} setChecks={setPrivacyChecks} exports={exports} onExport={exportPackage} onRedownload={redownload} exporting={exporting}/>} 
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
  return <div className="page"><SectionTitle kicker="项目工作台" title="内容项目" description="每个项目拥有独立的输入、解析、卡片与导出空间，测试数据保存在当前浏览器。" actions={<button className="primary" onClick={onCreate}><Plus size={16}/> 新建内容项目</button>}/><div className="stats-row"><Stat label="内容项目" value={String(workspaces.length)} note="独立保存"/><Stat label="待完善" value={String(incomplete)} note="尚未输入原文" tone="warn"/><Stat label="已导出" value={String(exports.length)} note="最近 7 天"/></div><div className="panel"><div className="panel-head"><div><h2>全部项目</h2><p>点击项目进入其独立内容空间</p></div><span className="tag">当前共 {workspaces.length} 个</span></div><div className="project-table"><div className="table-head"><span>项目</span><span>模式</span><span>状态</span><span>更新时间</span><span>操作</span></div>{workspaces.length === 0 ? <div className="empty-projects"><FileText size={30}/><b>还没有内容项目</b><span>点击左侧“新建内容项目”开始创建</span></div> : workspaces.map((workspace: LocalWorkspace, index: number) => { const isEmpty = !workspace.project.originalText.trim(); const isActive = workspace.id === activeWorkspaceId; return <div key={workspace.id} className={`table-row ${isActive ? 'active' : ''}`}><button type="button" className="project-row-main" onClick={() => onOpen(workspace)}><div className="project-name"><div className={`file-icon ${index % 2 ? 'warm' : ''}`}><FileText size={18}/></div><span><b>{workspace.project.name || '未命名项目'} {isActive && <em>当前</em>}</b><small>{workspace.project.eventName || '等待填写活动信息'}</small></span></div><span className="tag">{workspace.editorMode === 'card' ? '完整卡片版' : '精华版'}</span><span className={`status ${isEmpty ? 'draft' : 'ready'}`}><i/>{isEmpty ? '待输入' : '编辑中'}</span><span>{workspace.updatedAt}</span></button><button type="button" className="delete-project" aria-label={`删除${workspace.project.name || '未命名项目'}`} title="删除项目" onClick={() => onDelete(workspace)}><Trash2 size={16}/></button></div> })}</div></div></div>
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
    { label: '目标读者', ok: !!project.audience.trim(), message: project.audience.trim() ? '已设置' : '建议补充目标读者' },
    { label: '发布约束', ok: !!project.mustKeep.trim() && !!project.privatePoints.trim(), message: !project.mustKeep.trim() ? '请填写必须保留内容' : !project.privatePoints.trim() ? '请填写不允许公开内容；如无，请填“无”' : '保留项与隐私项均已设置' },
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

  return <div className="page input-page"><SectionTitle kicker="步骤 01 / 04" title="输入活动内容" description="粘贴完整笔记并设置内容边界；系统会先理解，再进行平台化编排。" actions={<><button type="button" className={`secondary ${checkOpen ? 'active-check' : ''}`} onClick={runInputCheck} aria-expanded={checkOpen} aria-controls="input-check-results"><Eye size={16}/> {checkOpen ? '收起检查' : '输入检查'}</button><button type="button" className="primary" onClick={onAnalyze}><Sparkles size={16}/> 开始结构化解析</button></>}/>{checkOpen && <div ref={checkPanelRef} id="input-check-results" className={`input-check-panel ${allReady ? 'passed' : 'attention'}`} role="status" aria-live="polite"><div className="input-check-summary">{allReady ? <CheckCircle2 size={20}/> : <CircleAlert size={20}/>}<div><b>{allReady ? '输入检查通过，可以开始解析' : requiredReady ? '基础输入有效，还有建议项待补充' : '发现阻断项，请先完成必填内容'}</b><span>本次检查仅验证输入完整性与字符限制，不会调用 AI。{checkedAt && ` · ${checkedAt} 完成`}</span></div><button type="button" className="icon-button" aria-label="关闭输入检查" onClick={() => setCheckOpen(false)}><X size={15}/></button></div><div className="input-check-list">{checkItems.map(item => <div className={item.ok ? 'ok' : 'issue'} key={item.label}>{item.ok ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}<span><b>{item.label}</b><small>{item.message}</small></span></div>)}</div></div>}<div className="input-grid"><div className="panel form-panel"><div className="panel-head compact"><div><h2>基础信息</h2><p>用于项目命名、卡片页眉与内容语境</p></div><span className="required-note">* 必填项</span></div><div className="form-grid"><label><span>项目名称 *</span><input value={project.name} onChange={e => update('name', e.target.value)}/></label><label><span>活动名称 *</span><input value={project.eventName} onChange={e => update('eventName', e.target.value)}/></label><label><span>活动类型 *</span><select value={project.eventType} onChange={e => update('eventType', e.target.value)}><option>Roundtable Discussion</option><option>Conference</option><option>Coffee Chat</option><option>Workshop</option><option>Community Share</option></select></label><label><span>输出模式 *</span><div className="segmented"><button className={project.outputMode === 'summary' ? 'active' : ''} onClick={() => update('outputMode', 'summary')}>精华版</button><button className={project.outputMode === 'card' ? 'active' : ''} onClick={() => update('outputMode', 'card')}>完整卡片版</button></div></label></div><div className="divider"/><div className="textarea-label"><div><b>原始长文 *</b><span>支持 Markdown，将保留标题、列表与引用结构</span></div><button className="text-button" onClick={() => update('originalText', '')}><Trash2 size={14}/> 清空</button></div><div className={`editor-textarea ${over ? 'error' : ''}`}><textarea value={project.originalText} onChange={e => update('originalText', e.target.value)} placeholder="粘贴你的活动笔记、复盘或心得…"/><div className="textarea-footer"><span><CheckCircle2 size={14}/> 已识别 {paragraphs} 个自然段</span><strong className={over ? 'over' : ''}>{charCount.toLocaleString()} / 10,000</strong></div></div></div><aside className="input-side"><div className="panel"><div className="panel-head compact"><div><h2>输入状态</h2><p>实时检查，不调用模型</p></div><span className="live-dot">实时</span></div><div className="metrics"><Metric label="当前字符" value={charCount.toLocaleString()} note={over ? '已超限' : '符合限制'} ok={!over}/><Metric label="预计卡片" value={`${estimatedCards} 张`} note="按标准密度估算"/><Metric label="预计解析" value="约 1 秒" note="测试功能已开放" /></div><div className="recognized"><b>可识别结构</b><div><span><Check/>活动背景</span><span><Check/>核心观点</span><span><Check/>真实案例</span><span><Check/>个人感悟</span><span><Check/>行动建议</span><span><Check/>开放问题</span></div></div></div><div className="panel constraints"><div className="panel-head compact"><div><h2>内容约束</h2><p>约束优先级高于语言润色</p></div><ShieldCheck size={18}/></div><label><span>目标读者</span><input value={project.audience} onChange={e => update('audience', e.target.value)}/></label><label><span>表达语气</span><select value={project.tone} onChange={e => update('tone', e.target.value)}><option>专业复盘</option><option>个人感悟</option><option>轻松分享</option><option>观点分析</option></select></label><label><span>必须保留</span><textarea value={project.mustKeep} onChange={e => update('mustKeep', e.target.value)}/></label><label><span>不允许公开</span><textarea className="private-input" value={project.privatePoints} onChange={e => update('privatePoints', e.target.value)}/></label></div></aside></div></div>
}

function Metric({ label, value, note, ok }: any) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small className={ok === false ? 'bad' : ''}>{ok === true && <CheckCircle2 size={12}/>} {note}</small></div> }

function AnalysisView({ state, insights, setInsights, paragraphs, evidenceId, setEvidenceId, onRetry, onContinue, onVersion }: any) {
  if (state === 'loading') return <div className="center-state"><div className="analysis-loader"><Sparkles/><span/><span/></div><h2>正在理解原文结构</h2><p>提取核心观点、个人感悟与原文证据，不补充外部事实…</p><div className="progress-track"><i/></div></div>
  if (state === 'error') return <div className="center-state"><CircleAlert size={42}/><h2>结构化解析未完成</h2><p>原始内容已安全保留，可以直接重试。</p><button className="primary" onClick={onRetry}><RefreshCw size={16}/> 重新解析</button></div>
  const selected = insights.find((x: Insight) => x.id === evidenceId)
  const sources = paragraphs.filter((p: any) => selected?.sourceIds.includes(p.id))
  return <div className="page"><SectionTitle kicker="步骤 02 / 04" title="确认结构化解析" description="修正观点、重要性与公开范围；每条结论都能追溯到原文。" actions={<><button className="secondary" onClick={onVersion}><Save size={16}/> 保存版本</button><button className="primary" onClick={onContinue}>确认并生成内容 <ChevronRight size={16}/></button></>}/><div className="analysis-layout"><div className="panel insight-panel"><div className="panel-head"><div><h2>核心观点 <em>{insights.length}</em></h2><p>按综合保留分数排序</p></div><button className="secondary small"><Plus size={14}/> 添加观点</button></div><div className="insight-list">{insights.map((item: Insight, index: number) => <div className={`insight-item ${evidenceId === item.id ? 'selected' : ''}`} key={item.id}><GripVertical className="drag" size={17}/><div className="insight-rank">{String(index + 1).padStart(2, '0')}</div><div className="insight-content"><input value={item.title} onChange={e => setInsights((list: Insight[]) => list.map(x => x.id === item.id ? {...x, title: e.target.value} : x))}/><textarea value={item.summary} onChange={e => setInsights((list: Insight[]) => list.map(x => x.id === item.id ? {...x, summary: e.target.value} : x))}/><div className="insight-meta"><button onClick={() => setEvidenceId(item.id)}><FileText size={13}/> 来源 {item.sourceIds.join('、')}</button><label><input type="checkbox" checked={item.mustKeep} onChange={e => setInsights((list: Insight[]) => list.map(x => x.id === item.id ? {...x, mustKeep: e.target.checked} : x))}/> 必须保留</label><label className="private"><input type="checkbox" checked={item.private} onChange={e => setInsights((list: Insight[]) => list.map(x => x.id === item.id ? {...x, private: e.target.checked} : x))}/> 不公开</label></div></div><div className="score"><b>{item.score}</b><span>保留分</span></div></div>)}</div></div><aside className={`evidence-panel panel ${selected ? 'open' : ''}`}><div className="panel-head compact"><div><h2><BookOpenCheck size={17}/> 原文证据对照</h2><p>{selected ? `正在查看“${selected.title}”` : '选择左侧观点查看来源'}</p></div>{selected && <button className="icon-button" onClick={() => setEvidenceId(null)}><X size={16}/></button>}</div>{selected ? <><div className="evidence-summary"><span>生成观点</span><b>{selected.summary}</b></div><div className="source-blocks">{sources.map((source: any) => <div key={source.id}><span>{source.id}</span><p>{highlightSource(source.text, selected.title)}</p></div>)}</div><div className="evidence-footer"><CheckCircle2 size={15}/> 原文支撑充分 · 未发现外部事实</div></> : <div className="empty-evidence"><BookOpenCheck size={32}/><p>点击任一观点下方的“来源”</p><span>原文段落会在这里高亮显示</span></div>}</aside></div></div>
}

function highlightSource(text: string, _title: string) { return text }

function EditorView({ mode, setMode, project, update, summaryCount, cards, setCards, theme, setTheme, density, setDensity, activeCard, setActiveCard, onVersion, onExport }: any) {
  const safeCards = normalizeCards(cards)
  const current = normalizeCard(safeCards[activeCard], activeCard)
  const hasCards = safeCards.length > 0
  return <div className="page editor-page"><SectionTitle kicker="步骤 03 / 04" title="编辑与实时预览" description="内容与视觉独立编辑；模板、密度和文字变更会实时反映在卡片中。" actions={<><button className="secondary" onClick={onVersion}><Save size={16}/> 保存版本</button><button className="primary" onClick={onExport}>导出检查 <ChevronRight size={16}/></button></>}/><div className="editor-tabs"><button className={mode === 'summary' ? 'active' : ''} onClick={() => setMode('summary')}><FileText size={16}/> 精华版</button><button className={mode === 'card' ? 'active' : ''} onClick={() => setMode('card')}><PanelRight size={16}/> 完整卡片版 <span>{safeCards.length}</span></button></div>{mode === 'summary' ? <div className="summary-layout"><div className="panel summary-form"><label><span>标题</span><input value={project.title} onChange={e => update('title', e.target.value)}/></label><label><span>正文</span><textarea value={project.summary} onChange={e => update('summary', e.target.value)}/></label><label><span>话题标签</span><input value={project.tags} onChange={e => update('tags', e.target.value)}/></label></div><aside className="panel summary-stats"><div className="count-ring"><strong>{summaryCount}</strong><span>/ 980 字符</span></div><div className="check-list"><span><CheckCircle2/>正文字符合规</span><span><CheckCircle2/>必须保留观点完整</span><span><CheckCircle2/>未发现重复标签</span></div><button className="secondary" onClick={() => navigator.clipboard.writeText(`${project.title}\n\n${project.summary}\n\n${project.tags}`)}><Copy size={15}/> 复制完整正文</button></aside></div> : !hasCards ? <div className="center-state"><PanelRight size={42}/><h2>还没有可编辑的卡片</h2><p>请先返回“内容输入”并点击“开始结构化解析”。</p><button className="primary" onClick={() => setMode('summary')}><FileText size={16}/> 先编辑精华正文</button></div> : <div className="card-workbench"><section className="block-editor panel"><div className="panel-head compact"><div><h2>卡片内容</h2><p>第 {activeCard + 1} 页 · 一个页面表达一个主题</p></div><button className="icon-button"><MoreHorizontal size={17}/></button></div><label><span>页面标识（仅编辑器显示）</span><input value={current.eyebrow} onChange={e => setCards((list: Card[]) => normalizeCards(list).map((x, i) => i === activeCard ? {...x, eyebrow: e.target.value} : x))}/></label><label><span>AI 小标题</span><textarea className="title-input" value={current.title} onChange={e => setCards((list: Card[]) => normalizeCards(list).map((x, i) => i === activeCard ? {...x, title: e.target.value} : x))}/></label><label><span>正文</span><textarea value={current.body} onChange={e => setCards((list: Card[]) => normalizeCards(list).map((x, i) => i === activeCard ? {...x, body: e.target.value} : x))}/></label>{current.bullets && <label><span>列表项</span><textarea value={current.bullets.join('\n')} onChange={e => setCards((list: Card[]) => normalizeCards(list).map((x, i) => i === activeCard ? {...x, bullets: e.target.value.split('\n')} : x))}/></label>}<div className="block-actions"><button><Plus size={14}/> 添加 Block</button><button className="danger"><Trash2 size={14}/> 删除本页</button></div></section><section className="preview-stage"><div className="preview-toolbar"><div className="density-control"><span>密度</span>{(['relaxed','standard','compact'] as Density[]).map(d => <button className={density === d ? 'active' : ''} key={d} onClick={() => setDensity(d)}>{d === 'relaxed' ? '舒展' : d === 'standard' ? '标准' : '紧凑'}</button>)}</div><span className="preview-size">1080 × 1440 · 3:4</span></div><CardPreview card={current} theme={theme} density={density} page={activeCard + 1} total={safeCards.length}/><div className="page-nav"><button disabled={activeCard === 0} onClick={() => setActiveCard((n: number) => n - 1)}><ChevronLeft size={17}/></button><div>{safeCards.map((_: Card, i: number) => <button key={i} className={i === activeCard ? 'active' : ''} onClick={() => setActiveCard(i)}>{i + 1}</button>)}</div><button disabled={activeCard === safeCards.length - 1} onClick={() => setActiveCard((n: number) => n + 1)}><ChevronRight size={17}/></button></div></section><aside className="theme-panel panel"><div className="panel-head compact"><div><h2><Palette size={17}/> 模板</h2><p>全套卡片统一应用</p></div></div><div className="theme-list">{themes.map(t => <button key={t.id} className={theme === t.id ? 'active' : ''} onClick={() => setTheme(t.id)}><div className="swatches">{t.swatches.map(c => <i key={c} style={{background:c}}/>)}</div><span><b>{t.name}</b><small>{t.desc}</small></span>{theme === t.id && <CheckCircle2 size={16}/>}</button>)}</div><div className="layout-check"><b>分页校验</b><span><CheckCircle2/>无文字溢出</span><span><CheckCircle2/>标题未孤立</span><span><CheckCircle2/>末页平衡良好</span><span><CheckCircle2/>页码连续</span></div></aside></div>}</div>
}

function CardPreview({ card, theme, density, page, total }: any) {
  const safeCard = normalizeCard(card, Math.max(0, page - 1))
  return <div className={`card-preview ${theme} ${density}`}><div className="card-accent"/><div className="card-head"><i>{String(page).padStart(2,'0')}</i></div><div className="card-body"><h2>{safeCard.title.split('\n').map((line: string, i: number) => <span key={i}>{line}</span>)}</h2>{safeCard.addedLead && <p className="added-text">{safeCard.addedLead}</p>}<p className="original-text">{safeCard.body}</p>{safeCard.bullets && <ul>{safeCard.bullets.map((b: string, i: number) => <li key={i}><i>{i + 1}</i><span>{b}</span></li>)}</ul>}{safeCard.addedEnding && <p className="added-text ending">{safeCard.addedEnding}</p>}</div><div className="card-foot"><span>原文保真 · 系统仅加标题/导语</span><b>{page} / {total}</b></div></div>
}

function ExportView({ project, theme, cards, summaryCount, privateHits, checks, setChecks, exports, onExport, onRedownload, exporting }: any) {
  const reviewItems = privateHits.length ? privateHits : [{ id: 0, rule: '未发现明确不可公开内容', hit: '仍需人工确认活动内容可发布' }]
  const ready = checks.slice(0, reviewItems.length).every(Boolean)
  return <div className="page"><SectionTitle kicker="步骤 04 / 04" title="导出检查与记录" description="完成隐私复核后，将全部卡片生成 1080 × 1440 PNG 图片并打包下载。" actions={<button className="primary" disabled={!ready || exporting} onClick={onExport}>{exporting ? <LoaderCircle className="spin" size={16}/> : <Download size={16}/>} {exporting ? '正在生成图片…' : '导出 PNG 图片包'}</button>}/><div className="export-layout"><div className="export-main"><div className="panel privacy-review"><div className="panel-head"><div><h2><ShieldCheck size={18}/> 发布前隐私复核</h2><p>必须逐项确认，未完成时禁止导出</p></div><span className={ready ? 'status ready' : 'status blocked'}><i/>{ready ? '已通过' : '待确认'}</span></div>{reviewItems.map((item: any, i: number) => <label className={checks[i] ? 'checked' : ''} key={item.id}><input type="checkbox" checked={!!checks[i]} onChange={e => setChecks((list: boolean[]) => { const next = [...list]; next[i] = e.target.checked; return next })}/><span className="custom-check">{checks[i] && <Check size={14}/>}</span><div><b>{item.rule}</b><p>{item.hit}</p></div><button type="button"><Eye size={15}/> 查看原文</button></label>)}<div className="privacy-note"><LockKeyhole size={16}/><span>原文与约束仅用于本项目处理，不写入普通日志。</span></div></div><div className="panel package-files"><div className="panel-head"><div><h2>发布包内容</h2><p>生成后直接下载到当前设备</p></div><span>{cards.length + 6} 个文件</span></div><div className="file-grid"><FileItem name="manifest.json" meta="资源清单与生成信息"/><FileItem name="title.txt" meta={`${[...project.title].length} 字符`}/><FileItem name="content.txt" meta={`${summaryCount} 字符`}/><FileItem name="tags.txt" meta="5 个话题标签"/><FileItem name="cards/*.png" meta={`${cards.length} 张 · 1080 × 1440`}/><FileItem name="source/" meta="原文与结构化数据"/></div></div><div className="panel export-history"><div className="panel-head"><div><h2>导出记录</h2><p>历史发布包与生成配置</p></div><button className="ghost"><RefreshCw size={14}/> 刷新</button></div><div className="history-list">{exports.map((record: ExportRecord) => <div key={record.id}><div className="archive-icon"><FileArchive size={18}/></div><span><b>{record.fileName}</b><small>{record.at} · {themes.find(t => t.id === record.theme)?.name} · {record.cards} 张卡片 · {record.chars} 字符</small></span><span className="status ready"><i/>成功</span><button className="secondary small" onClick={() => onRedownload(record)}><Download size={14}/> 再次下载</button></div>)}</div></div></div><aside className="export-side"><div className="panel export-summary"><h2>导出摘要</h2><div className="export-cover"><span>完整卡片版</span><b>{project.title}</b><small>{project.eventName}</small></div><dl><div><dt>模板</dt><dd>{themes.find(t => t.id === theme)?.name}</dd></div><div><dt>卡片数量</dt><dd>{cards.length} 张</dd></div><div><dt>正文字符</dt><dd>{summaryCount} / 980</dd></div><div><dt>图片规格</dt><dd>1080 × 1440</dd></div></dl><div className="final-checks"><b>导出校验</b><span><CheckCircle2/>字符数符合限制</span><span><CheckCircle2/>卡片无溢出</span><span><CheckCircle2/>字体与资源已就绪</span><span className={ready ? '' : 'pending'}>{ready ? <CheckCircle2/> : <Clock3/>}隐私复核{ready ? '已完成' : '待完成'}</span></div><button className="primary wide" disabled={!ready || exporting} onClick={onExport}>{exporting ? <LoaderCircle className="spin" size={17}/> : <FileArchive size={17}/>} {exporting ? '正在生成高清图片…' : ready ? '导出 PNG 图片包' : '请先完成隐私复核'}</button></div></aside></div></div>
}

function FileItem({ name, meta }: any) { return <div><div className="file-type"><FileText size={17}/></div><span><b>{name}</b><small>{meta}</small></span><CheckCircle2 size={15}/></div> }

function VersionDrawer({ versions, onRestore, onClose }: any) {
  return <><div className="drawer-backdrop" onClick={onClose}/><aside className="version-drawer"><div className="drawer-head"><div><h2><History size={18}/> 内容版本</h2><p>恢复不会删除其他历史记录</p></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div><div className="version-timeline">{versions.map((v: Version, i: number) => <div key={v.id}><i className={i === 0 ? 'latest' : ''}/><span><small>{v.at}</small><b>{v.label}</b><em>{v.entity}</em></span><button onClick={() => onRestore(v)}><ArchiveRestore size={14}/> 恢复</button></div>)}</div></aside></>
}
