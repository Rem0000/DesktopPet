import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AssembledChapterContext,
  BookOutline,
  BookShelfItem,
  ChapterDraft,
  CreateBookInput,
  GuardWarning,
  NovelBookSnapshot,
  NovelManuscript,
  NovelStreamEvent,
  StateDiff,
} from './contracts'

type TabId = 'outline' | 'write' | 'state' | 'preview'

const emptyCreate: CreateBookInput = {
  title: '',
  premise: '',
  themes: [],
  era: '当代',
  styleNotes: '',
  seedCharacters: [{ name: '' }],
}

export function NovelApp() {
  const [books, setBooks] = useState<BookShelfItem[]>([])
  const [activeBookId, setActiveBookId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<NovelBookSnapshot | null>(null)
  const [tab, setTab] = useState<TabId>('outline')
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState<CreateBookInput>(emptyCreate)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [outlineDraft, setOutlineDraft] = useState<BookOutline | null>(null)
  const [outlineGuidance, setOutlineGuidance] = useState('')
  const [chapterNumber, setChapterNumber] = useState(1)
  const [assembled, setAssembled] = useState<AssembledChapterContext | null>(null)
  const [streaming, setStreaming] = useState('')
  const [draft, setDraft] = useState<ChapterDraft | null>(null)
  const [diff, setDiff] = useState<StateDiff | null>(null)
  const [diffText, setDiffText] = useState('')
  const [warnings, setWarnings] = useState<GuardWarning[]>([])
  const [feedback, setFeedback] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [embeddingHint, setEmbeddingHint] = useState('')
  const [manuscript, setManuscript] = useState<NovelManuscript | null>(null)
  const [previewBusy, setPreviewBusy] = useState('')

  const refreshBooks = useCallback(async () => {
    const list = await window.petAPI.novel.listBooks()
    setBooks(list)
  }, [])

  const refreshBook = useCallback(async (bookId: string) => {
    const next = await window.petAPI.novel.getBook(bookId)
    setSnapshot(next)
    setOutlineDraft(next.outline)
    if (!next.outline.volumes.some((v) =>
      v.chapters.some((c) => c.chapterNumber === chapterNumber),
    )) {
      const first =
        next.outline.volumes[0]?.chapters[0]?.chapterNumber ??
        (next.meta.lastAcceptedChapter ?? 0) + 1
      setChapterNumber(Math.max(1, first))
    }
  }, [chapterNumber])

  const refreshEmbedding = useCallback(async () => {
    const status = await window.petAPI.novel.getEmbeddingStatus()
    if (status.state === 'ready') {
      setEmbeddingHint('')
      return
    }
    if (status.state === 'error') {
      setEmbeddingHint(
        `Embedding 不可用：${status.message ?? '未知错误'}。写章将降级检索，连续性风险较高。\n${status.manualDownloadHint ?? ''}`,
      )
      return
    }
    setEmbeddingHint('Embedding 模型尚未就绪，书内语义检索可能降级。')
  }, [])

  useEffect(() => {
    void refreshBooks()
    void refreshEmbedding()
  }, [refreshBooks, refreshEmbedding])

  useEffect(() => {
    return window.petAPI.novel.onStream((event: NovelStreamEvent) => {
      if (event.type === 'chunk') {
        setStreaming((prev) => prev + event.chunk)
        return
      }
      if (event.type === 'draft_complete') {
        setDraft(event.draft)
        setAssembled(event.assembled)
        setStreaming(event.draft.content)
        setBusy('')
        if (event.assembled.degraded) {
          setEmbeddingHint(
            event.assembled.degradeReason ||
              '已降级检索：连续性风险较高，建议加载 Embedding 后重试。',
          )
        }
        return
      }
      if (event.type === 'diff_ready') {
        setDiff(event.diff)
        setDiffText(JSON.stringify(event.diff, null, 2))
        setWarnings(event.warnings)
        setBusy('')
        return
      }
      if (event.type === 'error') {
        setError(event.message)
        setBusy('')
        setRequestId(null)
      }
    })
  }, [])

  const openBook = async (bookId: string) => {
    setError('')
    setActiveBookId(bookId)
    setTab('outline')
    setDraft(null)
    setDiff(null)
    setDiffText('')
    setWarnings([])
    setStreaming('')
    setManuscript(null)
    await refreshBook(bookId)
  }

  const handleCreate = async () => {
    setBusy('建书中…')
    setError('')
    try {
      const themes = (createForm.themes ?? [])
        .flatMap((item) => String(item).split(/[,，]/))
        .map((item) => item.trim())
        .filter(Boolean)
      const seeds = (createForm.seedCharacters ?? [])
        .filter((item) => item.name.trim())
        .map((item) => ({ ...item, name: item.name.trim() }))
      const created = await window.petAPI.novel.createBook({
        ...createForm,
        themes,
        seedCharacters: seeds,
      })
      setCreating(false)
      setCreateForm(emptyCreate)
      await refreshBooks()
      await openBook(created.id)
      setInfo('书籍已创建，可生成大纲。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '建书失败')
    } finally {
      setBusy('')
    }
  }

  const handleDelete = async () => {
    if (!activeBookId) return
    if (!window.confirm('确认删除该书？将移除其全部小说数据，不影响聊天记忆。')) return
    await window.petAPI.novel.deleteBook(activeBookId)
    setActiveBookId(null)
    setSnapshot(null)
    await refreshBooks()
  }

  const handleGenerateOutline = async () => {
    if (!activeBookId) return
    setBusy('生成大纲…')
    setError('')
    try {
      const result = await window.petAPI.novel.generateOutline(
        activeBookId,
        outlineGuidance || undefined,
      )
      if (result.lockedExisting) {
        const ok = window.confirm('当前大纲已锁定。要用新草案覆盖编辑区吗？（不会自动保存）')
        if (!ok) return
      }
      setOutlineDraft(result.draft)
      setInfo('大纲草案已生成，请审阅后保存/锁定。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成大纲失败')
    } finally {
      setBusy('')
    }
  }

  const handleReviseOutline = async () => {
    if (!activeBookId || !outlineDraft) return
    if (!outlineGuidance.trim()) {
      setError('请先填写调整要求，例如：「把中段放慢，加强林晚与母亲的冲突」')
      return
    }
    if (!outlineDraft.volumes.length) {
      setError('当前没有大纲，请先生成草案')
      return
    }
    setBusy('AI 调整整份大纲…')
    setError('')
    try {
      const result = await window.petAPI.novel.reviseOutline(
        activeBookId,
        outlineGuidance.trim(),
        outlineDraft,
      )
      if (result.lockedExisting) {
        const ok = window.confirm(
          '当前已锁定大纲。调整结果将覆盖编辑区（需再点保存才落盘）。继续？',
        )
        if (!ok) return
      }
      setOutlineDraft(result.draft)
      setInfo('整份大纲已按要求调整，请审阅后保存/锁定。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '调整大纲失败')
    } finally {
      setBusy('')
    }
  }

  const handleReviseOutlineChapter = async (chapterNumberToRevise: number) => {
    if (!activeBookId || !outlineDraft) return
    const guidance =
      outlineGuidance.trim() ||
      window.prompt(
        `第 ${chapterNumberToRevise} 章调整要求`,
        '加强人物内心冲突，并与前后章更连贯',
      )
    if (!guidance?.trim()) return
    setBusy(`AI 调整第 ${chapterNumberToRevise} 章…`)
    setError('')
    try {
      const revised = await window.petAPI.novel.reviseOutlineChapter(
        activeBookId,
        chapterNumberToRevise,
        guidance.trim(),
        outlineDraft,
      )
      setOutlineDraft((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          volumes: prev.volumes.map((volume) => ({
            ...volume,
            chapters: volume.chapters.map((chapter) =>
              chapter.chapterNumber === chapterNumberToRevise ? revised : chapter,
            ),
          })),
          updatedAt: new Date().toISOString(),
        }
      })
      setInfo(`第 ${chapterNumberToRevise} 章大纲已调整，请审阅后保存。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '调整章节失败')
    } finally {
      setBusy('')
    }
  }

  const handleSaveOutline = async (lock: boolean) => {
    if (!activeBookId || !outlineDraft) return
    setBusy('保存大纲…')
    try {
      const saved = await window.petAPI.novel.saveOutline(
        activeBookId,
        outlineDraft,
        lock,
      )
      setOutlineDraft(saved)
      await refreshBook(activeBookId)
      setInfo(lock ? '大纲已锁定保存' : '大纲已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy('')
    }
  }

  const handleAssemble = async () => {
    if (!activeBookId) return
    setBusy('组装上下文…')
    try {
      const next = await window.petAPI.novel.assembleChapter(activeBookId, chapterNumber)
      setAssembled(next)
      if (next.degraded) {
        setEmbeddingHint(next.degradeReason || '检索已降级')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '组装失败')
    } finally {
      setBusy('')
    }
  }

  const handleWrite = async () => {
    if (!activeBookId) return
    setBusy('写章中…')
    setError('')
    setStreaming('')
    setDraft(null)
    setDiff(null)
    setDiffText('')
    setWarnings([])
    try {
      const { requestId: id } = await window.petAPI.novel.writeChapter(
        activeBookId,
        chapterNumber,
        feedback || undefined,
      )
      setRequestId(id)
    } catch (err) {
      setBusy('')
      setError(err instanceof Error ? err.message : '写章失败')
    }
  }

  const handleCancel = async () => {
    if (!requestId) return
    await window.petAPI.novel.cancelChapter(requestId)
    setRequestId(null)
    setBusy('')
  }

  const handleAccept = async (force = false) => {
    if (!activeBookId || !draft) return
    let parsed: StateDiff = diff ?? {}
    try {
      parsed = JSON.parse(diffText || '{}') as StateDiff
    } catch {
      setError('StateDiff JSON 无法解析')
      return
    }
    setBusy('提交 Accept…')
    try {
      const result = await window.petAPI.novel.acceptChapter({
        bookId: activeBookId,
        chapterNumber: draft.chapterNumber,
        revision: draft.revision,
        title: draft.title,
        content: streaming || draft.content,
        diff: parsed,
        forceAccept: force,
        warnings,
      })
      setInfo(
        result.embeddingOk
          ? '章节已 Accept，书内索引已更新'
          : '章节已 Accept，但 Embedding 未就绪，索引向量可能不完整',
      )
      await refreshBook(activeBookId)
      await refreshBooks()
      setChapterNumber(draft.chapterNumber + 1)
      if (tab === 'preview') await loadManuscript(activeBookId)
      else setManuscript(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accept 失败')
    } finally {
      setBusy('')
    }
  }

  const handleReject = async () => {
    if (!activeBookId || !draft) return
    await window.petAPI.novel.rejectChapter({
      bookId: activeBookId,
      chapterNumber: draft.chapterNumber,
      revision: draft.revision,
    })
    setInfo('已 Reject：Canon 未变更，草稿仍保留')
  }

  const loadManuscript = async (bookId: string) => {
    setPreviewBusy('加载全书…')
    setError('')
    try {
      const next = await window.petAPI.novel.getManuscript(bookId)
      setManuscript(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载全书失败')
      setManuscript(null)
    } finally {
      setPreviewBusy('')
    }
  }

  const openPreviewTab = async () => {
    setTab('preview')
    if (activeBookId) await loadManuscript(activeBookId)
  }

  const handleExport = async (format: 'markdown' | 'pdf' | 'html') => {
    if (!activeBookId) return
    setPreviewBusy(`导出 ${format}…`)
    setError('')
    try {
      const result = await window.petAPI.novel.exportManuscript(activeBookId, format)
      if ('canceled' in result && result.canceled) {
        setInfo('已取消导出')
        return
      }
      if (!result.ok) {
        setError('error' in result ? result.error : '导出失败')
        return
      }
      setInfo(`已导出：${result.filePath}`)
      await loadManuscript(activeBookId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setPreviewBusy('')
    }
  }

  const chapterOptions = useMemo(() => {
    const nums = new Set<number>()
    for (const volume of outlineDraft?.volumes ?? []) {
      for (const chapter of volume.chapters) nums.add(chapter.chapterNumber)
    }
    if (nums.size === 0) {
      const last = snapshot?.meta.lastAcceptedChapter ?? 0
      nums.add(last + 1)
    }
    return [...nums].sort((a, b) => a - b)
  }, [outlineDraft, snapshot])

  return (
    <div className="novel-shell">
      <header className="novel-topbar">
        <div>
          <h1>小说工坊</h1>
          <div className="muted">长篇现实向 · AI 大纲 · 人审章 · 与聊天记忆隔离</div>
        </div>
        <div className="novel-actions">
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            新建书籍
          </button>
          {activeBookId ? (
            <button type="button" className="danger" onClick={() => void handleDelete()}>
              删除当前书
            </button>
          ) : null}
        </div>
      </header>

      <div className="novel-body">
        <aside className="novel-sidebar">
          <h2>书架</h2>
          {books.length === 0 ? (
            <div className="empty" style={{ color: '#b9a793' }}>
              还没有书，先新建一本。
            </div>
          ) : (
            books.map((book) => (
              <button
                key={book.id}
                type="button"
                className={`book-card${book.id === activeBookId ? ' active' : ''}`}
                onClick={() => void openBook(book.id)}
              >
                <div className="title">{book.title}</div>
                <div className="meta">
                  已接受 {book.acceptedChapterCount} 章
                  {book.lastAcceptedChapter ? ` · 至第 ${book.lastAcceptedChapter} 章` : ''}
                </div>
              </button>
            ))
          )}
        </aside>

        <main className="novel-main">
          {creating ? (
            <section className="panel">
              <h3>新建现实向长篇</h3>
              <div className="form-grid">
                <label>
                  书名
                  <input
                    value={createForm.title}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, title: e.target.value }))
                    }
                  />
                </label>
                <label>
                  故事前提
                  <textarea
                    value={createForm.premise}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, premise: e.target.value }))
                    }
                  />
                </label>
                <label>
                  主题（逗号分隔）
                  <input
                    value={(createForm.themes ?? []).join('，')}
                    onChange={(e) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        themes: e.target.value.split(/[,，]/),
                      }))
                    }
                  />
                </label>
                <label>
                  时代背景
                  <input
                    value={createForm.era ?? ''}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, era: e.target.value }))
                    }
                  />
                </label>
                <label>
                  文风备注
                  <textarea
                    value={createForm.styleNotes ?? ''}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, styleNotes: e.target.value }))
                    }
                  />
                </label>
                <label>
                  种子角色名（首个）
                  <input
                    value={createForm.seedCharacters?.[0]?.name ?? ''}
                    onChange={(e) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        seedCharacters: [{ name: e.target.value }],
                      }))
                    }
                  />
                </label>
                <div className="row">
                  <button type="button" className="primary" onClick={() => void handleCreate()}>
                    创建
                  </button>
                  <button type="button" onClick={() => setCreating(false)}>
                    取消
                  </button>
                </div>
              </div>
            </section>
          ) : !activeBookId || !snapshot ? (
            <section className="panel">
              <div className="empty">从左侧选择一本书，或新建书籍开始。</div>
            </section>
          ) : (
            <>
              <div className="tabs">
                <button
                  type="button"
                  className={tab === 'outline' ? 'active' : ''}
                  onClick={() => setTab('outline')}
                >
                  大纲
                </button>
                <button
                  type="button"
                  className={tab === 'write' ? 'active' : ''}
                  onClick={() => setTab('write')}
                >
                  写章
                </button>
                <button
                  type="button"
                  className={tab === 'state' ? 'active' : ''}
                  onClick={() => setTab('state')}
                >
                  状态
                </button>
                <button
                  type="button"
                  className={tab === 'preview' ? 'active' : ''}
                  onClick={() => void openPreviewTab()}
                >
                  全书预览
                </button>
              </div>

              <section className="panel">
                {error ? <div className="banner error">{error}</div> : null}
                {info ? <div className="banner ok">{info}</div> : null}
                {embeddingHint ? (
                  <div className="banner warn" style={{ whiteSpace: 'pre-wrap' }}>
                    {embeddingHint}
                  </div>
                ) : null}
                {busy ? <div className="banner warn">{busy}</div> : null}

                {tab === 'outline' ? (
                  <>
                    <div className="row">
                      <strong>{snapshot.meta.title}</strong>
                      <span className="muted">
                        {outlineDraft?.locked ? '已锁定' : '未锁定'} · 现实向
                      </span>
                    </div>
                    <label>
                      生成 / 调整要求
                      <input
                        value={outlineGuidance}
                        onChange={(e) => setOutlineGuidance(e.target.value)}
                        placeholder="例如：加强家庭秘密线；或：把第 5–8 章节奏放慢"
                      />
                    </label>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void handleGenerateOutline()}
                      >
                        AI 生成大纲草案
                      </button>
                      <button
                        type="button"
                        disabled={!outlineDraft?.volumes.length}
                        onClick={() => void handleReviseOutline()}
                        title="基于当前大纲按上方要求整体调整"
                      >
                        AI 调整整份大纲
                      </button>
                      <button type="button" onClick={() => void handleSaveOutline(false)}>
                        保存
                      </button>
                      <button type="button" onClick={() => void handleSaveOutline(true)}>
                        锁定保存
                      </button>
                    </div>
                    <p className="muted" style={{ marginTop: 8 }}>
                      「生成」可从零起草；「调整整份」在现有大纲上按要求修改。单章可用卡片上的「AI
                      调整本章」。调整后需点保存才会写入磁盘。
                    </p>
                    <div style={{ marginTop: 14 }}>
                      {(outlineDraft?.volumes ?? []).map((volume) => (
                        <div key={volume.id} style={{ marginBottom: 16 }}>
                          <h3>
                            {volume.title}
                          </h3>
                          {volume.chapters.map((chapter) => (
                            <div key={chapter.id} className="outline-chapter">
                              <div className="row" style={{ marginBottom: 6 }}>
                                <strong style={{ flex: 1 }}>
                                  第 {chapter.chapterNumber} 章 · {chapter.title}
                                </strong>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleReviseOutlineChapter(chapter.chapterNumber)
                                  }
                                >
                                  AI 调整本章
                                </button>
                              </div>
                              <div>{chapter.beatSummary || '（无节拍）'}</div>
                              {chapter.targetEmotion ? (
                                <div className="muted">情绪：{chapter.targetEmotion}</div>
                              ) : null}
                              {chapter.conflict ? (
                                <div className="muted">冲突：{chapter.conflict}</div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ))}
                      {(outlineDraft?.volumes?.length ?? 0) === 0 ? (
                        <div className="empty">尚无大纲，点击生成草案。</div>
                      ) : null}
                    </div>
                    <details style={{ marginTop: 12 }}>
                      <summary>高级：编辑大纲 JSON</summary>
                      <textarea
                        style={{ minHeight: 220, marginTop: 8 }}
                        value={JSON.stringify(outlineDraft, null, 2)}
                        onChange={(e) => {
                          try {
                            setOutlineDraft(JSON.parse(e.target.value) as BookOutline)
                          } catch {
                            // keep typing
                          }
                        }}
                      />
                    </details>
                  </>
                ) : null}

                {tab === 'write' ? (
                  <>
                    <div className="row">
                      <label>
                        章节
                        <select
                          value={chapterNumber}
                          onChange={(e) => setChapterNumber(Number(e.target.value))}
                        >
                          {chapterOptions.map((num) => (
                            <option key={num} value={num}>
                              第 {num} 章
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="button" onClick={() => void handleAssemble()}>
                        预览组装上下文
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void handleWrite()}
                      >
                        生成草稿
                      </button>
                      {requestId ? (
                        <button type="button" onClick={() => void handleCancel()}>
                          取消
                        </button>
                      ) : null}
                    </div>
                    <label>
                      改稿意见（可选，再次生成时带入）
                      <textarea
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                      />
                    </label>
                    {assembled ? (
                      <details open style={{ marginTop: 10 }}>
                        <summary>
                          组装上下文
                          {assembled.degraded ? '（已降级）' : ''}
                        </summary>
                        <pre className="state-block">{assembled.fixedBlock}</pre>
                        {assembled.retrievalBlock ? (
                          <pre className="state-block">{assembled.retrievalBlock}</pre>
                        ) : null}
                      </details>
                    ) : null}
                    <h3 style={{ marginTop: 14 }}>草稿</h3>
                    <div className="draft-box">{streaming || '（等待生成）'}</div>
                    {warnings.length > 0 ? (
                      <div className="warn-list">
                        <strong>连续性告警</strong>
                        <ul>
                          {warnings.map((item, index) => (
                            <li key={`${item.code}-${index}`}>
                              [{item.severity}] {item.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {diffText ? (
                      <div className="diff-box">
                        <strong>StateDiff（可编辑）</strong>
                        <textarea
                          style={{ minHeight: 180, marginTop: 8 }}
                          value={diffText}
                          onChange={(e) => setDiffText(e.target.value)}
                        />
                      </div>
                    ) : null}
                    <div className="row" style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        className="primary"
                        disabled={!draft}
                        onClick={() => void handleAccept(false)}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={!draft}
                        onClick={() => void handleAccept(true)}
                      >
                        强制 Accept
                      </button>
                      <button
                        type="button"
                        disabled={!draft}
                        onClick={() => void handleReject()}
                      >
                        Reject
                      </button>
                    </div>
                  </>
                ) : null}

                {tab === 'state' ? (
                  <>
                    <div className="row">
                      <button
                        type="button"
                        onClick={() =>
                          activeBookId &&
                          void window.petAPI.novel.rebuildIndex(activeBookId).then((r) => {
                            setInfo(
                              `索引重建完成：${r.chapters} 章${r.embeddingOk ? '' : '（Embedding 未完整）'}`,
                            )
                            void refreshEmbedding()
                          })
                        }
                      >
                        重建书内索引
                      </button>
                    </div>
                    <div className="state-block">
                      <h3>伏笔（可编辑 JSON 后保存）</h3>
                      <textarea
                        id="promises-editor"
                        style={{ minHeight: 140 }}
                        defaultValue={JSON.stringify(snapshot.promises, null, 2)}
                        key={`promises-${snapshot.meta.updatedAt}`}
                      />
                      <div className="row">
                        <button
                          type="button"
                          onClick={() => {
                            if (!activeBookId) return
                            const el = document.getElementById(
                              'promises-editor',
                            ) as HTMLTextAreaElement | null
                            if (!el) return
                            try {
                              const parsed = JSON.parse(el.value)
                              void window.petAPI.novel
                                .savePromises(activeBookId, parsed)
                                .then(() => refreshBook(activeBookId))
                                .then(() => setInfo('伏笔已保存'))
                            } catch {
                              setError('伏笔 JSON 无效')
                            }
                          }}
                        >
                          保存伏笔
                        </button>
                      </div>
                    </div>
                    <div className="state-block">
                      <h3>Canon（可编辑 JSON 后保存）</h3>
                      <textarea
                        id="canon-editor"
                        style={{ minHeight: 140 }}
                        defaultValue={JSON.stringify(snapshot.canon, null, 2)}
                        key={`canon-${snapshot.meta.updatedAt}`}
                      />
                      <div className="row">
                        <button
                          type="button"
                          onClick={() => {
                            if (!activeBookId) return
                            const el = document.getElementById(
                              'canon-editor',
                            ) as HTMLTextAreaElement | null
                            if (!el) return
                            try {
                              const parsed = JSON.parse(el.value)
                              void window.petAPI.novel
                                .saveCanon(activeBookId, parsed)
                                .then(() => refreshBook(activeBookId))
                                .then(() => setInfo('Canon 已保存'))
                            } catch {
                              setError('Canon JSON 无效')
                            }
                          }}
                        >
                          保存 Canon
                        </button>
                      </div>
                    </div>
                    <div className="state-block">
                      <h3>角色（只读预览）</h3>
                      <pre>{JSON.stringify(snapshot.characters, null, 2)}</pre>
                    </div>
                    <div className="state-block">
                      <h3>关系</h3>
                      <pre>{JSON.stringify(snapshot.relationships, null, 2)}</pre>
                    </div>
                    <div className="state-block">
                      <h3>知情差</h3>
                      <pre>{JSON.stringify(snapshot.knowledge, null, 2)}</pre>
                    </div>
                    <div className="state-block">
                      <h3>时间线</h3>
                      <pre>{JSON.stringify(snapshot.timeline, null, 2)}</pre>
                    </div>
                    <div className="state-block">
                      <h3>Divergence</h3>
                      <pre>{JSON.stringify(snapshot.divergences, null, 2)}</pre>
                      {snapshot.divergences
                        .filter((item) => !item.resolved)
                        .map((item) => (
                          <div key={item.id} className="row">
                            <span>未处理：第{item.chapterNumber}章 {item.summary}</span>
                            <button
                              type="button"
                              onClick={() => {
                                const beat = window.prompt('回写到大纲的节拍摘要', item.summary)
                                if (!beat || !activeBookId) return
                                void window.petAPI.novel
                                  .resolveDivergenceRewrite(
                                    activeBookId,
                                    item.id,
                                    item.chapterNumber,
                                    beat,
                                  )
                                  .then(() => refreshBook(activeBookId))
                              }}
                            >
                              回写大纲
                            </button>
                          </div>
                        ))}
                    </div>
                  </>
                ) : null}

                {tab === 'preview' ? (
                  <>
                    <div className="row">
                      <strong>全书预览</strong>
                      <span className="muted">
                        {manuscript
                          ? `共 ${manuscript.chapterCount} 章 · 约 ${manuscript.wordCount} 字`
                          : '仅包含已 Accept 章节'}
                      </span>
                      <button type="button" onClick={() => activeBookId && void loadManuscript(activeBookId)}>
                        刷新
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void handleExport('markdown')}
                      >
                        导出 Markdown
                      </button>
                      <button type="button" onClick={() => void handleExport('html')}>
                        导出 HTML（Word 可开）
                      </button>
                      <button type="button" onClick={() => void handleExport('pdf')}>
                        导出 PDF
                      </button>
                    </div>
                    {previewBusy ? <div className="banner warn">{previewBusy}</div> : null}
                    {!manuscript || manuscript.chapterCount === 0 ? (
                      <div className="empty" style={{ marginTop: 12 }}>
                        尚无已接受章节。Accept 后再来预览与导出。
                      </div>
                    ) : (
                      <article className="manuscript-preview">
                        {manuscript.chapters.map((chapter) => (
                          <section key={chapter.chapterNumber} className="manuscript-chapter">
                            <h3>
                              第 {chapter.chapterNumber} 章 {chapter.title}
                            </h3>
                            <pre className="manuscript-body">{chapter.content}</pre>
                          </section>
                        ))}
                      </article>
                    )}
                  </>
                ) : null}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
