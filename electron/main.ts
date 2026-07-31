import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  dialog,
  screen,
  Notification,
} from 'electron'
import path from 'node:path'
import type { SpeechBubblePayload } from '../src/chat/contracts'
import { importLive2DPackage, refreshLive2DSessionPaths } from './live2dBind'
import type { ImportedLive2DPackage } from './live2dBind'
import {
  DEFAULT_LIVE2D_PACKAGE_ID,
  deleteImportedLive2DPackage,
  isPathUnderImportDir,
  listImportedLive2DPackages,
  packageFromImportDir,
  packageFromPackageId,
  readPackagePersona,
  resolvePackageIdFromDir,
  writePackagePersona,
} from './live2dLibrary'
import {
  installPetAssetHandler,
  registerPetAssetScheme,
} from './petAssetProtocol'
import {
  cascadeDeleteSessionsForPackage,
  getChatRuntimeProviderConfig,
  initializeChatController,
  setActiveLive2DDirGetter,
  setReminderPresenters,
  startReminderScheduler,
} from './chat/chatController'
import type { ChatService } from './chat/chatService'
import { initializeNovelController } from './novel/novelController'
import { ensureDataDirs, resolveDataSubpath } from './projectPaths'

registerPetAssetScheme()

let mainWindow: BrowserWindow | null = null
let managerWindow: BrowserWindow | null = null
let chatWindow: BrowserWindow | null = null
let novelWindow: BrowserWindow | null = null
let chatService: ChatService | null = null
let tray: Tray | null = null
let clickThrough = false
let cursorFocusTimer: ReturnType<typeof setInterval> | null = null
let activeLive2DDir: string | null = null
let bubbleSavedClickThrough: boolean | null = null
const CURSOR_FOCUS_MS = 40

const isDev = !app.isPackaged

const PET_WIDTH = 360
const PET_HEIGHT = 420

/** 取「屏幕坐标原点」所在显示器，避免 Electron primary 与 Windows 主屏不一致 */
function preferredWorkArea() {
  const originDisplay = screen.getDisplayNearestPoint({ x: 0, y: 0 })
  return originDisplay.workArea
}

function primaryPetBounds() {
  const workArea = preferredWorkArea()
  return {
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x: Math.round(workArea.x + workArea.width - PET_WIDTH - 24),
    y: Math.round(workArea.y + workArea.height - PET_HEIGHT - 24),
  }
}

/** 把窗口拉回主屏右下角（避免多屏/越界后“桌宠消失”） */
function resetPetWindowPosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const b = primaryPetBounds()
  // 先用 setPosition + setSize，兼容部分 DPI/多屏下 setBounds 漂移
  mainWindow.setSize(b.width, b.height)
  mainWindow.setPosition(b.x, b.y)
  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
  console.log('[pet-window] reset bounds', b, {
    displays: screen.getAllDisplays().map((d) => ({
      id: d.id,
      bounds: d.bounds,
      workArea: d.workArea,
      scale: d.scaleFactor,
    })),
  })
}

function createWindow() {
  const bounds = primaryPetBounds()

  mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'Desktop Pet',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  })

  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.on('console-message', (event) => {
    // 新 API：从 Event 对象取字段；仅转发 error，避免把 Electron 自身的
    // Security Warning（warning 级）再次刷到主进程控制台
    if (event.level === 'error') {
      console.error('[renderer]', event.message)
    }
  })

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[did-fail-load]', code, desc, url)
    resetPetWindowPosition()
    mainWindow?.show()
  })

  mainWindow.once('ready-to-show', () => {
    resetPetWindowPosition()
    mainWindow?.show()
  })

  // fallback：个别环境 ready-to-show 不触发
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      resetPetWindowPosition()
      mainWindow.show()
    }
  }, 2500)

  // 部分环境拖到副屏/外屏后容易“找不到”，显示器变化时自动钳回可见区
  screen.on('display-metrics-changed', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const [x, y] = mainWindow.getPosition()
    const { width, height } = mainWindow.getBounds()
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return (
        x + width > a.x &&
        y + height > a.y &&
        x < a.x + a.width &&
        y < a.y + a.height
      )
    })
    if (!visible) resetPetWindowPosition()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

type PetMenuState = {
  busy?: boolean
  hasLive2d?: boolean
  alwaysOnTop?: boolean
  soundEnabled?: boolean
  motionGroups?: Array<{ name: string; count: number; hasSound: boolean }>
  expressions?: string[]
  activeModelDir?: string
}

