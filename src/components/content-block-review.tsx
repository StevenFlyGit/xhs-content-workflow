import { useEffect, useMemo } from 'react'
import {
  ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert,
  Combine, FileText, RefreshCw, Save, Scissors, Sparkles,
} from 'lucide-react'
import type { SourceSentence } from '../lib/source-segmentation'

export type ContentBlock = {
  id: string
  title: string
  summary: string
  sourceIds: string[]
}

type ReviewState = 'idle' | 'loading' | 'done' | 'error'

type ContentBlockReviewProps = {
  state: ReviewState
  blocks: ContentBlock[]
  setBlocks: React.Dispatch<React.SetStateAction<ContentBlock[]>>
  sourceSentences: SourceSentence[]
  selectedId: string | null
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>
  analysisMode?: 'model' | 'local-fallback'
  onRetry: () => void
  onContinue: () => void
  onVersion: () => void
  onStructureChange: () => void
  notify: (message: string) => void
}

function blockSentences(block: ContentBlock | undefined, sourceSentences: SourceSentence[]) {
  if (!block) return []
  const ids = new Set(block.sourceIds)
  return sourceSentences.filter(sentence => ids.has(sentence.id))
}

function textLength(sentences: SourceSentence[]) {
  return [...sentences.map(sentence => sentence.text).join('')].length
}

