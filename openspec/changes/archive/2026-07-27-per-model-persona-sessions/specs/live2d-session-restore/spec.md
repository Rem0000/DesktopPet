## MODIFIED Requirements

### Requirement: Restore last successful Live2D session on startup

On application startup, the system SHALL load the last successfully imported Live2D session from persistent storage (when present and still valid) and display that model by default. When the saved session is missing or invalid, the system SHALL load the built-in default Live2D package `import-2026-07-16T09-28-47-370Z` instead of a non-Live2D pet. The system MUST NOT provide an「退出 Live2D」path that clears persistence to a non-Live2D appearance.

#### Scenario: Startup restores previous import

- **WHEN** the app starts and a previously saved Live2D session exists with model files still on disk
- **THEN** the pet shows that Live2D model without asking the user to import again

#### Scenario: Invalid session falls back to default Live2D package

- **WHEN** the app starts and the saved session path is missing or unreadable
- **THEN** the system clears the invalid session and loads the built-in default Live2D package `import-2026-07-16T09-28-47-370Z`
