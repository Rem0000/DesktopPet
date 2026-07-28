## ADDED Requirements

### Requirement: Hide pet operation hint text

The pet stage SHALL NOT display instructional hint text under the model (for example drag / hover / click guidance).

#### Scenario: No hint under Live2D or default pet

- **WHEN** the pet window is showing either Live2D or the default pet
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
