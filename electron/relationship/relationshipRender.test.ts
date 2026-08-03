import { describe, expect, it } from 'vitest'
import type { RelationshipState } from '../../src/chat/contracts'
import {
  buildRelationshipLayer,
  RELATIONSHIP_STAGE_LABELS,
  relationshipTemperature,
  renderEvolutionOverlay,
  STAGE_TEMPERATURE,
} from './relationshipRender'

function state(overrides: Partial<RelationshipState>): RelationshipState {
  return {
    policy: 'layered',
    affinity: 20,
    stage: 'stranger',
    temperatureNote: '',
    evolutions: [],
    history: [],
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('relationshipRender', () => {
  it('layered：底子(固有设定) + 当下相处状态，自洽单条', () => {
    const block = buildRelationshipLayer(
      state({ stage: 'stranger', affinity: 5 }),
      'layered',
    )
    expect(block).toContain('当下相处状态：你们刚认识的陌生人')
    expect(block).toContain('人设中写明的你与用户的既定关系如有，始终是你对这段关系的底色')
    expect(block).toContain('私密话题会礼貌回避')
  })

  it('persona-first：不越权断言关系标签，只表达当下', () => {
    const block = buildRelationshipLayer(
      state({ stage: 'intimate', temperatureNote: '今天心情不错' }),
      'persona-first',
    )
    expect(block).toContain('你与人设中既定的关系设定为准')
    expect(block).toContain('今天心情不错')
    // persona-first 不出现阶段标签断言
    expect(block).not.toContain('无话不谈的生死之交')
  })

  it('dynamic-first：完整描述当前关系', () => {
    const block = buildRelationshipLayer(
      state({ stage: 'close', temperatureNote: '' }),
      'dynamic-first',
    )
    expect(block).toContain(`你们现在的关系：${RELATIONSHIP_STAGE_LABELS.close}`)
    expect(block).toContain(STAGE_TEMPERATURE.close.low)
  })

  it('temperatureNote 优先，空则按阶段内好感进度回退低/中/高段', () => {
    expect(relationshipTemperature(state({ temperatureNote: '  今天很冷淡  ' }))).toBe(
      '今天很冷淡',
    )
    // friendly 阶段内三档
    expect(
      relationshipTemperature(state({ stage: 'friendly', affinity: 55 })),
    ).toBe(STAGE_TEMPERATURE.friendly.low)
    expect(
      relationshipTemperature(state({ stage: 'friendly', affinity: 60 })),
    ).toBe(STAGE_TEMPERATURE.friendly.mid)
    expect(
      relationshipTemperature(state({ stage: 'friendly', affinity: 66 })),
    ).toBe(STAGE_TEMPERATURE.friendly.high)
  })

  it('好感在阶段内浮动时自动描述随之变化（含低段阶段）', () => {
    const low = relationshipTemperature(
      state({ stage: 'acquaintance', affinity: 31 }),
    )
    const mid = relationshipTemperature(
      state({ stage: 'acquaintance', affinity: 40 }),
    )
    const high = relationshipTemperature(
      state({ stage: 'acquaintance', affinity: 49 }),
    )
    expect(low).toBe(STAGE_TEMPERATURE.acquaintance.low)
    expect(mid).toBe(STAGE_TEMPERATURE.acquaintance.mid)
    expect(high).toBe(STAGE_TEMPERATURE.acquaintance.high)
    expect(new Set([low, mid, high]).size).toBe(3)
  })

  it('两端阶段（stranger/intimate）内部也会随好感分档变化', () => {
    const strangerLow = relationshipTemperature(
      state({ stage: 'stranger', affinity: 5 }),
    )
    const strangerHigh = relationshipTemperature(
      state({ stage: 'stranger', affinity: 25 }),
    )
    expect(strangerLow).not.toBe(strangerHigh)

    const intimateLow = relationshipTemperature(
      state({ stage: 'intimate', affinity: 90 }),
    )
    const intimateHigh = relationshipTemperature(
      state({ stage: 'intimate', affinity: 100 }),
    )
    expect(intimateLow).not.toBe(intimateHigh)
  })

  it('演化覆盖为空时返回空串，有 applied 时用过去→现在句式', () => {
    expect(
      renderEvolutionOverlay(state({})),
    ).toBe('')
    const overlay = renderEvolutionOverlay(
      state({
        evolutions: [
          {
            id: 'e1',
            personaQuote: '烟瘾重',
            change: '已经戒掉',
            evidence: '证据',
            status: 'applied',
            createdAt: '2026-08-01T00:00:00.000Z',
          },
          {
            id: 'e2',
            personaQuote: '不爱主动说话',
            change: '话变得多了',
            evidence: '证据',
            status: 'proposed',
            createdAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      }),
    )
    expect(overlay).toContain('你曾「烟瘾重」，但最近已经改为：已经戒掉。')
    // 未生效的 proposed 不进入覆盖
    expect(overlay).not.toContain('话变得多了')
  })

  it('buildRelationshipLayer 合并关系块与演化覆盖', () => {
    const layer = buildRelationshipLayer(
      state({
        stage: 'friendly',
        evolutions: [
          {
            id: 'e1',
            personaQuote: '烟瘾重',
            change: '已经戒掉',
            evidence: '',
            status: 'applied',
            createdAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      }),
      'layered',
    )
    expect(layer).toContain('当下相处状态：你们熟络的朋友')
    expect(layer).toContain('【近期关系演化】')
    expect(layer).toContain('你曾「烟瘾重」')
  })
})
