## 1. Confirm 闸门与遗忘工具风险

- [x] 1.1 将 `forget_memory` 的 `riskLevel` 改为 `confirm`，并更新相关单元测试
- [x] 1.2 在 `ChatService`/`chatController` 接线 `confirmTool`：IPC 请求渲染进程确认，超时默认拒绝
- [x] 1.3 聊天窗实现确认 UI（工具名 + 脱敏入参摘要，确认/拒绝）
- [x] 1.4 功能 eval 补充 confirm「确认执行 / 拒绝不执行」场景（不仅断言 riskLevel）

## 2. 规划可观测与 RAG 规划提示

- [x] 2.1 `plan` 失败时记录观测事件，并向聊天窗发出可理解提示（不阻断回复）
- [x] 2.2 扩展规划 instruction：文档/资料细节优先引导 `search_knowledge`
- [x] 2.3 单测覆盖：plan 失败仍回复 + 有失败信号；规划提示包含知识库工具

## 3. 向量批写与索引进度

- [x] 3.1 `VectorStore` 增加 `upsertMany`/`deleteMany`（批内单次 `persist`）
- [x] 3.2 `KnowledgeStore.indexChunks` 与记忆向量同步改走批量 API
- [x] 3.3 重建索引进度事件接到知识库面板 UI
- [x] 3.4 单测：批量 upsert N 条仅落盘一次

## 4. Embedding 冷启动与批处理

- [x] 4.1 启动预加载时通过 IPC 暴露 loading/ready/error；聊天窗展示横幅与重试
- [x] 4.2 优化 `embedTexts` 批处理路径（减少无谓开销；能批则批）
- [x] 4.3 确认加载失败仍不降级，与既有错误指引一致

## 5. 有限多轮工具环

- [x] 5.1 Agent 图支持最多 N 轮工具环（默认 2）与总工具次数上限
- [x] 5.2 第二轮通过二次 `planToolCalls`（或等价）基于工具结果再规划
- [x] 5.3 单测/eval：先 `search_knowledge` 再记忆写入的路径；超限停止

## 6. 聊天窗工具 UX

- [x] 6.1 工具执行中、正文未出时显示「正在调用工具…」而非笼统「思考中…」
- [x] 6.2 本轮存在工具调用时时间线默认展开
- [x] 6.3 更新 `docs/interview-demo-3min.md` 去掉「需手动展开时间线」依赖（若有）

## 7. IR 真 Embedding 评测

- [x] 7.1 `eval:retrieval` 支持环境变量/开关启用真实 BGE（默认仍 mock）
- [x] 7.2 真测模式下输出可区分标记；README 说明两种指标含义
- [x] 7.3 本地有权重时跑通真测路径（记录命令与注意事项）

## 8. Electron Windows 打包

- [x] 8.1 引入 electron-builder（或等价）与 `pack`/`dist` npm scripts
- [x] 8.2 配置 asarUnpack/extraResources 覆盖 onnxruntime 等 native 依赖
- [x] 8.3 README 补充打包步骤、外置 `data/models` 与体积建议
- [x] 8.4 在干净环境下验证：打包产物可启动，Embedding 在权重就绪时可加载

## 9. 文档与简历对齐

- [x] 9.1 更新 `highlight_resume_pet.md`：去掉过时「下一步 P0→P3」；注明 confirm/多轮/真 IR 能力
- [x] 9.2 清理空态「语音朗读后续提供」等与 TTS 搁置矛盾的文案
- [x] 9.3 跑功能 eval +（可选）真 IR，确认无回归
