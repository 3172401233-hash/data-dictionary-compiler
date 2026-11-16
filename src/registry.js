/**
 * 映射注册表：语义类型、物理类型、单位的所有“可猜测空间”都集中在这里。
 * 编译器只按注册表映射；未命中的一律产出 unresolved，不做隐式推断。
 */

/**
 * 物理类型解析规则。family 为规范化类型族，widensTo 声明类型族之间
 * 的向上转型链（同一 family 内参数放宽也视为 widening）。
 */
const PHYSICAL_TYPE_PATTERNS = [
  {
    re: /^(?:tinyint|smallint|integer|int|bigint|mediumint|int2|int4|int8|serial|bigserial)(?:\s*\(\s*\d+\s*\))?$/i,
    family: 'integer',
    rankOf: (text) => {
      const name = text.toLowerCase().replace(/\(.*\)/, '').trim();
      const ranks = {
        tinyint: 1, smallint: 2, int2: 2, mediumint: 3,
        int: 4, integer: 4, int4: 4, serial: 4,
        bigint: 5, int8: 5, bigserial: 5,
      };
      return ranks[name];
    },
  },
  {
    re: /^(?:decimal|numeric|dec|fixed|number)(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?$/i,
    family: 'decimal',
  },
  { re: /^(?:real|float4)$/i, family: 'float' },
  { re: /^(?:double|double\s+precision|float8|binary_double)$/i, family: 'double' },
  { re: /^(?:boolean|bool|bit)$/i, family: 'boolean' },
  { re: /^date$/i, family: 'date' },
  { re: /^time(\s*\(\s*\d+\s*\))?$/i, family: 'time' },
  { re: /^(?:datetime|datetime2|smalldatetime|timestamp(\s*(\(\s*\d+\s*\))?(\s+with(?:out)?\s+time\s+zone)?)?|timestamptz)$/i, family: 'timestamp' },
  { re: /^(?:char|character|nchar)(\s*\(\s*\d+\s*\))?$/i, family: 'string' },
  { re: /^(?:varchar|character\s+varying|nvarchar|nvarchar2|varchar2|text|tinytext|mediumtext|longtext|clob|string)(\s*\(\s*\d+\s*\))?$/i, family: 'string' },
  { re: /^(?:json|jsonb)$/i, family: 'json' },
  { re: /^(?:uuid|uniqueidentifier)$/i, family: 'uuid' },
  { re: /^(?:binary|varbinary|blob|bytea|raw)(\s*\(\s*\d+\s*\))?$/i, family: 'binary' },
];

/**
 * 类型族向上转型关系：A 在 B 之前表示 B 比 A 更宽。
 * 同 family 时再比较精度/小数位/长度等参数。
 */
const FAMILY_WIDTH_ORDER = ['boolean', 'integer', 'decimal', 'float', 'double'];

/**
 * 内置语义类型。rule 描述该语义类型固有的验证规则模板，
 * 由 rules.js 结合字段本身的单位、枚举、默认值补全。
 */
export const DEFAULT_SEMANTIC_TYPES = {
  id: {
    physicalFamilies: ['integer', 'string', 'uuid'],
    rule: { kind: 'identifier' },
  },
  text: {
    physicalFamilies: ['string'],
    rule: null,
  },
  integer: {
    physicalFamilies: ['integer'],
    rule: { kind: 'type', expected: 'integer' },
  },
  decimal: {
    physicalFamilies: ['decimal', 'float', 'double'],
    rule: { kind: 'type', expected: 'number' },
  },
  boolean: {
    physicalFamilies: ['boolean', 'integer'],
    rule: { kind: 'type', expected: 'boolean' },
  },
  date: {
    physicalFamilies: ['date', 'timestamp', 'string'],
    rule: { kind: 'format', format: 'date' },
  },
  timestamp: {
    physicalFamilies: ['timestamp', 'string'],
    rule: { kind: 'format', format: 'date-time' },
  },
  enum: {
    physicalFamilies: ['string', 'integer'],
    rule: null,
  },
  email: {
    physicalFamilies: ['string'],
    rule: { kind: 'format', format: 'email' },
  },
  url: {
    physicalFamilies: ['string'],
    rule: { kind: 'format', format: 'uri' },
  },
  phone: {
    physicalFamilies: ['string'],
    rule: { kind: 'format', format: 'phone' },
  },
  money: {
    physicalFamilies: ['decimal', 'integer', 'double'],
    rule: { kind: 'monetary' },
  },
  percent: {
    physicalFamilies: ['decimal', 'double', 'integer'],
    rule: { kind: 'range', min: 0, max: 100 },
  },
};

/**
 * 内置单位。conversions 仅登记“人工确认过”的线性换算关系，
 * 没有登记的单位对在 diff 时按不兼容处理，绝不自动猜系数。
 */
export const DEFAULT_UNITS = {
  none: { kind: 'none', conversions: {} },
  count: { kind: 'count', conversions: {} },
  meter: { kind: 'length', base: 'meter', factor: 1, conversions: { centimeter: 100, kilometer: 0.001 } },
  centimeter: { kind: 'length', base: 'meter', factor: 100, conversions: { meter: 0.01, kilometer: 0.00001 } },
  kilometer: { kind: 'length', base: 'meter', factor: 0.001, conversions: { meter: 1000, centimeter: 100000 } },
  gram: { kind: 'mass', base: 'gram', factor: 1, conversions: { kilogram: 0.001 } },
  kilogram: { kind: 'mass', base: 'gram', factor: 0.001, conversions: { gram: 1000 } },
  celsius: { kind: 'temperature', conversions: {} },
  percent: { kind: 'ratio', base: 'percent', factor: 1, conversions: {} },
  cent: { kind: 'currency', base: 'cent', factor: 1, conversions: { yuan: 0.01 } },
  yuan: { kind: 'currency', base: 'cent', factor: 100, conversions: { cent: 100 } },
  second: { kind: 'duration', base: 'second', factor: 1, conversions: { millisecond: 1000, minute: 1 / 60 } },
  millisecond: { kind: 'duration', base: 'second', factor: 1000, conversions: { second: 0.001 } },
  minute: { kind: 'duration', base: 'second', factor: 1 / 60, conversions: { second: 60 } },
};

export function createRegistry(options = {}) {
  const semanticTypes = {
    ...DEFAULT_SEMANTIC_TYPES,
    ...(options.semanticTypes ?? {}),
  };
  const units = {
    ...DEFAULT_UNITS,
    ...(options.units ?? {}),
  };

  return {
    semanticTypes,
    units,

    resolveSemanticType(name) {
      if (name === undefined || name === null) return { unresolved: true, reason: 'missing-semantic-type' };
      const entry = semanticTypes[String(name)];
      if (!entry) {
        return { unresolved: true, reason: `unknown-semantic-type:${name}` };
      }
      return { unresolved: false, entry };
    },

    resolveUnit(name) {
      if (name === undefined || name === null) return { name: 'none', unresolved: false, implicit: true };
      const entry = units[String(name)];
      if (!entry) {
        return { name: String(name), unresolved: true, reason: `unknown-unit:${name}` };
      }
      return { name: String(name), unresolved: false, entry };
    },

    /**
     * 返回两个单位之间的换算关系。
     * 同单位 -> identical；登记过换算 -> convertible；
     * 量纲相同但未登记系数 -> unregistered；量纲不同或未知 -> incompatible。
     */
    compareUnits(fromName, toName) {
      if (fromName === toName) return { relation: 'identical' };
      const from = units[fromName];
      const to = units[toName];
      if (!from || !to) {
        return { relation: 'unresolved', factor: null };
      }
      const direct = from.conversions?.[toName];
      if (typeof direct === 'number') {
        return { relation: 'convertible', factor: direct };
      }
      if (from.kind !== 'none' && from.kind === to.kind) {
        return { relation: 'unregistered', factor: null };
      }
      return { relation: 'incompatible', factor: null };
    },

    parsePhysicalType(raw) {
      if (raw === undefined || raw === null || raw === '') {
        return { unresolved: true, reason: 'missing-physical-type', raw: null };
      }
      const text = String(raw).trim();
      for (const pattern of PHYSICAL_TYPE_PATTERNS) {
        const { re, family } = pattern;
        const match = re.exec(text);
        if (match) {
          return {
            unresolved: false,
            raw: text,
            family,
            params: extractParams(text),
            ...(pattern.rankOf ? { rank: pattern.rankOf(text) } : {}),
          };
        }
      }
      return { unresolved: true, reason: `unknown-physical-type:${text}`, raw: text };
    },

    /**
     * 判断 to 相对 from 的类型变化方向：
     * widening（兼容）/ narrowing（破坏性）/ conflict（不同类型族无法转换）
     * / unchanged / unresolved（任一侧无法解析，不猜测）。
     */
    comparePhysicalTypes(from, to) {
      if (from.unresolved || to.unresolved) return { direction: 'unresolved' };
      if (from.raw === to.raw) return { direction: 'unchanged' };
      if (from.family !== to.family) {
        const fromWidth = FAMILY_WIDTH_ORDER.indexOf(from.family);
        const toWidth = FAMILY_WIDTH_ORDER.indexOf(to.family);
        if (fromWidth === -1 || toWidth === -1) {
          return { direction: 'conflict', from: from.family, to: to.family };
        }
        return fromWidth < toWidth
          ? { direction: 'widening', from: from.family, to: to.family }
          : { direction: 'narrowing', from: from.family, to: to.family };
      }
      if (from.family === 'integer' && (from.rank || to.rank)) {
        if (from.rank === to.rank) {
          return { direction: 'unchanged', from: from.raw, to: to.raw };
        }
        return {
          direction: to.rank > from.rank ? 'widening' : 'narrowing',
          from: from.raw,
          to: to.raw,
        };
      }
      const paramResult = compareParams(from.family, from.params, to.params);
      if (paramResult === 0) return { direction: 'unchanged', from: from.raw, to: to.raw };
      return {
        direction: paramResult > 0 ? 'widening' : 'narrowing',
        from: from.raw,
        to: to.raw,
      };
    },
  };
}

function extractParams(text) {
  const params = {};
  const precision = /\(\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(text);
  if (precision) {
    params.precision = Number(precision[1]);
    params.scale = Number(precision[2]);
    return params;
  }
  const length = /\(\s*(\d+)\s*\)/.exec(text);
  if (length) {
    params.length = Number(length[1]);
  }
  return params;
}

function compareParams(family, from, to) {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  let result = 0;
  for (const key of keys) {
    const a = from[key];
    const b = to[key];
    if (a === b) continue;
    if (a === undefined) {
      result = Math.max(result, 1);
      continue;
    }
    if (b === undefined) {
      result = Math.min(result, -1);
      continue;
    }
    if (b > a) result = Math.max(result, 1);
    else result = Math.min(result, -1);
  }
  if (family === 'decimal' && 'scale' in keys) {
    const scaleCmp = (to.scale ?? 0) - (from.scale ?? 0);
    if (scaleCmp !== 0 && result === 0) result = scaleCmp > 0 ? 1 : -1;
  }
  return result;
}
