# 工具权限管理安全层

本模块实现了三层防御机制，用于保护文件系统免受恶意或错误的工具调用。

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    LangGraph Agent                      │
│                  (规划工具调用)                          │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Layer 2: 输入规范化验证                     │
│         (inputValidator.ts - validate 方法)             │
│  • 类型检查  • 长度限制  • 敏感内容检测                 │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│            toolBoundary 节点 (agentRuntime.ts)           │
│                   (执行工具)                             │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Layer 1: 静态路径约束                       │
│         (pathValidator.ts - execute 方法内)             │
│  • 路径规范化  • 区域检查  • 穿越防护                   │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Layer 3: 审计与监控                         │
│         (fileAccessAudit.ts - 自动记录)                 │
│  • 操作日志  • 异常检测  • 统计分析                     │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
                 文件系统操作
```

## 文件结构

```
electron/security/
├── pathValidator.ts           # Layer 1: 路径安全验证
├── pathValidator.test.ts      # Layer 1 测试
├── inputValidator.ts          # Layer 2: 输入规范化
├── inputValidator.test.ts     # Layer 2 测试
├── fileAccessAudit.ts         # Layer 3: 审计日志
├── integrationExamples.ts     # 集成示例
└── README.md                  # 本文件
```

## Layer 1: 静态路径约束

### 功能
- 防止路径穿越攻击（`../../etc/passwd`）
- 限制文件操作在指定数据区域内（`data/memory/`, `data/novels/` 等）
- 验证路径段安全性（禁止 `..`, `/`, 特殊字符）
- UUID 格式验证

### API

```typescript
// 验证并规范化路径
validateDataPath(requestedPath: string, zone: AllowedZone): string

// 验证路径段（用于动态构造路径）
validatePathSegment(segment: string): string

// 验证 UUID
validateUUID(value: string): string

// 构造安全路径（组合验证）
buildDataPath(zone: AllowedZone, ...segments: string[]): string
```

### 使用示例

```typescript
// ✅ 正确：在小说系统中保存章节
const safePath = buildDataPath('novels', bookId, 'ch-001.md')
await writeFile(safePath, content)

// ❌ 错误：会被拦截
buildDataPath('novels', '../memory', 'leak.json')
// throws: 路径段包含非法字符
```

## Layer 2: 输入规范化验证

### 功能
- 类型检查和转换
- 长度限制
- 敏感内容检测（API 密钥、密码、JWT 等）
- 枚举值验证
- 日期格式验证

### API

```typescript
// 验证字符串内容
validateContent(content: string, options?: {...}): string

// 验证数字范围
validateNumber(value: unknown, options?: {...}): number

// 验证布尔值
validateBoolean(value: unknown, options?: {...}): boolean

// 验证枚举
validateEnum<T>(value: unknown, allowedValues: T[], options?: {...}): T

// 验证数组
validateArray<T>(value: unknown, options?: {...}): T[]

// 验证 ISO 日期
validateISODate(value: unknown, options?: {...}): string

// 验证对象必填字段
requireFields<T>(obj: unknown, requiredFields: (keyof T)[]): T

// 检测敏感内容
containsSensitiveData(text: string): boolean
```

### 使用示例

```typescript
// 在工具的 validate 方法中
validate: (input: unknown) => {
  const value = requireFields<{
    content: string
    importance?: number
  }>(input, ['content'])

  const content = validateContent(value.content, {
    minLength: 1,
    maxLength: 2_000,
    allowSensitive: false,
  })

  const importance = validateNumber(value.importance, {
    min: 1,
    max: 3,
    integer: true,
    defaultValue: 2,
  })

  return { content, importance }
}
```

## Layer 3: 审计与监控

### 功能
- 记录所有文件访问操作到 JSONL 日志
- 异常高频访问检测
- 操作统计分析
- 非阻塞记录（审计失败不影响主流程）

### API

```typescript
// 初始化审计系统（应用启动时调用一次）
initializeFileAudit(): Promise<void>

// 记录文件访问
auditFileAccess(log: Omit<FileAccessAuditLog, 'timestamp'>): Promise<void>

// 包装函数自动审计
auditWrapper<TArgs, TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  operation: FileOperation,
  toolName: string,
  filePath: string,
): (...args: TArgs) => Promise<TReturn>

// 检测异常活动
detectAnomalousActivity(toolName: string): boolean

// 获取操作统计
getOperationStats(): Record<string, number>
```

### 审计日志格式

```jsonl
{"timestamp":"2024-01-01T12:00:00.000Z","operation":"write","filePath":"data/memory/memory-data.json","toolName":"remember_fact","success":true,"latencyMs":12,"fileSize":1024,"sessionId":"abc-123"}
{"timestamp":"2024-01-01T12:00:05.000Z","operation":"read","filePath":"data/knowledge/docs/doc1.md","toolName":"search_knowledge","success":true,"latencyMs":8}
```

### 使用示例

```typescript
// 方式 1: 手动记录
const startTime = Date.now()
try {
  await writeFile(path, content)
  await auditFileAccess({
    operation: 'write',
    filePath: 'data/memory/memory-data.json',
    toolName: 'remember_fact',
    success: true,
    latencyMs: Date.now() - startTime,
  })
} catch (error) {
  await auditFileAccess({
    operation: 'write',
    filePath: 'data/memory/memory-data.json',
    toolName: 'remember_fact',
    success: false,
    errorMessage: error.message,
    latencyMs: Date.now() - startTime,
  })
  throw error
}

