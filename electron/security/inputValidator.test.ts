import { describe, expect, test } from 'vitest'
import {
  containsSensitiveData,
  validateContent,
  validateNumber,
  validateBoolean,
  validateEnum,
  validateArray,
  validateISODate,
  parseJSON,
  requireFields,
} from './inputValidator'

describe('inputValidator', () => {
  describe('containsSensitiveData', () => {
    test('检测 API 密钥', () => {
      expect(containsSensitiveData('my api_key is abc123')).toBe(true)
      expect(containsSensitiveData('sk-1234567890abc')).toBe(true)
    })

    test('检测密码', () => {
      expect(containsSensitiveData('password: secret123')).toBe(true)
      expect(containsSensitiveData('passwd=hunter2')).toBe(true)
    })

    test('检测 JWT', () => {
      expect(
        containsSensitiveData('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'),
      ).toBe(true)
    })

    test('允许正常文本', () => {
      expect(containsSensitiveData('remember to buy milk')).toBe(false)
      expect(containsSensitiveData('今天天气很好')).toBe(false)
    })
  })

  describe('validateContent', () => {
    test('允许合法内容', () => {
      expect(validateContent('hello world')).toBe('hello world')
      expect(validateContent('  trimmed  ')).toBe('trimmed')
    })

    test('拒绝空内容', () => {
      expect(() => validateContent('')).toThrow(/不能为空/)
      expect(() => validateContent('   ')).toThrow(/不能为空/)
    })

    test('拒绝过长内容', () => {
      const longText = 'a'.repeat(60_000)
      expect(() => validateContent(longText)).toThrow(/过长/)
    })

    test('拒绝敏感内容', () => {
      expect(() => validateContent('my api_key is secret')).toThrow(/敏感机密/)
    })

    test('允许自定义长度限制', () => {
      expect(validateContent('short', { maxLength: 10 })).toBe('short')
      expect(() => validateContent('toolongtext', { maxLength: 5 })).toThrow(/过长/)
    })

    test('允许自定义字段名', () => {
      expect(() => validateContent('', { fieldName: '标题' })).toThrow(/标题不能为空/)
    })

    test('允许敏感内容（如果显式允许）', () => {
      expect(validateContent('password=secret', { allowSensitive: true })).toBe(
        'password=secret',
      )
    })
  })

  describe('validateNumber', () => {
    test('允许合法数字', () => {
      expect(validateNumber(42)).toBe(42)
      expect(validateNumber(3.14)).toBe(3.14)
      expect(validateNumber(-10)).toBe(-10)
    })

    test('拒绝非数字', () => {
      expect(() => validateNumber('not a number')).toThrow(/必须是数字/)
      expect(() => validateNumber(null)).toThrow(/必须是数字/)
    })

    test('拒绝 Infinity 和 NaN', () => {
      expect(() => validateNumber(Infinity)).toThrow(/有限数字/)
      expect(() => validateNumber(NaN)).toThrow(/有限数字/)
    })

    test('检查范围', () => {
      expect(validateNumber(5, { min: 1, max: 10 })).toBe(5)
      expect(() => validateNumber(15, { min: 1, max: 10 })).toThrow(/超出范围/)
      expect(() => validateNumber(-5, { min: 1, max: 10 })).toThrow(/超出范围/)
    })

    test('检查整数', () => {
      expect(validateNumber(5, { integer: true })).toBe(5)
      expect(() => validateNumber(3.14, { integer: true })).toThrow(/必须是整数/)
    })

    test('使用默认值', () => {
      expect(validateNumber(undefined, { defaultValue: 10 })).toBe(10)
      expect(validateNumber(null, { defaultValue: 20 })).toBe(20)
    })
  })

  describe('validateBoolean', () => {
    test('允许布尔值', () => {
      expect(validateBoolean(true)).toBe(true)
      expect(validateBoolean(false)).toBe(false)
    })

    test('拒绝非布尔值', () => {
      expect(() => validateBoolean('yes')).toThrow(/必须是布尔值/)
      expect(() => validateBoolean(1)).toThrow(/必须是布尔值/)
    })

    test('使用默认值', () => {
      expect(validateBoolean(undefined, { defaultValue: true })).toBe(true)
    })
  })

  describe('validateEnum', () => {
    test('允许枚举值', () => {
      expect(validateEnum('apple', ['apple', 'banana'])).toBe('apple')
    })

    test('拒绝非枚举值', () => {
      expect(() => validateEnum('orange', ['apple', 'banana'])).toThrow(/无效/)
    })

    test('使用默认值', () => {
      expect(validateEnum(undefined, ['apple', 'banana'], { defaultValue: 'apple' })).toBe('apple')
    })
  })

  describe('validateArray', () => {
    test('允许合法数组', () => {
      expect(validateArray([1, 2, 3])).toEqual([1, 2, 3])
    })

    test('拒绝非数组', () => {
      expect(() => validateArray('not-array')).toThrow(/必须是数组/)
    })

    test('检查长度', () => {
      expect(validateArray([1, 2], { minLength: 1, maxLength: 5 })).toEqual([1, 2])
      expect(() => validateArray([], { minLength: 1 })).toThrow(/长度不足/)
      expect(() => validateArray([1, 2, 3], { maxLength: 2 })).toThrow(/长度超限/)
    })

    test('使用默认值', () => {
      expect(validateArray(undefined, { defaultValue: [] })).toEqual([])
    })
  })

  describe('validateISODate', () => {
    test('允许合法 ISO 日期', () => {
      expect(validateISODate('2024-01-01T00:00:00Z')).toBe('2024-01-01T00:00:00Z')
      expect(validateISODate('2024-12-31T23:59:59.999Z')).toBe('2024-12-31T23:59:59.999Z')
    })

    test('拒绝非法日期格式', () => {
      expect(() => validateISODate('not-a-date')).toThrow(/格式无效/)
      expect(() => validateISODate('invalid')).toThrow(/格式无效/)
      expect(() => validateISODate('2024-13-01')).toThrow(/格式无效/)
    })

    test('检查日期范围', () => {
      const minDate = new Date('2024-01-01T00:00:00Z')
      const maxDate = new Date('2024-12-31T23:59:59Z')

      expect(
        validateISODate('2024-06-15T12:00:00Z', { minDate, maxDate }),
      ).toBe('2024-06-15T12:00:00Z')

      expect(() =>
        validateISODate('2023-01-01T00:00:00Z', { minDate }),
      ).toThrow(/过早/)

      expect(() =>
        validateISODate('2025-01-01T00:00:00Z', { maxDate }),
      ).toThrow(/过晚/)
    })
  })

  describe('parseJSON', () => {
    test('解析合法 JSON', () => {
      expect(parseJSON('{"key": "value"}')).toEqual({ key: 'value' })
      expect(parseJSON('[1, 2, 3]')).toEqual([1, 2, 3])
    })

    test('拒绝非法 JSON', () => {
      expect(() => parseJSON('not-json')).toThrow(/解析失败/)
      expect(() => parseJSON('{key: value}')).toThrow(/解析失败/)
    })

    test('使用默认值', () => {
      expect(parseJSON('not-json', { defaultValue: {} })).toEqual({})
    })
  })

  describe('requireFields', () => {
    test('允许包含所有必填字段的对象', () => {
      const obj = { name: 'Alice', age: 30 }
      expect(requireFields(obj, ['name', 'age'])).toEqual(obj)
    })

    test('拒绝缺少必填字段', () => {
      const obj = { name: 'Bob' }
      expect(() => requireFields(obj, ['name', 'age'])).toThrow(/缺少必填字段.*age/)
    })

    test('拒绝非对象', () => {
      expect(() => requireFields('not-object', ['field'])).toThrow(/必须是对象/)
      expect(() => requireFields(null, ['field'])).toThrow(/必须是对象/)
    })

    test('允许额外字段', () => {
      const obj = { name: 'Charlie', age: 25, city: 'Beijing' }
      expect(requireFields(obj, ['name', 'age'])).toEqual(obj)
    })
  })
})
