## ADDED Requirements

### Requirement: No exit-to-non-Live2D path
桌宠上下文菜单与主流程 SHALL NOT 提供将当前外观切换为非 Live2D 默认皮的入口；应用运行态 SHALL 始终使用某个 Live2D 包（含内置默认包）。

#### Scenario: Context menu has no exit Live2D

- **WHEN** the user opens the pet context menu
- **THEN** there is no menu entry that exits Live2D to a non-Live2D default pet

## MODIFIED Requirements

### Requirement: Hide pet operation hint text

The pet stage SHALL NOT display instructional hint text under the model (for example drag / hover / click guidance).

#### Scenario: No hint under Live2D

- **WHEN** the pet window is showing a Live2D model
- **THEN** no bottom hint string such as「拖拽移动」is visible in the UI
