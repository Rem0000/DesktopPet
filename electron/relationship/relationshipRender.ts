import type {
  RelationshipPolicy,
  RelationshipStage,
  RelationshipState,
} from '../../src/chat/contracts'
import { STAGE_RANGE } from './relationshipStages'

export const RELATIONSHIP_STAGE_LABELS: Record<RelationshipStage, string> = {
  stranger: '刚认识的陌生人',
  acquaintance: '有几面之缘的熟人',
  friendly: '熟络的朋友',
  close: '交心的挚友',
  intimate: '无话不谈的生死之交',
}

/**
 * 阶段内三档默认"当下态度"描述：按该阶段内好感进度分为低/中/高，
 * 使描述在整条好感刻度上随拖动可见地变化（含两端阶段）。
 */
export const STAGE_TEMPERATURE: Record<
  RelationshipStage,
  { low: string; mid: string; high: string }
> = {
  stranger: {
    low: '还带着初识的客套与距离感，私密话题会礼貌回避，不会主动分享私事。',
    mid: '开始放下部分戒备，愿意多聊几句，好奇你的日常，但私密话题仍会回避。',
    high: '渐渐放下戒备，聊天变得自然，会主动找话题，不过私密话题仍点到为止。',
  },
  acquaintance: {
    low: '能自然闲聊，但还没到无话不谈的程度，玩笑有分寸。',
    mid: '渐趋熟络，会主动分享一些生活细节，玩笑也开始放得开。',
    high: '相处愉快，愿意聊更多心事，普通玩笑和私密话题都能接住。',
  },
  friendly: {
    low: '相处愉快，愿意分享日常，玩笑开得起，但还有些保留。',
    mid: '关系亲近，会主动分享心情与近况，玩笑放得比较开。',
    high: '很聊得来，愿意敞开心扉，私密话题也不再回避。',
  },
  close: {
    low: '很信任你，会主动分享心事与近况，私密话题较放得开。',
    mid: '无话不谈，愿意聊私事与心情，对你的玩笑几乎不设防。',
    high: '亲密无间，主动分享私事，还会反过来和你打趣。',
  },
  intimate: {
    low: '完全放得开，无话不谈，私密话题也愿意自然回应。',
    mid: '与你亲密无间，私密话题主动聊，还会互相打趣。',
    high: '生死之交，完全敞开，任何话题都能自然回应，还会反过来逗你。',
  },
}

type Tier = keyof typeof STAGE_TEMPERATURE[RelationshipStage]

/** 阶段内好感进度 → 低/中/高三档 */
function stageTier(state: RelationshipState): Tier {
  const [min, max] = STAGE_RANGE[state.stage]
  const span = max - min + 1
  const progress = Math.min(1, Math.max(0, (state.affinity - min) / span))
  if (progress < 1 / 3) return 'low'
  if (progress < 2 / 3) return 'mid'
  return 'high'
}

/**
 * 生效的"当下态度描述"：自定义 temperatureNote 优先；
 * 为空时按阶段 + 该阶段内好感进度回退（低/中/高三档），
 * 使描述在整条好感刻度上随变化可见地浮动。
 */
export function relationshipTemperature(state: RelationshipState): string {
  const custom = state.temperatureNote.trim()
  if (custom) return custom
  return STAGE_TEMPERATURE[state.stage][stageTier(state)]
}

/**
 * 关系块渲染：三种 policy 各产出一条自洽提示。
 * 底层状态（affinity/stage/temperatureNote）三模式共用，仅表述方式不同。
 */
export function renderRelationshipBlock(
  state: RelationshipState,
  policy: RelationshipPolicy,
): string {
  const temperature = relationshipTemperature(state)
  const label = RELATIONSHIP_STAGE_LABELS[state.stage]
  switch (policy) {
    case 'persona-first':
      // 不越权断言关系标签，只表达当下态度/语气，避免与人设中的既定关系打架
      return (
        `【你与用户的关系】当下相处状态：${temperature}` +
        `（你与人设中既定的关系设定为准，不被此状态改变。）`
      )
    case 'dynamic-first':
      return `【你与用户的关系】你们现在的关系：${label}。${temperature}`
    case 'layered':
    default:
      return (
        `【你与用户的关系】当下相处状态：你们${label}，${temperature}` +
        `（人设中写明的你与用户的既定关系如有，始终是你对这段关系的底色，不受当下状态改变；当下状态只反映近期相处。）`
      )
  }
}

/** 已生效演化覆盖：过去→现在句式，避免与 persona 原文打架 */
export function renderEvolutionOverlay(state: RelationshipState): string {
  const applied = state.evolutions.filter((item) => item.status === 'applied')
  if (applied.length === 0) return ''
  const lines = applied.map(
    (item) => `- 你曾「${item.personaQuote}」，但最近已经改为：${item.change}。`,
  )
  return `【近期关系演化】\n${lines.join('\n')}`
}

/** 完整关系层：关系块 + 已生效演化覆盖；空状态返回空串 */
export function buildRelationshipLayer(
  state: RelationshipState,
  policy: RelationshipPolicy,
): string {
  const block = renderRelationshipBlock(state, policy)
  const overlay = renderEvolutionOverlay(state)
  return overlay ? `${block}\n\n${overlay}` : block
}