// 方式 2: 使用包装器
const safeWriteFile = auditWrapper(
  writeFile,
  'write',
  'remember_fact',
  'data/memory/memory-data.json'
)
await safeWriteFile(content)  // 自动记录
```

## 集成到现有代码

### 步骤 1: 初始化审计系统

在 `electron/main.ts` 的 `app.whenReady()` 中添加：

```typescript
import { initializeFileAudit } from './security/fileAccessAudit'

app.whenReady().then(async () => {
  await initializeFileAudit()
  // ... 其他初始化代码
})
```

### 步骤 2: 增强工具的 validate 方法

在 `electron/chat/memoryService.ts` 等文件中：

```typescript
import { validateContent, requireFields } from '../security/inputValidator'

// 原有代码
validate: (input: unknown) => {
  if (!input || typeof input !== 'object') throw new Error('参数无效')
  const value = input as Record<string, unknown>
  if (typeof value.content !== 'string') {
    throw new Error('remember_fact 需要 content')
  }
  return { content: value.content }
}

// 改进后
validate: (input: unknown) => {
  const value = requireFields<{ content: string }>(input, ['content'])
  const content = validateContent(value.content, {
    maxLength: 2_000,
    allowSensitive: false,
  })
  return { content }
}
```

### 步骤 3: 在文件操作中添加路径验证

在 `electron/novel/novelStoryStore.ts` 等文件中：

```typescript
import { validateUUID, buildDataPath } from '../security/pathValidator'

// 原有代码
async saveChapter(bookId: string, chapterNumber: number) {
  const path = path.join(this.bookDir(bookId), `ch-${chapterNumber}.md`)
  await writeFile(path, content)
}

// 改进后
async saveChapter(bookId: string, chapterNumber: number) {
  const validatedBookId = validateUUID(bookId)
  const safePath = buildDataPath('novels', validatedBookId, `ch-${chapterNumber}.md`)
  await writeFile(safePath, content)
}
```

### 步骤 4: 在 toolBoundary 中添加审计

在 `electron/chat/agentRuntime.ts:820` 的工具执行处：

```typescript
import { auditFileAccess } from '../security/fileAccessAudit'

// 在 try-finally 中包装工具执行
const started = Date.now()
try {
  const output = await tool.execute(validated, input.signal, {...})
  
  // 成功时审计
  await auditFileAccess({
    operation: 'write',  // 根据工具类型判断
    filePath: inferFilePathFromTool(call.name),
    toolName: call.name,
    success: true,
    latencyMs: Date.now() - started,
    sessionId: state.sessionId,
  })
  
  return output
} catch (error) {
  // 失败时也要审计
  await auditFileAccess({
    operation: 'write',
    filePath: inferFilePathFromTool(call.name),
    toolName: call.name,
    success: false,
    errorMessage: error.message,
    latencyMs: Date.now() - started,
    sessionId: state.sessionId,
  })
  throw error
}
```

## 测试

运行测试：

```bash
npm test -- electron/security/pathValidator.test.ts
npm test -- electron/security/inputValidator.test.ts
```

## 安全保证

### 防护的攻击类型

✅ **路径穿越攻击**
```typescript
// ❌ 被拦截
buildDataPath('memory', '../../../etc/passwd')
validateDataPath('/etc/passwd', 'memory')
```

✅ **敏感信息泄露**
```typescript
// ❌ 被拦截
validateContent('my api_key is sk-abc123')
// throws: 内容包含疑似密钥或敏感机密内容
```

✅ **恶意文件名**
```typescript
// ❌ 被拦截
validatePathSegment('file<script>.md')
validatePathSegment('..')
```

✅ **DoS 攻击（异常高频访问）**
```typescript
// 10秒内超过50次操作时自动检测并警告
detectAnomalousActivity('remember_fact')  // 返回 true
```

### 不防护的攻击类型

❌ **运行时代码注入** - 需要进程隔离（成本太高）
❌ **网络泄露** - 需要网络层防护
❌ **间接文件访问**（子进程、符号链接）- 依赖代码审查

## 性能影响

- **Layer 1**: ~0.1-0.5ms（路径规范化 + 字符串检查）
- **Layer 2**: ~0.1-0.3ms（类型检查 + 正则匹配）
- **Layer 3**: ~1-3ms（异步追加到 JSONL，非阻塞）

总开销：每次工具调用约 **1-4ms**，对用户体验无感知。

## 维护建议

1. **定期审查日志**：`data/logs/file-access-audit.jsonl`
2. **监控异常活动**：关注 `detectAnomalousActivity` 警告
3. **更新敏感模式**：在 `inputValidator.ts` 中添加新的敏感信息模式
4. **扩展白名单**：新增数据区域时更新 `AllowedZone` 类型

## 参考

- OWASP: [Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)
- CWE-22: Improper Limitation of a Pathname to a Restricted Directory
- CWE-73: External Control of File Name or Path
