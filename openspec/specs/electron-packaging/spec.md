## Purpose

Electron Windows 打包与分发：npm 打包脚本、原生 Embedding 依赖的 asar 处理约定，以及面向新贡献者的分发文档。

## Requirements

### Requirement: Windows 打包脚本
项目 SHALL 提供可通过 npm script 触发的 Electron Windows 打包命令（如 `pack` / `dist`），使用 electron-builder 或等价工具生成可运行产物。

#### Scenario: 执行打包命令
- **WHEN** 开发者在依赖与构建产物就绪后执行打包脚本
- **THEN** 系统产出 Windows 可运行目录或安装包，且不因遗漏脚本定义而失败

### Requirement: Native Embedding 依赖打包约定
打包配置 MUST 正确处理 `@xenova/transformers` / `onnxruntime-node` 等原生或非 asar 友好依赖（例如 asarUnpack 或额外资源拷贝），使打包后的主进程仍能加载 Embedding 运行时（在权重可用前提下）。

#### Scenario: 打包后可加载运行时
- **WHEN** 用户运行打包产物且本地模型权重已按文档放置
- **THEN** Embedding 管道可完成加载（或给出与开发模式一致的明确错误），MUST NOT 因 asar 路径导致静默崩溃

### Requirement: 分发文档
README 或等价文档 MUST 说明：如何打包、如何预置/下载 BGE 权重到 `data/models/`、以及打包体积与外置模型的建议。

#### Scenario: 文档可跟随操作
- **WHEN** 新贡献者阅读分发说明
- **THEN** 能按步骤完成打包与模型放置，无需阅读源码推断
