/**
 * 输入适配与规范化。
 * 各数据域可能用不同的字段格式维护字典，这里先适配成统一描述符，
 * 再逐项走注册表解析。任何无法确定的映射只记录 unresolved，绝不猜测。
 */

const ADAPTERS = {
  canonical: {
    name: ['name'],
    semanticType: ['semanticType', 'semantic_type'],
    physicalType: ['physicalType', 'physical_type'],
    unit: ['unit'],
    nullable: ['nullable'],
    enum: ['enum', 'allowedValues', 'allowed_values'],
    default: ['default', 'defaultValue', 'default_value'],
    description: ['description', 'comment', 'desc'],
    children: ['fields', 'children', 'subFields', 'sub_fields'],
  },
  dlp: {
    name: ['field_name', 'column_name', 'name'],
    semanticType: ['semantic_type', 'data_classification', 'semanticType'],
    physicalType: ['physical_type', 'db_type', 'physicalType'],
    unit: ['unit', 'measure_unit'],
    nullable: ['is_nullable', 'nullable'],
    enum: ['allowed_values', 'enum_values', 'enum'],
    default: ['default_value', 'default'],
    description: ['description', 'comment'],
    children: ['sub_fields', 'nested_fields', 'fields'],
  },
  sql: {
    name: ['column', 'column_name', 'name'],
    semanticType: ['semantic_type', 'semanticType'],
    physicalType: ['type', 'data_type', 'physicalType'],
    unit: ['unit'],
    nullable: ['nullable', 'is_nullable'],
    enum: ['values', 'enum', 'allowed_values'],
    default: ['default', 'column_default'],
    description: ['comment', 'description'],
    children: ['fields', 'sub_fields'],
  },
};

export function detectAdapter(input) {
  const sample = findSample(input);
  if (!sample) return 'canonical';
  if ('field_name' in sample || 'db_type' in sample || 'is_nullable' in sample) return 'dlp';
  if ('column' in sample || ('type' in sample && !('physicalType' in sample))) return 'sql';
  return 'canonical';
}

function findSample(input) {
  const fields = input?.fields ?? input?.columns;
  return Array.isArray(fields) && fields.length > 0 ? fields[0] : null;
}

function pick(raw, keys) {
  for (const key of keys) {
    if (raw[key] !== undefined) return raw[key];
  }
  return undefined;
}

function toCanonical(raw, adapterName) {
  const adapter = ADAPTERS[adapterName] ?? ADAPTERS.canonical;
  return {
    name: pick(raw, adapter.name),
    semanticType: pick(raw, adapter.semanticType),
    physicalType: pick(raw, adapter.physicalType),
    unit: pick(raw, adapter.unit),
    nullable: pick(raw, adapter.nullable),
    enum: pick(raw, adapter.enum),
    default: pick(raw, adapter.default),
    description: pick(raw, adapter.description),
    fields: pick(raw, adapter.children),
  };
}

export function validateInput(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('字典输入必须是对象');
  }
  if (!input.version) throw new Error('字典缺少 version');
  const fields = input.fields ?? input.columns;
  if (!Array.isArray(fields)) throw new Error(`字典 ${input.version} 缺少 fields 数组`);
  validateFieldTree(fields, '$');
}

function validateFieldTree(fields, parentPath) {
  const seen = new Set();
  for (const raw of fields) {
    if (raw === null || typeof raw !== 'object') {
      throw new Error(`${parentPath} 下存在非对象字段描述符`);
    }
    const name = raw.name ?? raw.field_name ?? raw.column_name ?? raw.column;
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`${parentPath} 下存在缺少 name 的字段`);
    }
    if (seen.has(name)) {
      throw new Error(`${parentPath} 下字段名重复: ${name}`);
    }
    seen.add(name);
    const children = raw.fields ?? raw.children ?? raw.sub_fields ?? raw.subFields ?? raw.nested_fields;
    if (children !== undefined) {
      if (!Array.isArray(children)) throw new Error(`字段 ${name} 的嵌套字段必须是数组`);
      validateFieldTree(children, `${parentPath}.${name}`);
    }
  }
}

export function normalizeDictionary(input, registry, options = {}) {
  validateInput(input);
  const adapter = options.adapter === 'auto' || !options.adapter
    ? detectAdapter(input)
    : options.adapter;
  const rawFields = input.fields ?? input.columns;
  const fields = rawFields.map((raw) => normalizeField(raw, registry, '', adapter));

  return {
    name: input.name ?? 'dictionary',
    version: String(input.version),
    adapter,
    fields,
    unresolved: collectPaths(fields).unresolved,
    issues: collectIssues(fields),
  };
}

