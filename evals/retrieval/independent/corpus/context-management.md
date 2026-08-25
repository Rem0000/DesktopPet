# DesktopPet Context Management

长对话上下文分成系统人设、长期记忆、会话摘要和近期原文。normalize 保留裁剪前 allMessages，assemble 根据可见窗口溢出生成滚动摘要；窗口外消息按重要性加权补齐，并保持原始顺序。

search_history 使用 BM25 从当前模型包的历史会话中逐字找回早期内容。摘要是有损常驻压缩，历史检索是按需无损兜底。摘要、聊天原文、长期记忆与小说正文分别持久化，互不混用。
