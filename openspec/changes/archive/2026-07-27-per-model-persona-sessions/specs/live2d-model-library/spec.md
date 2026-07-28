## ADDED Requirements

### Requirement: Built-in default Live2D package
系统 SHALL 将包目录 `import-2026-07-16T09-28-47-370Z` 视为内置默认 Live2D 模型，并在首次启动或无其他可用用户包需要回退时加载该包。

#### Scenario: First launch uses default package
- **WHEN** 应用启动且没有有效的已保存 Live2D 会话
- **THEN** 系统加载默认包 `import-2026-07-16T09-28-47-370Z` 作为当前模型

#### Scenario: Default package cannot be deleted
- **WHEN** 用户尝试删除默认包 `import-2026-07-16T09-28-47-370Z`
- **THEN** 系统拒绝删除并保持该包仍在库中

### Requirement: Cascade delete chat sessions with package
删除非默认导入包时，系统 SHALL 级联删除绑定到该 `packageId` 的全部聊天会话及其会话摘要，且 MUST NOT 删除全局用户记忆条目。

#### Scenario: Delete package removes its sessions
- **WHEN** 用户删除某个非默认导入包
- **THEN** 该包目录被移除，且所有 `packageId` 等于该包的聊天会话与对应摘要被删除，全局 profile/fact 记忆仍保留

## MODIFIED Requirements

### Requirement: Delete imported package

The system SHALL allow the user to delete a listed non-default imported package directory from disk via the management window. Deleting the active non-default package SHALL switch the pet to the built-in default Live2D package instead of a non-Live2D appearance.

#### Scenario: Delete non-current package

- **WHEN** the user deletes a non-default package that is not the active Live2D session
- **THEN** the directory is removed and the list refreshes without changing the current pet display

#### Scenario: Delete active non-default package

- **WHEN** the user deletes the non-default package currently used by the Live2D session
- **THEN** the package is removed, chat sessions for that package are cascade-deleted, and the pet loads the built-in default Live2D package

### Requirement: List imported Live2D packages

The system SHALL expose a management window that lists packages under the Live2D import root (`layer-packs/live2d-models`), including the built-in default package and enough metadata for the user to identify each package (name and import identity). The empty-library state SHALL NOT occur while the default package remains on disk; if only the default remains, the list still shows that package.

#### Scenario: Open manager shows imports

- **WHEN** the user opens「管理已导入模型」from the context menu
- **THEN** a management window lists existing `import-*` (or equivalent) package directories including the default package when present

#### Scenario: Only default package remains

- **WHEN** all user-imported non-default packages have been deleted and the default package exists
- **THEN** the management window lists the default package without erroring