function suggestedTitle(sentences: SourceSentence[]) {
  const source = sentences[0]?.text || '新内容分块'
  const afterColon = source.split(/[：:]/).filter(Boolean).at(-1) || source
  const compact = afterColon.replace(/^[-—·\s\d.、]+/, '').replace(/[“”"'。！？!?，,；;：:\s]/g, '')
  return compact.slice(0, 14) || '新内容分块'
}

function qualityFor(chars: number, sentenceCount: number, blockCount: number) {
  if (!sentenceCount) return { label: '缺少内容', tone: 'danger' }
  if (chars > 420) return { label: '内容较长，建议拆分', tone: 'warning' }
  if (chars < 70 && blockCount > 1) return { label: '内容较短，可考虑合并', tone: 'warning' }
  return { label: '篇幅适中', tone: 'success' }
}

export function ContentBlockReview({
  state,
  blocks,
  setBlocks,
  sourceSentences,
  selectedId,
  setSelectedId,
  analysisMode,
  onRetry,
  onContinue,
  onVersion,
  onStructureChange,
  notify,
}: ContentBlockReviewProps) {
  useEffect(() => {
    if (state === 'done' && blocks.length && !blocks.some(block => block.id === selectedId)) {
      setSelectedId(blocks[0].id)
    }
  }, [blocks, selectedId, setSelectedId, state])

  const selectedIndex = blocks.findIndex(block => block.id === selectedId)
  const selected = selectedIndex >= 0 ? blocks[selectedIndex] : blocks[0]
  const selectedSentences = useMemo(
    () => blockSentences(selected, sourceSentences),
    [selected, sourceSentences],
  )

  const coverage = useMemo(() => {
    const occurrences = new Map<string, number>()
    blocks.forEach(block => block.sourceIds.forEach(id => occurrences.set(id, (occurrences.get(id) || 0) + 1)))
    const missing = sourceSentences.filter(sentence => !occurrences.has(sentence.id)).length
    const duplicates = [...occurrences.values()].filter(count => count > 1).length
    return { missing, duplicates, covered: sourceSentences.length - missing }
  }, [blocks, sourceSentences])

  if (state === 'loading') {
    return <div className="center-state"><div className="analysis-loader"><Sparkles/><span/><span/></div><h2>正在理解原文结构</h2><p>系统正在识别主题边界，并确保每句话都被完整收录…</p><div className="progress-track"><i/></div></div>
  }

  if (state === 'error') {
    return <div className="center-state"><CircleAlert size={42}/><h2>内容分块未完成</h2><p>原始内容已安全保留，可以直接重试。</p><button className="primary" onClick={onRetry}><RefreshCw size={16}/> 重新解析</button></div>
  }

  function commit(next: ContentBlock[], nextSelectedId = selected?.id) {
    setBlocks(next)
    setSelectedId(nextSelectedId || next[0]?.id || null)
    onStructureChange()
  }

  function updateSelected(patch: Partial<ContentBlock>) {
    if (!selected) return
    commit(blocks.map(block => block.id === selected.id ? { ...block, ...patch } : block), selected.id)
  }

  function moveSelected(direction: -1 | 1) {
    if (selectedIndex < 0) return
    const targetIndex = selectedIndex + direction
    if (targetIndex < 0 || targetIndex >= blocks.length) return
    const next = [...blocks]
    ;[next[selectedIndex], next[targetIndex]] = [next[targetIndex], next[selectedIndex]]
    commit(next, selected.id)
    notify(direction < 0 ? '当前分块已上移' : '当前分块已下移')
  }

  function merge(direction: -1 | 1) {
    if (!selected) return
    const neighborIndex = selectedIndex + direction
    if (neighborIndex < 0 || neighborIndex >= blocks.length) return
    const neighbor = blocks[neighborIndex]
    const mergedIds = new Set([...selected.sourceIds, ...neighbor.sourceIds])
    const orderedIds = sourceSentences.filter(sentence => mergedIds.has(sentence.id)).map(sentence => sentence.id)
    const keep = direction < 0 ? neighbor : selected
    const removeId = direction < 0 ? selected.id : neighbor.id
    const merged = { ...keep, sourceIds: orderedIds }
    const next = blocks
      .filter(block => block.id !== removeId)
      .map(block => block.id === keep.id ? merged : block)
    commit(next, keep.id)
    notify(direction < 0 ? '已并入上一块' : '已与下一块合并')
  }

  function splitAfter(sentenceId: string) {
    if (!selected) return
    const boundary = selectedSentences.findIndex(sentence => sentence.id === sentenceId)
    if (boundary < 0 || boundary >= selectedSentences.length - 1) return
    const left = selectedSentences.slice(0, boundary + 1)
    const right = selectedSentences.slice(boundary + 1)
    const newBlock: ContentBlock = {
      id: crypto.randomUUID(),
      title: suggestedTitle(right),
      summary: '从原分块中拆分出的独立内容',
      sourceIds: right.map(sentence => sentence.id),
    }
    const next = [...blocks]
    next.splice(selectedIndex, 1, { ...selected, sourceIds: left.map(sentence => sentence.id) }, newBlock)
    commit(next, newBlock.id)
    notify('已从所选位置拆成两个内容块')
  }

  const selectedChars = textLength(selectedSentences)
  const selectedPages = Math.max(1, Math.ceil(selectedChars / 240))
  const coverageReady = coverage.missing === 0 && coverage.duplicates === 0

  return (
    <div className="page analysis-page">
      <div className="section-title">
        <div><span>步骤 02 / 04</span><h1>检查内容分块</h1><p>确认每一块是否表达一个完整主题，需要时可以拆分、合并或调整顺序。</p></div>
        <div className="section-actions"><button className="secondary" onClick={onVersion}><Save size={16}/> 保存版本</button><button className="primary" onClick={onContinue}>确认结构并生成内容 <ChevronRight size={16}/></button></div>
      </div>

      <div className={`coverage-bar ${coverageReady ? 'ready' : 'attention'}`} role="status">
        <div>{coverageReady ? <CheckCircle2 size={18}/> : <CircleAlert size={18}/>}<span><b>{blocks.length} 个内容块</b><small>{analysisMode === 'local-fallback' ? '当前按自然段分块，可继续手动调整' : '已按语义识别主题边界'}</small></span></div>
        <dl><div><dt>原文覆盖</dt><dd>{coverage.covered} / {sourceSentences.length} 句</dd></div><div><dt>遗漏</dt><dd>{coverage.missing}</dd></div><div><dt>重复</dt><dd>{coverage.duplicates}</dd></div></dl>
      </div>

      <div className="analysis-layout">
        <section className="panel block-outline">
          <div className="panel-head"><div><h2>内容结构 <em>{blocks.length}</em></h2><p>选择分块查看完整内容，也可调整前后顺序</p></div></div>
          <div className="block-outline-list">
            {blocks.map((block, index) => {
              const sentences = blockSentences(block, sourceSentences)
              const chars = textLength(sentences)
              const quality = qualityFor(chars, sentences.length, blocks.length)
              const preview = sentences.map(sentence => sentence.text).join('').slice(0, 68)
              return <button key={block.id} type="button" className={`block-outline-item ${selected?.id === block.id ? 'selected' : ''}`} aria-pressed={selected?.id === block.id} onClick={() => setSelectedId(block.id)}>
                <span className="block-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="block-outline-copy"><b>{block.title}</b><small>{preview || '当前分块没有可显示的原文内容'}</small><span className="block-meta"><i>{chars} 字</i><i>{sentences.length} 句</i><i>预计 {Math.max(1, Math.ceil(chars / 240))} 页</i><i className={quality.tone}>{quality.label}</i></span></span>
                <ChevronRight size={16}/>
              </button>
            })}
          </div>
        </section>

        <aside className="panel block-inspector">
          {selected ? <>
            <div className="block-inspector-head">
              <div><span>当前分块</span><input aria-label="分块标题" value={selected.title} onChange={event => updateSelected({ title: event.target.value })}/></div>
              <button className="secondary small" onClick={() => { updateSelected({ title: suggestedTitle(selectedSentences) }); notify('已根据当前内容重拟标题') }}><Sparkles size={14}/> 重拟标题</button>
            </div>
            <div className="block-inspector-meta"><span><FileText size={14}/>{selectedChars} 字</span><span>{selectedSentences.length} 句</span><span>预计生成 {selectedPages} 页</span></div>
            <div className="block-content" aria-label="当前分块包含的原文">
              {selectedSentences.length ? selectedSentences.map((sentence, index) => (
                <div className="review-sentence" key={sentence.id}>
                  <p>{sentence.text}</p>
                  {index < selectedSentences.length - 1 && <button className="split-point" onClick={() => splitAfter(sentence.id)}><span/><Scissors size={13}/> 从这里拆分<span/></button>}
                </div>
              )) : <div className="empty-block"><FileText size={30}/><b>没有匹配到原文内容</b><span>请重新解析，或将该分块与相邻内容合并。</span></div>}
            </div>
            <div className="block-inspector-actions">
              <div><button disabled={selectedIndex <= 0} onClick={() => moveSelected(-1)}><ArrowUp size={14}/> 上移</button><button disabled={selectedIndex >= blocks.length - 1} onClick={() => moveSelected(1)}><ArrowDown size={14}/> 下移</button></div>
              <div><button disabled={selectedIndex <= 0} onClick={() => merge(-1)}><ChevronLeft size={14}/><Combine size={14}/> 并入上一块</button><button disabled={selectedIndex >= blocks.length - 1} onClick={() => merge(1)}><Combine size={14}/> 与下一块合并<ChevronRight size={14}/></button></div>
            </div>
          </> : <div className="empty-block inspector-empty"><FileText size={34}/><b>还没有内容分块</b><span>返回内容输入页，完成解析后即可在这里检查。</span></div>}
        </aside>
      </div>
    </div>
  )
}
