## ADDED Requirements

### Requirement: List imported Live2D packages

The system SHALL expose a management window that lists packages under the Live2D import root (`layer-packs/live2d-models`), including enough metadata for the user to identify each package (name and import identity).

#### Scenario: Open manager shows imports

- **WHEN** the user opens「管理已导入模型」from the context menu
- **THEN** a management window lists existing `import-*` (or equivalent) package directories

#### Scenario: Empty library

- **WHEN** there are no imported packages on disk
- **THEN** the management window shows an empty state without erroring

### Requirement: Delete imported package

The system SHALL allow the user to delete a listed imported package directory from disk via the management window.

#### Scenario: Delete non-current package

- **WHEN** the user deletes a package that is not the active Live2D session
- **THEN** the directory is removed and the list refreshes without changing the current pet display

#### Scenario: Delete active package

- **WHEN** the user deletes the package currently used by the Live2D session
- **THEN** the package is removed, the Live2D session is cleared, and the pet falls back to the default non-Live2D appearance

### Requirement: Switch active model from library

The system SHALL allow the user to switch the active desktop pet Live2D model to a package selected in the management window without re-importing from the original source.

#### Scenario: Switch to another imported package

- **WHEN** the user chooses to use a listed valid package as the current model
- **THEN** the pet loads that package and persists it as the current Live2D session

### Requirement: Context menu entry for manager

The pet context menu SHALL include an entry to open the imported-model management window.

#### Scenario: Open manager from menu

- **WHEN** the user selects the management entry in the context menu
- **THEN** the management window opens (or focuses if already open)