function buildPetMenuTemplate(state: PetMenuState = {}): Electron.MenuItemConstructorOptions[] {
  const busy = Boolean(state.busy)
  const hasLive2d = Boolean(state.hasLive2d)
  const alwaysOnTop = state.alwaysOnTop ?? true
  const soundEnabled = state.soundEnabled ?? true
  const motionGroups = state.motionGroups ?? []
  const expressions = state.expressions ?? []

  if (state.activeModelDir) activeLive2DDir = state.activeModelDir

  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: '导入 Live2D 文件夹',
      enabled: !busy,
      click: () => mainWindow?.webContents.send('live2d:request-import', 'folder'),
    },
    {
      label: '管理已导入模型',
      click: () => openManagerWindow(),
    },
  ]

  if (hasLive2d) {
    if (motionGroups.length > 0) {
      items.push({
        label: '播放动作',
        submenu: motionGroups.map((g) => ({
          label: `${g.name}（${g.count}${g.hasSound ? ' · 音' : ''}）`,
          click: () =>
            mainWindow?.webContents.send('live2d:play-motion', {
              group: g.name,
            }),
        })),
      })
    }
    if (expressions.length > 0) {
      items.push({
        label: 'Live2D 表情',
        submenu: [
          ...expressions.map((name) => ({
            label: name,
            click: () =>
              mainWindow?.webContents.send('live2d:play-expression', { name }),
          })),
          { type: 'separator' as const },
          {
            label: '随机表情',
            click: () =>
              mainWindow?.webContents.send('live2d:play-expression', {
                name: null,
              }),
          },
        ],
      })
    }
    items.push({
      label: '动作声音',
      type: 'checkbox',
      checked: soundEnabled,
      click: (item) => {
        mainWindow?.webContents.send('live2d:set-sound', item.checked)
      },
    })
  }

  items.push(
    {
      label: '聊天',
      click: () => openChatWindow(),
    },
    {
      label: '小说工坊',
      click: () => openNovelWindow(),
    },
    { type: 'separator' },
    {
      label: '显示 / 隐藏',
      click: () => {
        if (!mainWindow) return
        if (mainWindow.isVisible()) mainWindow.hide()
        else {
          resetPetWindowPosition()
          mainWindow.show()
        }
      },
    },
    {
      label: '复位到主屏右下角',
      click: () => resetPetWindowPosition(),
    },
    {
      label: '置顶',
      type: 'checkbox',
      checked: alwaysOnTop,
      click: (item) => {
        mainWindow?.setAlwaysOnTop(item.checked, 'screen-saver')
      },
    },
    {
      label: '鼠标穿透',
      type: 'checkbox',
      checked: clickThrough,
      click: (item) => {
        clickThrough = item.checked
        mainWindow?.setIgnoreMouseEvents(clickThrough, { forward: true })
        mainWindow?.webContents.send('pet:click-through', clickThrough)
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  )

  return items
}

function openManagerWindow() {
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.focus()
    managerWindow.webContents.send('live2d:library-changed')
    return
  }

  managerWindow = new BrowserWindow({
    width: 440,
    height: 520,
    minWidth: 360,
    minHeight: 400,
    title: '已导入 Live2D 模型',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  })

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void managerWindow.loadURL(
      `${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/manager.html`,
    )
  } else {
    void managerWindow.loadFile(path.join(__dirname, '../dist/manager.html'))
  }

  managerWindow.on('closed', () => {
    managerWindow = null
  })
}

function openChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (!chatWindow.isVisible()) chatWindow.show()
    chatWindow.focus()
    return
  }

  chatWindow = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 620,
    minHeight: 460,
    title: '与桌宠聊天',
    autoHideMenuBar: true,
    backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const senderId = chatWindow.webContents.id
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void chatWindow.loadURL(
      `${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/chat.html`,
    )
  } else {
    void chatWindow.loadFile(path.join(__dirname, '../dist/chat.html'))
  }

  chatWindow.on('closed', () => {
    chatService?.cancelForSender(senderId)
    chatWindow = null
  })
}

function openNovelWindow() {
  if (novelWindow && !novelWindow.isDestroyed()) {
    if (!novelWindow.isVisible()) novelWindow.show()
    novelWindow.focus()
    return
  }

  novelWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    title: '小说工坊',
    autoHideMenuBar: true,
    backgroundColor: '#f7f4ef',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void novelWindow.loadURL(
      `${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/novel.html`,
    )
  } else {
    void novelWindow.loadFile(path.join(__dirname, '../dist/novel.html'))
  }

  novelWindow.on('closed', () => {
    novelWindow = null
  })
}

function notifyLibraryChanged() {
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.webContents.send('live2d:library-changed')
  }
}

function buildSessionFromPackage(
  pkg: ImportedLive2DPackage,
  packageId: string,
) {
  return {
    modelUrl: pkg.modelUrl,
    model3Path: pkg.model3Path,
    outDir: pkg.dir,
    source: 'imported' as const,
    catalog: pkg.catalog,
    runtime: pkg.runtime,
    packageId,
  }
}

