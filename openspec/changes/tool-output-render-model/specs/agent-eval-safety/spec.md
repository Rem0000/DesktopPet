## ADDED Requirements

### Requirement: LLM-as-judge 生成质量评测
系统 SHALL 提供 LLM-as-judge 评测：对开放性回复按 rubric 维度打分（factuality / persona / citation_fidelity / directness / no_hallucinated_tools，各 1 分，≥4 为 pass）。真实模式 MUST 以「与 expectedPass 的符合率」为断言门槛，MUST NOT 仅断言至少一条 pass；mock 模式 MUST 保持确定性回归。

#### Scenario: 真实打分断言符合率
- **WHEN** 开发者以真实 LLM 运行 judge 评测
- **THEN** 系统输出 passRate 与逐条 verdict，并以符合率 ≥ 阈值（默认 0.8）判定评测通过/失败

#### Scenario: 引用忠实度必过
- **WHEN** judge 场景集包含 citation-faithful（逐字引用检索结果）与 citation-fabricated（补充来源外内容）
- **THEN** 忠实引用场景 MUST pass、编造来源场景 MUST fail，任一不达标即评测失败

#### Scenario: mock 确定性回归
- **WHEN** 开发者运行默认（mock judge）评测
- **THEN** verdict 与 expectedPass 完全一致，结果确定可重复
