## Purpose

Live2D 激活时用全屏光标驱动模型视线跟随。

## Requirements

### Requirement: Full-screen cursor focus while Live2D is active

While a Live2D model is active after a successful import or session restore, the system SHALL drive the model's look-at / focus from the **global screen cursor position**, not only from pointer events inside the pet window.

#### Scenario: Cursor outside pet window still moves gaze

- **WHEN** Live2D is showing and the user moves the mouse anywhere on the desktop
- **THEN** the model focus updates according to the cursor position relative to the model

#### Scenario: Focus tracking stops when Live2D exits

- **WHEN** the user exits Live2D mode
- **THEN** the system stops global cursor sampling for focus

#### Scenario: Tracking starts after successful import

- **WHEN** a Live2D package import completes successfully and the model is displayed
- **THEN** full-screen cursor focus tracking is enabled without requiring an extra user toggle
