import { describe, expect, test } from 'vitest'
import path from 'node:path'
import {
  validateDataPath,
  validatePathSegment,
  validateUUID,
  buildDataPath,
} from './pathValidator'

describe('pathValidator', () => {
  describe('validateDataPath', () => {
    test('允许合法路径', () => {
      const dataRoot = path.resolve('data')
      const validPath = path.join(dataRoot, 'memory', 'memory-data.json')
      expect(() => validateDataPath(validPath, 'memory')).not.toThrow()
    })

    test('拒绝路径穿越 - 相对路径', () => {
      const dataRoot = path.resolve('data')
      const maliciousPath = path.join(dataRoot, 'memory', '..', '..', 'etc', 'passwd')
      expect(() => validateDataPath(maliciousPath, 'memory')).toThrow(/路径穿越/)
    })

    test('拒绝路径穿越 - 绝对路径', () => {
      expect(() => validateDataPath('/etc/passwd', 'memory')).toThrow(/路径穿越/)
    })

    test('拒绝跨区域访问', () => {
      const dataRoot = path.resolve('data')
      const crossZonePath = path.join(dataRoot, 'knowledge', 'docs', 'test.md')
      expect(() => validateDataPath(crossZonePath, 'memory')).toThrow(/路径穿越/)
    })

    test('拒绝非法字符 (Windows)', () => {
      const dataRoot = path.resolve('data')
      const invalidPath = path.join(dataRoot, 'memory', 'file<name>.json')
      expect(() => validateDataPath(invalidPath, 'memory')).toThrow(/非法路径字符/)
    })

    test('拒绝以点结尾的文件名', () => {
      const dataRoot = path.resolve('data')
      const dotEndPath = path.join(dataRoot, 'memory', 'file.')
      expect(() => validateDataPath(dotEndPath, 'memory')).toThrow(/不能以点结尾/)
    })

    test('允许区域根目录', () => {
      const dataRoot = path.resolve('data')
      const zoneRoot = path.join(dataRoot, 'memory')
      expect(() => validateDataPath(zoneRoot, 'memory')).not.toThrow()
    })
  })

  describe('validatePathSegment', () => {
    test('允许合法路径段', () => {
      expect(validatePathSegment('abc123')).toBe('abc123')
      expect(validatePathSegment('file-name_123.json')).toBe('file-name_123.json')
      expect(validatePathSegment('550e8400-e29b-41d4-a716-446655440000')).toBe(
        '550e8400-e29b-41d4-a716-446655440000',
      )
    })

    test('拒绝空路径段', () => {
      expect(() => validatePathSegment('')).toThrow(/不能为空/)
    })

    test('拒绝相对路径段', () => {
      expect(() => validatePathSegment('.')).toThrow(/禁止使用相对路径段/)
      expect(() => validatePathSegment('..')).toThrow(/禁止使用相对路径段/)
    })

    test('拒绝包含分隔符', () => {
      expect(() => validatePathSegment('../../etc')).toThrow(/非法字符/)
      expect(() => validatePathSegment('a/b')).toThrow(/非法字符/)
      expect(() => validatePathSegment('a\\b')).toThrow(/非法字符/)
    })

    test('拒绝特殊字符', () => {
      expect(() => validatePathSegment('file<name>')).toThrow(/非法字符/)
      expect(() => validatePathSegment('file:name')).toThrow(/非法字符/)
      expect(() => validatePathSegment('file*name')).toThrow(/非法字符/)
    })

    test('拒绝过长路径段', () => {
      const longSegment = 'a'.repeat(256)
      expect(() => validatePathSegment(longSegment)).toThrow(/过长/)
    })
  })

  describe('validateUUID', () => {
    test('允许合法 UUID', () => {
      expect(validateUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(
        '550e8400-e29b-41d4-a716-446655440000',
      )
    })

    test('拒绝非 UUID 格式', () => {
      expect(() => validateUUID('not-a-uuid')).toThrow(/UUID 格式无效/)
      expect(() => validateUUID('12345')).toThrow(/UUID 格式无效/)
      expect(() => validateUUID('../../../etc/passwd')).toThrow(/UUID 格式无效/)
    })

    test('拒绝大写 UUID', () => {
      expect(() => validateUUID('550E8400-E29B-41D4-A716-446655440000')).toThrow(
        /UUID 格式无效/,
      )
    })
  })

  describe('buildDataPath', () => {
    test('构造合法路径', () => {
      const result = buildDataPath('novels', 'book-123', 'ch-001.md')
      expect(result).toContain('novels')
      expect(result).toContain('book-123')
      expect(result).toContain('ch-001.md')
    })

    test('拒绝恶意路径段', () => {
      expect(() => buildDataPath('novels', '../memory', 'leak.json')).toThrow(
        /非法字符/,
      )
    })

    test('拒绝路径穿越', () => {
      expect(() => buildDataPath('novels', '..', 'escape.json')).toThrow(
        /禁止使用相对路径段/,
      )
    })
  })
})
