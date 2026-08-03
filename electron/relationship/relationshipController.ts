import { ipcMain } from 'electron'
import type {
  RelationshipPanelView,
  RelationshipPatch,
  RelationshipPolicy,
  RelationshipState,
} from '../../src/chat/contracts'
import { RelationshipService } from './relationshipService'
import {
  relationshipTemperature,
  RELATIONSHIP_STAGE_LABELS,
} from './relationshipRender'

function toView(state: RelationshipState): RelationshipPanelView {
  return {
    ...state,
    temperature: relationshipTemperature(state),
    stageLabel: RELATIONSHIP_STAGE_LABELS[state.stage],
  }
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new Error(`${label}无效`)
  }
  return value.trim()
}

function requirePatch(value: unknown): RelationshipPatch {
  if (!value || typeof value !== 'object') throw new Error('关系修正参数无效')
  const input = value as Record<string, unknown>
  const patch: RelationshipPatch = {}
  if (input.affinity !== undefined) {
    if (typeof input.affinity !== 'number' || !Number.isFinite(input.affinity)) {
      throw new Error('好感温度无效')
    }
    patch.affinity = input.affinity
  }
  if (input.temperatureNote !== undefined) {
    if (typeof input.temperatureNote !== 'string') {
      throw new Error('态度描述无效')
    }
    patch.temperatureNote = input.temperatureNote
  }
  if (input.policy !== undefined) {
    if (
      input.policy !== 'layered' &&
      input.policy !== 'persona-first' &&
      input.policy !== 'dynamic-first'
    ) {
      throw new Error('关系策略无效')
    }
    patch.policy = input.policy as RelationshipPolicy
  }
  return patch
}

/** 关系面板 IPC：查询/手工修正/重置/演化审阅 */
export function initializeRelationshipController(service: RelationshipService): void {
  ipcMain.handle('relationship:get', async (_e, rawPackageId: unknown) =>
    toView(await service.readState(requireId(rawPackageId, '模型包标识'))),
  )

  ipcMain.handle(
    'relationship:patch',
    async (_e, rawPackageId: unknown, rawPatch: unknown) =>
      toView(
        await service.applyPatch(
          requireId(rawPackageId, '模型包标识'),
          requirePatch(rawPatch),
        ),
      ),
  )

  ipcMain.handle('relationship:reset', async (_e, rawPackageId: unknown) =>
    toView(await service.reset(requireId(rawPackageId, '模型包标识'))),
  )

  ipcMain.handle('relationship:proposals', async (_e, rawPackageId: unknown) =>
    service.listProposals(requireId(rawPackageId, '模型包标识')),
  )

  ipcMain.handle(
    'relationship:proposal-respond',
    async (_e, rawPackageId: unknown, rawProposalId: unknown, rawAccept: unknown) => {
      if (typeof rawAccept !== 'boolean') throw new Error('处理结果无效')
      return service.respondProposal(
        requireId(rawPackageId, '模型包标识'),
        requireId(rawProposalId, '演化标识'),
        rawAccept,
      )
    },
  )
}
