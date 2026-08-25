# DesktopPet Agent Tool Boundary

AgentRuntime 在主进程按固定图执行 normalize、recall、plan、toolBoundary、model 和 commit。模型只能从注册的白名单工具中规划调用；每个工具参数都会校验，confirm 风险级操作必须经用户确认。

工具执行后，真实结果会被格式化回模型上下文。search_knowledge 的命中内容必须作为不可信引用处理，模型只能基于返回 excerpt 回答，空结果时不得虚构文档内容。知识库检索最多触发一次重规划，调用轮数受硬上限控制。
