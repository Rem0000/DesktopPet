## ADDED Requirements

### Requirement: 调用计量上报

Provider SHALL 在每次调用（流式回复、工具规划、摘要与一次性补全）返回 provider 报告的 token 用量（未缓存输入、输出、缓存读、缓存写与推理 token 中的可得项）与调用耗时；流式调用 SHALL 额外返回首字延迟与结束原因。provider 未提供用量时，Provider MUST 明确标记该次结果为估算，MUST NOT 伪造精确计量。用量上报 MUST NOT 包含或泄露 API Key、请求头凭据等敏感内容。调用方式变更 MUST NOT 改变既有的错误归一化类别与取消语义。

#### Scenario: 流式调用上报用量
- **WHEN** 一次流式回复正常结束
- **THEN** 调用方获得该次调用的 token 用量、首字延迟与结束原因

#### Scenario: 用量不可得时标记估算
- **WHEN** 服务端响应未包含用量信息
- **THEN** 返回的用量被标记为估算，调用方可据此区分展示

#### Scenario: 取消仍返回已得信息
- **WHEN** 流式调用在生成过程中被取消
- **THEN** 调用方仍可获得已产生的文本与已得到的用量信息，且错误类别仍为取消