function applyPackageSession(pkg: ImportedLive2DPackage, packageId?: string) {
  activeLive2DDir = pkg.dir
  const resolvedPackageId =
    packageId ?? resolvePackageIdFromDir(pkg.dir) ?? DEFAULT_LIVE2D_PACKAGE_ID
  const session = buildSessionFromPackage(pkg, resolvedPackageId)
  mainWindow?.webContents.send('live2d:session', session)
  chatWindow?.webContents.send('live2d:active-package', {
    packageId: resolvedPackageId,
  })
  return session
}

function popupPetContextMenu(state: PetMenuState = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const menu = Menu.buildFromTemplate(buildPetMenuTemplate(state))
  menu.popup({ window: mainWindow })
}

function createTray() {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon.isEmpty() ? nativeImage.createFromDataURL(trayPng) : icon)
  tray.setToolTip('Desktop Pet')
  tray.setContextMenu(Menu.buildFromTemplate(buildPetMenuTemplate()))
  tray.on('click', () => {
    resetPetWindowPosition()
  })
  tray.on('double-click', () => {
    resetPetWindowPosition()
  })
}

const trayPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVQ4T2NkYGD4z0ABYBzVMKoBBg0wGiCjYTAaBqNhMBoGIzQMAACSHwQJm1G0WwAAAABJRU5ErkJggg=='

function startCursorFocusTracking() {
  if (cursorFocusTimer) return
  cursorFocusTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const point = screen.getCursorScreenPoint()
    mainWindow.webContents.send('live2d:cursor-point', {
      x: point.x,
      y: point.y,
    })
  }, CURSOR_FOCUS_MS)
}

function stopCursorFocusTracking() {
  if (!cursorFocusTimer) return
  clearInterval(cursorFocusTimer)
  cursorFocusTimer = null
}

function prepareBubbleInteraction(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  // 展示气泡时临时关闭点击穿透，保证气泡可点；不扩窗
  if (bubbleSavedClickThrough === null) {
    bubbleSavedClickThrough = clickThrough
    if (clickThrough) {
      clickThrough = false
      mainWindow.setIgnoreMouseEvents(false)
    }
  }
}

function restoreAfterBubble(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    bubbleSavedClickThrough = null
    return
  }
  if (bubbleSavedClickThrough !== null) {
    clickThrough = bubbleSavedClickThrough
    mainWindow.setIgnoreMouseEvents(clickThrough, { forward: true })
    bubbleSavedClickThrough = null
  }
}

function presentSpeechBubble(payload: SpeechBubblePayload): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  prepareBubbleInteraction()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.webContents.send('pet:show-bubble', payload)
}

function dismissSpeechBubble(): void {
  restoreAfterBubble()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pet:agent-state', 'idle')
  }
}

function chooseBubbleTailSide(): 'bl' | 'br' {
  if (!mainWindow || mainWindow.isDestroyed()) return 'br'
  const bounds = mainWindow.getBounds()
  const workArea = screen.getDisplayMatching(bounds).workArea
  const leftSpace = bounds.x - workArea.x
  const rightSpace = workArea.x + workArea.width - (bounds.x + bounds.width)
  // 靠右 → 气泡向左展开 → 右下三角；靠左 → 左下三角
  return rightSpace <= leftSpace ? 'br' : 'bl'
}

