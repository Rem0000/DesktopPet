import type {
  AgentTool,
  RelationshipPatch,
  RelationshipState,
  RelationshipWriteInput,
} from '../../src/chat/contracts'
import type { ToolRegistry } from '../chat/toolRegistry'
import { RelationshipStore, clampAffinityDelta } from './relationshipStore'

/**
 * 关系业务服务：承载 update_relationship 白名单工具，
 * 并向注入层（MemoryService.assemble）提供只读状态。
 */
export class RelationshipService {
  constructor(
    private readonly store: RelationshipStore,
    private readonly tools: ToolRegistry,
    private readonly getActivePackageId: () => string | null,
  ) {}

  async readState(packageId: string): Promise<RelationshipState> {
    return this.store.getState(packageId)
  }

  async applyPatch(packageId: string, patch: RelationshipPatch): Promise<RelationshipState> {
    return this.store.patch(packageId, patch)
  }

  async reset(packageId: string): Promise<RelationshipState> {
    return this.store.reset(packageId)
  }

  async listProposals(packageId: string) {
    return this.store.listProposals(packageId)
  }

  async respondProposal(packageId: string, proposalId: string, accept: boolean) {
    return this.store.respondProposal(packageId, proposalId, accept)
  }

  async deletePackage(packageId: string): Promise<boolean> {
    return this.store.deletePackage(packageId)
  }

  /**
   * 好感是否允许自动调整：仅当策略非 persona-first 时允许。
   * persona-first 下好感应由人设既定关系决定，不随对话增减。
   * packageId 来自当前请求的会话归属；缺省时回退环境活跃包。
   */
  async isUpdateAllowed(packageId?: string): Promise<boolean> {
    const targetId =
      packageId && packageId.trim() ? packageId : this.getActivePackageId()
    if (!targetId) return false
    const state = await this.store.getState(targetId)
    return state.policy !== 'persona-first'
  }

  registerDefaultTools(): void {
    if (this.tools.get('update_relationship')) return
    const tool: AgentTool<RelationshipWriteInput, unknown> = {
      name: 'update_relationship',
      enabled: true,
      riskLevel: 'safe',
      description:
        '当对话明显增进或损害你与用户的好感/关系时调用，记录关系温度变化与一句关系笔记（如相互理解加深、闹矛盾、用户说难听话）。单次增减在 ±10 以内。口吻/称呼/输出规范类请求不要调用（应提示用户改人设）；普通闲聊不要调用。',
      parameters: {
        type: 'object',
        properties: {
          delta: {
            type: 'number',
            description: '好感温度增减（-10 ~ +10），默认 0',
          },
          note: {
            type: 'string',
            description: '简短关系笔记（≤120 字），记录发生了什么',
          },
        },
        required: [],
        additionalProperties: false,
      },
      validate: (input: unknown) => {
        if (!input || typeof input !== 'object') throw new Error('参数无效')
        const value = input as Partial<RelationshipWriteInput>
        if (value.delta !== undefined && typeof value.delta !== 'number') {
          throw new Error('delta 必须是数字')
        }
        if (value.note !== undefined && typeof value.note !== 'string') {
          throw new Error('note 必须是字符串')
        }
        return {
          delta: value.delta,
          note: typeof value.note === 'string' ? value.note : undefined,
          sessionId:
            typeof value.sessionId === 'string' ? value.sessionId : undefined,
        }
      },
      execute: async (input, _signal, ctx) => {
        const packageId =
          ctx?.packageId && ctx.packageId.trim() ? ctx.packageId : this.getActivePackageId()
        if (!packageId) return { ok: false, error: '无当前模型，无法更新关系' }
        const current = await this.store.getState(packageId)
        if (current.policy === 'persona-first') {
          return {
            ok: false,
            errorCode: 'persona_first_policy',
            error: '关系策略为人设优先，好感不随对话调整',
          }
        }
        // 无实际变化（增量钳制为 0 且无笔记）：如实报告未更新，避免误报成功
        if (clampAffinityDelta(input.delta ?? 0) === 0 && !(input.note ?? '').trim()) {
          return {
            ok: false,
            errorCode: 'no_change',
            error: '没有可应用的好感变化或笔记',
          }
        }
        const state = await this.store.applyWrite(packageId, input)
        return { ok: true, affinity: state.affinity, stage: state.stage }
      },
    }
    this.tools.register(tool as AgentTool)
  }
}
