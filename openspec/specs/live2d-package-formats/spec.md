## Purpose

Live2D 模型包导入对 Cubism 2/4 格式与语音资源的支持。

## Requirements

### Requirement: Import Cubism 2 model packages

The system SHALL allow importing a Live2D package that uses Cubism 2 settings (`model.json` or `*.model.json`) and a `.moc` binary, by copying the package directory and producing a loadable `modelUrl` the same way Cubism 4 packages are handled.

#### Scenario: Import folder containing Cubism 2 model

- **WHEN** the user imports a folder that contains a Cubism 2 settings file and `.moc` plus referenced textures
- **THEN** the import succeeds and the catalog marks the package as Cubism 2 with no missing essential files

#### Scenario: Import Cubism 4 package still works

- **WHEN** the user imports a folder that contains `*.model3.json` and `.moc3` plus textures
- **THEN** the import succeeds as Cubism 4 without requiring a `.moc` file

#### Scenario: Incomplete Cubism 2 package is rejected

- **WHEN** the selected package references a `.moc` or textures that are missing on disk
- **THEN** the import fails with an error listing the missing essential files

### Requirement: Catalog voice directory wav files

The system SHALL include `.wav` files under common voice directories (`voice/`, `voices/`, `sounds/`) in the imported package catalog, and SHALL continue to validate Sound paths declared on motions.

#### Scenario: voice folder wavs are listed

- **WHEN** an imported package contains `voice/*.wav` files
- **THEN** the catalog `voices` list includes those relative paths and `hasSound` is true

#### Scenario: Motion Sound references remain validated

- **WHEN** a motion entry declares a Sound path to a `.wav` (or other audio) file
- **THEN** the importer checks that file exists and records it in missing if absent

### Requirement: Play motion-bound sounds when enabled

The system SHALL play audio referenced by motion Sound fields when Live2D sound is enabled, using the copied package files via the same asset URL scheme as other model resources.

#### Scenario: Sound plays with motion

- **WHEN** sound is enabled and the user plays a motion that has a Sound file present in the package
- **THEN** the associated audio plays without a separate network error for that file
