import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { ProviderRuntimeConfig } from '../../src/chat/contracts'
import type {
  AcceptChapterInput,
  BookOutline,
  CreateBookInput,
  NovelExportFormat,
  RejectChapterInput,
  ReviseChapterInput,
} from '../../src/novel/contracts'
import { ensureDataDirs, resolveDataSubpath } from '../projectPaths'
import { buildManuscriptHtmlDocument } from './novelManuscript'
import { NovelService, NovelServiceError } from './novelService'
import { NovelStoryStore } from './novelStoryStore'

let novelServiceRef: NovelService | null = null

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label}无效`)
  }
  return value.trim()
}

function requireCreateBook(raw: unknown): CreateBookInput {
  if (!raw || typeof raw !== 'object') throw new Error('建书参数无效')
  const value = raw as CreateBookInput
  if (typeof value.title !== 'string' || typeof value.premise !== 'string') {
    throw new Error('书名与前提必填')
  }
  return value
}

function requireOutline(raw: unknown): BookOutline {
  if (!raw || typeof raw !== 'object') throw new Error('大纲无效')
  return raw as BookOutline
}

function requireAccept(raw: unknown): AcceptChapterInput {
  if (!raw || typeof raw !== 'object') throw new Error('Accept 参数无效')
  const value = raw as AcceptChapterInput
  if (
    typeof value.bookId !== 'string' ||
    typeof value.chapterNumber !== 'number' ||
    typeof value.revision !== 'number' ||
    !value.diff ||
    typeof value.diff !== 'object'
  ) {
    throw new Error('Accept 参数不完整')
  }
  return value
}

export async function initializeNovelController(
  getRuntimeConfig: () => ProviderRuntimeConfig | null,
): Promise<NovelService> {
  await ensureDataDirs()
  const novelsDir = resolveDataSubpath('novels')
  const store = new NovelStoryStore(novelsDir)
  await store.initialize()
  const service = new NovelService(store, getRuntimeConfig)
  novelServiceRef = service

  ipcMain.handle('novel:books:list', () => service.listBooks())
  ipcMain.handle('novel:books:create', (_e, raw: unknown) =>
    service.createBook(requireCreateBook(raw)),
  )
  ipcMain.handle('novel:books:delete', (_e, rawId: unknown) =>
    service.deleteBook(requireId(rawId, '书籍标识')),
  )
  ipcMain.handle('novel:books:get', (_e, rawId: unknown) =>
    service.getSnapshot(requireId(rawId, '书籍标识')),
  )

  ipcMain.handle('novel:outline:get', (_e, rawId: unknown) =>
    service.getOutline(requireId(rawId, '书籍标识')),
  )
  ipcMain.handle(
    'novel:outline:save',
    (_e, rawId: unknown, rawOutline: unknown, lock?: unknown) =>
      service.saveOutline(
        requireId(rawId, '书籍标识'),
        requireOutline(rawOutline),
        Boolean(lock),
      ),
  )
  ipcMain.handle(
    'novel:outline:generate',
    async (_e, rawId: unknown, guidance?: unknown) =>
      service.generateOutline(
        requireId(rawId, '书籍标识'),
        typeof guidance === 'string' ? guidance : undefined,
      ),
  )
  ipcMain.handle(
    'novel:outline:revise-chapter',
    async (
      _e,
      rawId: unknown,
      chapterNumber: unknown,
      guidance: unknown,
      currentOutline?: unknown,
    ) => {
      if (typeof chapterNumber !== 'number') throw new Error('章节号无效')
      if (typeof guidance !== 'string' || !guidance.trim()) {
        throw new Error('修订说明不能为空')
      }
      try {
        return await service.reviseOutlineChapter(
          requireId(rawId, '书籍标识'),
          chapterNumber,
          guidance.trim(),
          currentOutline && typeof currentOutline === 'object'
            ? (currentOutline as BookOutline)
            : undefined,
        )
      } catch (error) {
        if (error instanceof NovelServiceError) throw new Error(error.message)
        throw error
      }
    },
  )
  ipcMain.handle(
    'novel:outline:revise',
    async (_e, rawId: unknown, guidance: unknown, currentOutline?: unknown) => {
      if (typeof guidance !== 'string' || !guidance.trim()) {
        throw new Error('调整要求不能为空')
      }
      try {
        return await service.reviseOutline(
          requireId(rawId, '书籍标识'),
          guidance.trim(),
          currentOutline && typeof currentOutline === 'object'
            ? (currentOutline as BookOutline)
            : undefined,
        )
      } catch (error) {
        if (error instanceof NovelServiceError) throw new Error(error.message)
        throw error
      }
    },
  )
  ipcMain.handle(
    'novel:divergence:resolve-rewrite',
    async (
      _e,
      rawBookId: unknown,
      divergenceId: unknown,
      chapterNumber: unknown,
      beatSummary: unknown,
    ) => {
      if (typeof chapterNumber !== 'number') throw new Error('章节号无效')
      if (typeof beatSummary !== 'string') throw new Error('节拍摘要无效')
      return service.resolveDivergenceAndRewriteOutline(
        requireId(rawBookId, '书籍标识'),
        requireId(divergenceId, 'Divergence 标识'),
        chapterNumber,
        beatSummary,
      )
    },
  )

  ipcMain.handle(
    'novel:chapter:assemble',
    (_e, rawId: unknown, chapterNumber: unknown) => {
      if (typeof chapterNumber !== 'number') throw new Error('章节号无效')
      return service.assemble(requireId(rawId, '书籍标识'), chapterNumber)
    },
  )

  ipcMain.handle(
    'novel:chapter:write',
    async (event, rawId: unknown, chapterNumber: unknown, feedback?: unknown) => {
      if (typeof chapterNumber !== 'number') throw new Error('章节号无效')
      try {
        return await service.writeChapter(
          requireId(rawId, '书籍标识'),
          chapterNumber,
          {
            send: (streamEvent) => {
              if (!event.sender.isDestroyed()) {
                event.sender.send('novel:stream', streamEvent)
              }
            },
          },
          typeof feedback === 'string' ? feedback : undefined,
        )
      } catch (error) {
        if (error instanceof NovelServiceError) throw new Error(error.message)
        throw error
      }
    },
  )

  ipcMain.handle('novel:chapter:cancel', (_e, rawRequestId: unknown) =>
    service.cancel(requireId(rawRequestId, '请求标识')),
  )

  ipcMain.handle('novel:chapter:accept', async (_e, raw: unknown) => {
    try {
      return await service.acceptChapter(requireAccept(raw))
    } catch (error) {
      if (error instanceof NovelServiceError) throw new Error(error.message)
      throw error
    }
  })

  ipcMain.handle('novel:chapter:reject', async (_e, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Reject 参数无效')
    const value = raw as RejectChapterInput
    return service.rejectChapter({
      bookId: requireId(value.bookId, '书籍标识'),
      chapterNumber: value.chapterNumber,
      revision: value.revision,
    })
  })

  ipcMain.handle(
    'novel:chapter:revise',
    async (event, raw: unknown) => {
      if (!raw || typeof raw !== 'object') throw new Error('改稿参数无效')
      const value = raw as ReviseChapterInput
      return service.reviseChapter(
        {
          bookId: requireId(value.bookId, '书籍标识'),
          chapterNumber: value.chapterNumber,
          feedback: String(value.feedback ?? ''),
          baseRevision: value.baseRevision,
        },
        {
          send: (streamEvent) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('novel:stream', streamEvent)
            }
          },
        },
      )
    },
  )

  ipcMain.handle('novel:index:rebuild', (_e, rawId: unknown) =>
    service.rebuildIndex(requireId(rawId, '书籍标识')),
  )
  ipcMain.handle('novel:embedding-status', () => service.getEmbeddingStatus())

  ipcMain.handle('novel:manuscript:get', (_e, rawId: unknown) =>
    service.getManuscript(requireId(rawId, '书籍标识')),
  )

  ipcMain.handle(
    'novel:manuscript:export',
    async (event, rawId: unknown, rawFormat: unknown) => {
      const bookId = requireId(rawId, '书籍标识')
      const format =
        rawFormat === 'pdf' || rawFormat === 'html' || rawFormat === 'markdown'
          ? (rawFormat as NovelExportFormat)
          : null
      if (!format) throw new Error('导出格式无效')

      try {
        const manuscript = await service.getManuscript(bookId)
        if (manuscript.chapterCount === 0) {
          return { ok: false as const, error: '尚无已接受章节，无法导出' }
        }

        const filters =
          format === 'markdown'
            ? [{ name: 'Markdown', extensions: ['md'] }]
            : format === 'html'
              ? [{ name: 'HTML（可用 Word 打开）', extensions: ['html', 'htm'] }]
              : [{ name: 'PDF', extensions: ['pdf'] }]

        const parent = BrowserWindow.fromWebContents(event.sender)
        const save = await dialog.showSaveDialog({
          ...(parent ? { browserWindow: parent } : {}),
          title: '导出全书',
          defaultPath: service.suggestExportFileName(manuscript.title, format),
          filters,
        })
        if (save.canceled || !save.filePath) {
          return { ok: false as const, canceled: true as const }
        }

        if (format === 'markdown') {
          await writeFile(save.filePath, manuscript.markdown, 'utf8')
          return { ok: true as const, format, filePath: save.filePath }
        }

        const html = buildManuscriptHtmlDocument(manuscript)
        if (format === 'html') {
          await writeFile(save.filePath, html, 'utf8')
          return { ok: true as const, format, filePath: save.filePath }
        }

        const pdfWindow = new BrowserWindow({
          show: false,
          width: 900,
          height: 1200,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        })
        try {
          await pdfWindow.loadURL(
            `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
          )
          const pdf = await pdfWindow.webContents.printToPDF({
            printBackground: true,
            preferCSSPageSize: true,
            margins: { marginType: 'default' },
          })
          await writeFile(save.filePath, pdf)
          return { ok: true as const, format, filePath: save.filePath }
        } finally {
          if (!pdfWindow.isDestroyed()) pdfWindow.destroy()
        }
      } catch (error) {
        if (error instanceof NovelServiceError) {
          return { ok: false as const, error: error.message }
        }
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : '导出失败',
        }
      }
    },
  )

  // 状态面板手工纠错走 snapshot 内实体的专用保存——通过 upsert 角色等
  ipcMain.handle(
    'novel:state:upsert-character',
    async (_e, rawBookId: unknown, character: unknown) => {
      const bookId = requireId(rawBookId, '书籍标识')
      if (!character || typeof character !== 'object') throw new Error('角色无效')
      return store.upsertCharacter(bookId, character as never)
    },
  )
  ipcMain.handle(
    'novel:state:save-relationships',
    async (_e, rawBookId: unknown, relationships: unknown) => {
      if (!Array.isArray(relationships)) throw new Error('关系列表无效')
      return store.saveRelationships(requireId(rawBookId, '书籍标识'), relationships as never)
    },
  )
  ipcMain.handle(
    'novel:state:save-knowledge',
    async (_e, rawBookId: unknown, entries: unknown) => {
      if (!Array.isArray(entries)) throw new Error('知情列表无效')
      return store.saveKnowledge(requireId(rawBookId, '书籍标识'), entries as never)
    },
  )
  ipcMain.handle(
    'novel:state:save-timeline',
    async (_e, rawBookId: unknown, events: unknown) => {
      if (!Array.isArray(events)) throw new Error('时间线无效')
      return store.saveTimeline(requireId(rawBookId, '书籍标识'), events as never)
    },
  )
  ipcMain.handle(
    'novel:state:save-promises',
    async (_e, rawBookId: unknown, promises: unknown) => {
      if (!Array.isArray(promises)) throw new Error('伏笔列表无效')
      return store.savePromises(requireId(rawBookId, '书籍标识'), promises as never)
    },
  )
  ipcMain.handle(
    'novel:state:save-canon',
    async (_e, rawBookId: unknown, facts: unknown) => {
      if (!Array.isArray(facts)) throw new Error('Canon 无效')
      return store.saveCanon(requireId(rawBookId, '书籍标识'), facts as never)
    },
  )

  return service
}

export function getNovelService(): NovelService | null {
  return novelServiceRef
}