function normalizeField(rawField, registry, parentPath, adapter) {
  const descriptor = toCanonical(rawField, adapter);
  const name = descriptor.name;
  const path = parentPath ? `${parentPath}.${name}` : name;
  const issues = [];

  const semantic = registry.resolveSemanticType(descriptor.semanticType);
  const physical = registry.parsePhysicalType(descriptor.physicalType);
  const unit = registry.resolveUnit(descriptor.unit);
  const nullable = normalizeNullable(descriptor.nullable, issues, path);
  const enumeration = normalizeEnum(descriptor.enum, issues, path);
  const defaultValue = normalizeDefault(descriptor.default, enumeration, nullable, issues, path);

  if (!semantic.unresolved && !physical.unresolved) {
    const allowedFamilies = semantic.entry.physicalFamilies ?? [];
    if (allowedFamilies.length > 0 && !allowedFamilies.includes(physical.family)) {
      issues.push({
        code: 'semantic-physical-conflict',
        path,
        message: `语义类型 ${descriptor.semanticType} 不接受物理类型族 ${physical.family}`,
      });
    }
  }

  const children = Array.isArray(descriptor.fields)
    ? descriptor.fields.map((child) => normalizeField(child, registry, path, adapter))
    : [];

  const unresolvedParts = [semantic, physical, unit, enumeration, defaultValue];
  const unresolved = unresolvedParts.some((part) => part.unresolved)
    || children.some((child) => child.unresolved);

  return {
    path,
    name,
    description: descriptor.description ?? null,
    semanticType: {
      name: descriptor.semanticType === undefined ? null : String(descriptor.semanticType),
      ...semantic,
    },
    physicalType: physical,
    unit: { ...unit },
    nullable,
    enum: enumeration,
    default: defaultValue,
    fields: children,
    unresolved,
    issues,
  };
}

function normalizeNullable(raw, issues, path) {
  if (raw === undefined) return true;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const lowered = raw.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(lowered)) return true;
    if (['false', 'no', 'n', '0'].includes(lowered)) return false;
  }
  if (typeof raw === 'number' && (raw === 0 || raw === 1)) return raw === 1;
  issues.push({
    code: 'invalid-nullable',
    path,
    message: `无法解释的可空性声明: ${String(raw)}，按可空处理`,
  });
  return true;
}

function normalizeEnum(raw, issues, path) {
  if (raw === undefined) {
    return { present: false, values: [], unresolved: false };
  }
  if (!Array.isArray(raw)) {
    return {
      present: true,
      values: [],
      unresolved: true,
      reason: `enum-not-array:${typeof raw}`,
    };
  }
  if (raw.length === 0) {
    issues.push({ code: 'empty-enum', path, message: '枚举声明为空数组' });
  }
  const seen = new Set();
  const values = [];
  for (const value of raw) {
    if (value === null || (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')) {
      issues.push({
        code: 'invalid-enum-value',
        path,
        message: '枚举值只允许 string/number/boolean 原始值',
      });
      continue;
    }
    const key = `${typeof value}:${String(value)}`;
    if (seen.has(key)) {
      issues.push({ code: 'duplicate-enum-value', path, message: `重复枚举值: ${String(value)}` });
      continue;
    }
    seen.add(key);
    values.push(value);
  }
  return { present: true, values, unresolved: false };
}

function normalizeDefault(raw, enumeration, nullable, issues, path) {
  if (raw === undefined) {
    return { present: false, value: undefined, sqlLiteral: null, unresolved: false };
  }
  if (raw === null) {
    if (!nullable) {
      issues.push({
        code: 'null-default-on-non-nullable',
        path,
        message: '非空字段声明了 NULL 默认值',
      });
    }
    return { present: true, value: null, sqlLiteral: 'NULL', unresolved: false };
  }
  if (enumeration.present && !enumeration.unresolved && !enumeration.values.includes(raw)) {
    issues.push({
      code: 'default-not-in-enum',
      path,
      message: `默认值 ${String(raw)} 不在枚举集合内`,
    });
  }
  const literal = toSqlLiteral(raw);
  if (literal.unresolved) {
    issues.push({
      code: 'unresolvable-default-literal',
      path,
      message: `无法为默认值生成 SQL 字面量: ${literal.reason}`,
    });
  }
  return {
    present: true,
    value: raw,
    sqlLiteral: literal.sqlLiteral,
    unresolved: literal.unresolved,
    reason: literal.reason,
  };
}

export function toSqlLiteral(value) {
  if (value === null || value === undefined) {
    return { sqlLiteral: 'NULL', unresolved: false };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { sqlLiteral: null, unresolved: true, reason: 'non-finite-number' };
    return { sqlLiteral: String(value), unresolved: false };
  }
  if (typeof value === 'boolean') return { sqlLiteral: value ? 'TRUE' : 'FALSE', unresolved: false };
  if (typeof value === 'string') {
    return { sqlLiteral: `'${value.replace(/'/g, "''")}'`, unresolved: false };
  }
  return { sqlLiteral: null, unresolved: true, reason: `unsupported-default-type:${typeof value}` };
}

export function flattenFields(fields) {
  const result = [];
  const walk = (nodes) => {
    for (const field of nodes) {
      result.push(field);
      if (field.fields.length > 0) walk(field.fields);
    }
  };
  walk(fields);
  return result;
}

function collectPaths(fields) {
  const unresolved = [];
  for (const field of flattenFields(fields)) {
    if (field.unresolved) unresolved.push(field.path);
  }
  return { unresolved };
}

function collectIssues(fields) {
  return flattenFields(fields).flatMap((field) => field.issues);
}
