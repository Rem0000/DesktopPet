## Purpose

以 DeepSeek 为默认 LLM Provider，在 Electron 主进程中安全完成配置、流式调用与错误归一化。
## Requirements
### Requirement: DeepSeek 默认 Provider
系统 SHALL 将 DeepSeek 的 OpenAI 兼容聊天接口作为初始默认 LLM Provider，并 SHALL 允许配置 API Key、模型名称和服务地址。

#### Scenario: 使用有效配置聊天
- **WHEN** 用户已保存有效 DeepSeek 配置并发送消息
- **THEN** 系统使用所选 DeepSeek 模型生成流式回复

#### Scenario: 配置缺失
- **WHEN** 用户在 API Key 缺失时发送消息
- **THEN** 系统不发起远程请求并引导用户完成配置

### Requirement: 主进程隔离敏感配置
系统 MUST 在 Electron 主进程中读取和使用 Provider 凭据，MUST NOT 将完整 API Key 发送到渲染进程、写入聊天记录或输出到日志。

#### Scenario: 读取设置页面
- **WHEN** 渲染进程请求当前 Provider 配置
- **THEN** 系统仅返回非敏感配置及 API Key 是否已配置的状态

#### Scenario: 更新凭据
- **WHEN** 用户提交新的 API Key
- **THEN** 主进程保存该凭据并仅返回保存成功或失败结果

### Requirement: 请求生命周期管理
Provider SHALL 支持流式文本、超时和基于请求标识的取消，并 SHALL 将错误归一化为配置、鉴权、限流、网络、超时、取消或服务端错误。

#### Scenario: 取消指定请求
- **WHEN** 主进程收到有效请求标识的取消命令
- **THEN** Provider 中止对应远程请求且不影响其他会话的请求

#### Scenario: 服务限流
- **WHEN** DeepSeek 返回限流响应
- **THEN** 系统返回限流错误类别和可重试信息，不泄露请求凭据

### Requirement: 配置校验
系统 SHALL 在保存 Provider 配置时校验服务地址协议、模型名和输入长度，并 SHALL 拒绝明显无效或不安全的配置。

#### Scenario: 非法服务地址
- **WHEN** 用户提交非 HTTP(S) 或格式无效的服务地址
- **THEN** 系统拒绝保存并指出无效字段

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

