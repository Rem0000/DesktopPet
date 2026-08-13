// 共情回声技能的工具(第三层:工具与数据池)
// 本文件在技能命中时才被主进程加载;模块级内存保存最近情绪标签,用于后续关怀铺垫。
// 工具对象遵循主进程 AgentTool 契约:name / description / parameters / execute。
let lastEmotion = ''

function setLastEmotion(emotion) {
  lastEmotion = emotion
}

module.exports = {
  createTools() {
    return [
      {
        name: 'record_emotion',
        description:
          '记录用户当前的情绪标签(如 疲惫/烦躁/开心/悲伤/焦虑),供后续更贴心的关怀铺垫。仅在共情场景命中时调用,普通闲聊不要调用。',
        parameters: {
          type: 'object',
          properties: {
            emotion: { type: 'string', description: '本次识别的情绪标签' },
          },
          required: ['emotion'],
          additionalProperties: false,
        },
        async execute(input) {
          const emotion = typeof input?.emotion === 'string' ? input.emotion.slice(0, 20) : ''
          if (!emotion) throw new Error('缺少情绪标签参数 emotion')
          setLastEmotion(emotion)
          return { ok: true, emotion }
        },
      },
    ]
  },
  // 供测试/调试读取
  _getLastEmotion() {
    return lastEmotion
  },
}
