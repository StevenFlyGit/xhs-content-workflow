import { CheckCircle2, CircleAlert, Copy, Sparkles } from 'lucide-react'
import {
  publicationText,
  SUMMARY_PUBLICATION_LIMIT,
  SUMMARY_REWRITE_THRESHOLD,
} from '../lib/publication-limits'

type SummaryProject = {
  title: string
  summary: string
  tags: string
  originalText: string
  publicationTone?: string
  summaryGeneration?: 'model' | 'local-fallback'
  summaryWasRewritten?: boolean
}

type SummaryEditorProps = {
  project: SummaryProject
  update: (key: 'title' | 'summary' | 'tags', value: string) => void
  publicationCount: number
  publicationOverLimit: boolean
  notify: (message: string) => void
}

export function SummaryEditor({
  project,
  update,
  publicationCount,
  publicationOverLimit,
  notify,
}: SummaryEditorProps) {
  const remaining = SUMMARY_PUBLICATION_LIMIT - publicationCount
  const originalNeedsRewrite = [...project.originalText].length > SUMMARY_REWRITE_THRESHOLD
  const titleCount = [...project.title].length
  const bodyCount = [...project.summary].length
  const tagCount = [...project.tags].length

  async function copyReadyText() {
    if (publicationOverLimit) {
      notify(`当前超出 ${Math.abs(remaining)} 字，请精简后再复制`)
      return
    }
    await navigator.clipboard.writeText(publicationText({
      title: project.title,
      body: project.summary,
      tags: project.tags,
    }))
    notify('已复制可直接发布的精华文案')
  }

  return (
    <div className="summary-layout">
      <div className="panel summary-form">
        <div className={`summary-generation-note ${project.summaryGeneration || 'pending'}`}>
          {project.summaryGeneration === 'model' ? <Sparkles size={16}/> : project.summaryGeneration === 'local-fallback' ? <CircleAlert size={16}/> : <Sparkles size={16}/>}
          <span>
            <b>{project.summaryGeneration === 'model'
              ? `已按“${project.publicationTone || '自然真诚'}”口吻生成`
              : project.summaryGeneration === 'local-fallback'
                ? '当前是保真兜底稿'
                : originalNeedsRewrite
                  ? '原文超过 950 字，重新解析后将进行场景化改写'
                  : '解析后会根据内容自动匹配表达口吻'}</b>
            <small>{project.summaryGeneration === 'model'
              ? project.summaryWasRewritten ? '已压缩长原文并弱化模板感，可继续按个人习惯调整。' : '已根据内容场景优化语气和阅读节奏。'
              : project.summaryGeneration === 'local-fallback'
                ? '模型未成功返回个性化文案，请配置模型后重新解析以获得更自然的口吻。'
                : '事实只来自原文，不会凭空补充人物、地点或经历。'}</small>
          </span>
        </div>
        <label><span>标题 <em>{titleCount} 字</em></span><input value={project.title} onChange={event => update('title', event.target.value)}/></label>
        <label><span>正文 <em>{bodyCount} 字</em></span><textarea value={project.summary} onChange={event => update('summary', event.target.value)}/></label>
        <label><span>话题标签 <em>{tagCount} 字</em></span><input value={project.tags} onChange={event => update('tags', event.target.value)}/></label>
      </div>
      <aside className={`panel summary-stats ${publicationOverLimit ? 'over-limit' : ''}`}>
        <div className={`count-ring ${publicationOverLimit ? 'over' : publicationCount > 900 ? 'near' : ''}`} role="status" aria-live="polite">
          <strong>{publicationCount}</strong>
          <span>/ {SUMMARY_PUBLICATION_LIMIT} 字</span>
        </div>
        <div className={`limit-message ${publicationOverLimit ? 'bad' : 'good'}`}>
          {publicationOverLimit ? <CircleAlert size={16}/> : <CheckCircle2 size={16}/>}
          <span><b>{publicationOverLimit ? `超出 ${Math.abs(remaining)} 字` : `还可输入 ${remaining} 字`}</b><small>标题、正文、标签及它们之间的换行均计入总字数</small></span>
        </div>
        <div className="check-list">
          <span className={publicationOverLimit ? 'bad' : ''}>{publicationOverLimit ? <CircleAlert/> : <CheckCircle2/>}发布总字数{publicationOverLimit ? '超出限制' : '符合限制'}</span>
          <span><CheckCircle2/>标题、正文与标签已合并预览</span>
          <span><CheckCircle2/>可直接复制到小红书发布页</span>
        </div>
        <button className="secondary" disabled={publicationOverLimit} onClick={copyReadyText}><Copy size={15}/> 复制发布文案</button>
      </aside>
    </div>
  )
}
