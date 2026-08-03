import type { RelationshipStage } from '../../src/chat/contracts'

/** 阶段顺序（低→高） */
export const STAGE_ORDER: RelationshipStage[] = [
  'stranger',
  'acquaintance',
  'friendly',
  'close',
  'intimate',
]

/** 阶段含阈值：取 affinity 命中的最高阶段 */
export const STAGE_MIN: Record<RelationshipStage, number> = {
  stranger: 0,
  acquaintance: 30,
  friendly: 50,
  close: 70,
  intimate: 90,
}

/** 各阶段好感温度取值范围 */
export const STAGE_RANGE: Record<RelationshipStage, [number, number]> = {
  stranger: [0, 29],
  acquaintance: [30, 49],
  friendly: [50, 69],
  close: [70, 89],
  intimate: [90, 100],
}

/** 好感 → 阶段（纯函数，主进程与渲染端共用） */
export function stageForAffinity(affinity: number): RelationshipStage {
  let stage: RelationshipStage = 'stranger'
  for (const candidate of STAGE_ORDER) {
    if (affinity >= STAGE_MIN[candidate]) stage = candidate
  }
  return stage
}
