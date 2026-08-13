// 智慧猜谜技能的工具(第三层:工具与数据池)
// 本文件在技能命中时才被主进程加载。
// 游戏状态按会话隔离:不同会话的猜数字局互不干扰,同一会话多轮续局。
// 工具对象遵循主进程 AgentTool 契约:name / description / parameters / execute。
const MAX_ATTEMPTS = 10

/** sessionId → { secret, attempts, running } */
const games = new Map()

function getGame(sessionId) {
  return games.get(sessionId)
}

function startGame(sessionId) {
  const secret = 1 + Math.floor(Math.random() * 100)
  const game = { secret, attempts: 0, running: true }
  games.set(sessionId, game)
  return game
}

function endGame(sessionId) {
  games.delete(sessionId)
}

function sessionKeyOf(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const key = typeof raw.sourceSessionId === 'string' && raw.sourceSessionId.trim()
    ? raw.sourceSessionId.trim()
    : ''
  return key
}

module.exports = {
  createTools() {
    return [
      {
        name: 'generate_secret',
        description:
          '开始一场 1-100 猜数字游戏:为该会话生成谜底并重置已猜次数。仅在用户明确邀请玩猜数字游戏时调用。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        async execute(input) {
          const sessionId = sessionKeyOf(input)
          if (!sessionId) return { ok: false, error: '缺少会话标识,无法开始游戏' }
          // 幂等仅适用于"尚未猜过"的新开局(attempts=0):避免同一开局请求被
          // 重复调用时重抽谜底。一旦猜过或上一局结束/残留,一律开新局,
          // 保证新一局的猜测次数从 1 重新开始。
          const existing = getGame(sessionId)
          const game =
            existing && existing.running && existing.attempts === 0
              ? existing
              : startGame(sessionId)
          return { ok: true, secret: game.secret, range: '1-100', maxAttempts: MAX_ATTEMPTS }
        },
      },
      {
        name: 'compare_guess',
        description:
          '提交一次猜测,与该会话当前谜底比较,返回 偏大(high)/偏小(low)/猜中(correct)。必须在 generate_secret 之后调用。',
        parameters: {
          type: 'object',
          properties: {
            guess: { type: 'number', description: '用户猜的数字' },
          },
          required: ['guess'],
          additionalProperties: false,
        },
        async execute(input) {
          const sessionId = sessionKeyOf(input)
          const game = sessionId ? getGame(sessionId) : undefined
          if (!game || !game.running) {
            return { ok: false, error: '游戏尚未开始,请先调用 generate_secret' }
          }
          const n = Number(input?.guess)
          if (!Number.isFinite(n)) {
            return { status: 'invalid', message: '请输入一个数字哦～' }
          }
          game.attempts += 1
          let status
          if (n < game.secret) status = 'low'
          else if (n > game.secret) status = 'high'
          else status = 'correct'
          const result = { status, attempts: game.attempts }
          if (status === 'correct' || game.attempts >= MAX_ATTEMPTS) {
            result.gameOver = true
            if (status !== 'correct') {
              result.secret = game.secret
              result.message = `已猜 ${MAX_ATTEMPTS} 次没猜中,我泄密啦:答案是 ${game.secret}。再陪我玩一次嘛～`
            }
            endGame(sessionId)
          }
          return { ok: true, ...result }
        },
      },
      {
        name: 'end_game',
        description:
          '用户中途退出猜数字游戏时调用,立即终止该会话的游戏状态。用户明确说「不玩了/算了/结束」时调用。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        async execute(input) {
          const sessionId = sessionKeyOf(input)
          if (sessionId) endGame(sessionId)
          return { ok: true, ended: true }
        },
      },
    ]
  },
  // 供测试/调试读取
  _getState(sessionId) {
    return getGame(sessionId)
  },
}
