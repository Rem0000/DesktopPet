## ADDED Requirements

### Requirement: Restore last successful Live2D session on startup

On application startup, the system SHALL load the last successfully imported Live2D session from persistent storage (when present and still valid) and display that model by default, instead of clearing the saved session.

#### Scenario: Startup restores previous import

- **WHEN** the app starts and a previously saved Live2D session exists with model files still on disk
- **THEN** the pet shows that Live2D model without asking the user to import again

#### Scenario: Invalid session falls back to default pet

- **WHEN** the app starts and the saved session path is missing or unreadable
- **THEN** the system clears the invalid session and shows the default non-Live2D pet

#### Scenario: Exit Live2D clears persistence

- **WHEN** the user chooses to exit Live2D
- **THEN** the saved session is removed so the next startup does not auto-load Live2D until a new successful import