function registerIpc() {
  ipcMain.handle('live2d:open-model', async () => {
    const result = await dialog.showOpenDialog({
      title:
        '选择 Live2D 模型文件夹（Cubism 4 model3.json 或 Cubism 2 model.json，含贴图/动作/voice）',
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const imported = await importLive2DPackage(result.filePaths[0])
    const packageId = resolvePackageIdFromDir(imported.dir)
    applyPackageSession(imported, packageId ?? undefined)
    notifyLibraryChanged()
    return imported
  })

  ipcMain.handle('live2d:apply-default', async () => {
    const pkg = packageFromPackageId(DEFAULT_LIVE2D_PACKAGE_ID)
    if (!pkg) return null
    return applyPackageSession(pkg, DEFAULT_LIVE2D_PACKAGE_ID)
  })

  ipcMain.handle('live2d:persona:get', (_e, packageId: unknown) => {
    if (typeof packageId !== 'string' || !packageId.trim()) {
      return { ok: false as const, error: '包标识无效' }
    }
    return { ok: true as const, content: readPackagePersona(packageId.trim()) }
  })

  ipcMain.handle(
    'live2d:persona:set',
    (_e, packageId: unknown, content: unknown) => {
      if (typeof packageId !== 'string' || !packageId.trim()) {
        return { ok: false, error: '包标识无效' }
      }
      if (typeof content !== 'string') {
        return { ok: false, error: '人设内容格式无效' }
      }
      return writePackagePersona(packageId.trim(), content)
    },
  )

  ipcMain.handle('live2d:resolve-package-id', (_e, dir: unknown) => {
    if (typeof dir !== 'string' || !dir.trim()) return null
    return resolvePackageIdFromDir(dir)
  })

  ipcMain.handle('live2d:apply-session', async (_e, session: unknown) => {
    if (session && typeof session === 'object' && session !== null) {
      const s = session as { outDir?: string; model3Path?: string }
      activeLive2DDir = s.outDir ?? (s.model3Path ? path.dirname(s.model3Path) : null)
    }
    mainWindow?.webContents.send('live2d:session', session)
    return true
  })

  ipcMain.handle(
    'live2d:refresh-session',
    async (_e, session: { model3Path: string; outDir?: string }) => {
      const refreshed = refreshLive2DSessionPaths(session)
      if (refreshed) activeLive2DDir = refreshed.dir
      return refreshed
    },
  )

  ipcMain.handle('live2d:set-cursor-focus', (_e, enabled: boolean) => {
    if (enabled) startCursorFocusTracking()
    else stopCursorFocusTracking()
  })

  ipcMain.handle('live2d:library-list', () => listImportedLive2DPackages())

  ipcMain.handle('live2d:library-active-dir', () => activeLive2DDir)

  ipcMain.handle('live2d:library-set-active-dir', (_e, dir: string | null) => {
    activeLive2DDir = dir
  })

  ipcMain.handle('live2d:library-delete', async (_e, dir: string) => {
    const packageId = resolvePackageIdFromDir(dir)
    const wasActive =
      Boolean(activeLive2DDir) &&
      (isPathUnderImportDir(activeLive2DDir!, dir) ||
        path.resolve(activeLive2DDir!) === path.resolve(dir))
    const result = deleteImportedLive2DPackage(dir)
    if (result.ok && packageId) {
      await cascadeDeleteSessionsForPackage(packageId)
    }
    if (wasActive && result.ok) {
      stopCursorFocusTracking()
      const defaultPkg = packageFromPackageId(DEFAULT_LIVE2D_PACKAGE_ID)
      if (defaultPkg) applyPackageSession(defaultPkg, DEFAULT_LIVE2D_PACKAGE_ID)
    }
    notifyLibraryChanged()
    return { ...result, wasActive }
  })

  ipcMain.handle('live2d:library-apply', async (_e, dir: string) => {
    const pkg = packageFromImportDir(dir)
    if (!pkg) return null
    const packageId = resolvePackageIdFromDir(dir)
    const session = applyPackageSession(pkg, packageId ?? undefined)
    notifyLibraryChanged()
    return session
  })

  ipcMain.handle('live2d:open-manager', () => {
    openManagerWindow()
  })

  ipcMain.handle('live2d:notify-library-changed', () => {
    notifyLibraryChanged()
  })

  ipcMain.handle('window:set-click-through', (_e, enabled: boolean) => {
    clickThrough = enabled
    mainWindow?.setIgnoreMouseEvents(enabled, { forward: true })
  })

  ipcMain.handle('pet:show-context-menu', (_e, state?: PetMenuState) => {
    popupPetContextMenu({
      ...state,
      alwaysOnTop: mainWindow?.isAlwaysOnTop() ?? true,
    })
  })

  ipcMain.on('window:drag-move', (_e, { dx, dy }: { dx: number; dy: number }) => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    mainWindow.setPosition(Math.round(x + dx), Math.round(y + dy))
  })

  ipcMain.handle('pet:dismiss-bubble', () => {
    dismissSpeechBubble()
  })

  ipcMain.handle('pet:bubble-tail-side', () => chooseBubbleTailSide())
}

app.whenReady().then(async () => {
  installPetAssetHandler()
  registerIpc()
  await ensureDataDirs()
  app.setPath('logs', resolveDataSubpath('logs'))
  chatService = await initializeChatController((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pet:agent-state', state)
    }
  })
  await initializeNovelController(() => getChatRuntimeProviderConfig())
  setActiveLive2DDirGetter(() => activeLive2DDir)
  setReminderPresenters({
    presentBubble: presentSpeechBubble,
    isPetVisible: () =>
      Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    notifySystem: (title, body) => {
      if (!Notification.isSupported()) return
      const notification = new Notification({ title, body })
      notification.on('click', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        if (!mainWindow.isVisible()) mainWindow.show()
        mainWindow.focus()
      })
      notification.show()
    },
  })
  createWindow()
  createTray()
  startReminderScheduler()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopCursorFocusTracking()
  if (process.platform !== 'darwin') app.quit()
})
