## Purpose

桌宠主窗口视觉与菜单精简：隐藏操作提示与导入状态条，收敛右键菜单入口。

## Requirements

### Requirement: Hide pet operation hint text

The pet stage SHALL NOT display instructional hint text under the model (for example drag / hover / click guidance).

#### Scenario: No hint under Live2D

- **WHEN** the pet window is showing a Live2D model
- **THEN** no bottom hint string such as「拖拽移动」is visible in the UI

### Requirement: Hide import status toast

The application SHALL NOT show a top status toast for Live2D import success, restore, or similar informational messages in the pet window.

#### Scenario: Import does not show status banner

- **WHEN** the user successfully imports a Live2D folder
- **THEN** the model becomes active without a persistent or transient status banner at the top of the pet window

### Requirement: Remove unused mood menu item

The context menu SHALL NOT include a「切换心情」item.

#### Scenario: Context menu has no mood toggle

- **WHEN** the user opens the pet context menu
- **THEN** there is no menu entry that toggles mood

### Requirement: Single folder import entry

The context menu SHALL provide only folder-based Live2D import and MUST NOT offer a separate「导入 Live2D 模型」file-picker entry.

#### Scenario: Only folder import remains

- **WHEN** the user opens the context menu
- **THEN** there is a folder import action and no duplicate file-based model import action

### Requirement: No exit-to-non-Live2D path
桌宠上下文菜单与主流程 SHALL NOT 提供将当前外观切换为非 Live2D 默认皮的入口；应用运行态 SHALL 始终使用某个 Live2D 包（含内置默认包）。

#### Scenario: Context menu has no exit Live2D

- **WHEN** the user opens the pet context menu
- **THEN** there is no menu entry that exits Live2D to a non-Live2D default pet
