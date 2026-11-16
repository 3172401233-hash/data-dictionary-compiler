/**
 * 规范化验证规则生成。
 * 每个叶子字段产出一组有序规则；字段处于 unresolved 状态时只输出可确定的
 * 规则（not-null、enum、default），并在字段级保留 unresolved 标记，
 * 下游必须自己决定如何处理，编译器不替它猜类型。
 */

export function buildRules(field) {
  const rules = [];

  if (!field.nullable) {
    rules.push({
      id: `${field.path}#not-null`,
      field: field.path,
      kind: 'not-null',
      params: {},
    });
  }

  const semanticRule = field.semanticType.unresolved
    ? null
    : buildSemanticRule(field);
  if (semanticRule) rules.push(semanticRule);

  if (field.physicalType.unresolved) {
    rules.push({
      id: `${field.path}#unresolved-physical-type`,
      field: field.path,
      kind: 'unresolved',
      params: { reason: field.physicalType.reason, raw: field.physicalType.raw },
    });
  } else {
    rules.push({
      id: `${field.path}#type`,
      field: field.path,
      kind: 'type',
      params: { family: field.physicalType.family, raw: field.physicalType.raw },
    });
    const rangeRule = buildRangeRule(field);
    if (rangeRule) rules.push(rangeRule);
  }

  if (field.enum.present && !field.enum.unresolved) {
    rules.push({
      id: `${field.path}#enum`,
      field: field.path,
      kind: 'enum',
      params: { values: [...field.enum.values] },
    });
  }
  if (field.enum.unresolved) {
    rules.push({
      id: `${field.path}#unresolved-enum`,
      field: field.path,
      kind: 'unresolved',
      params: { reason: field.enum.reason },
    });
  }

  if (field.unit.unresolved) {
    rules.push({
      id: `${field.path}#unresolved-unit`,
      field: field.path,
      kind: 'unresolved',
      params: { reason: field.unit.reason },
    });
  } else if (!field.unit.implicit && field.unit.entry?.kind && field.unit.entry.kind !== 'none') {
    rules.push({
      id: `${field.path}#unit`,
      field: field.path,
      kind: 'unit',
      params: { unit: field.unit.name, kind: field.unit.entry.kind },
    });
  }

  if (field.default.present) {
    rules.push({
      id: `${field.path}#default`,
      field: field.path,
      kind: field.default.unresolved ? 'unresolved' : 'default',
      params: field.default.unresolved
        ? { reason: field.default.reason }
        : { value: field.default.value, sqlLiteral: field.default.sqlLiteral },
    });
  }

  if (field.semanticType.unresolved) {
    rules.push({
      id: `${field.path}#unresolved-semantic-type`,
      field: field.path,
      kind: 'unresolved',
      params: { reason: field.semanticType.reason },
    });
  }

  return rules;
}

function buildSemanticRule(field) {
  const template = field.semanticType.entry.rule;
  if (!template) return null;
  const params = Object.fromEntries(
    Object.entries(template).filter(([key]) => key !== 'kind'),
  );
  return {
    id: `${field.path}#${template.kind}`,
    field: field.path,
    kind: template.kind,
    params,
  };
}

function buildRangeRule(field) {
  const params = field.physicalType.params;
  const range = {};
  if (field.physicalType.family === 'string' && typeof params.length === 'number') {
    range.maxLength = params.length;
  }
  if (field.physicalType.family === 'decimal' && typeof params.precision === 'number') {
    range.precision = params.precision;
    range.scale = params.scale ?? 0;
  }
  if (Object.keys(range).length === 0) return null;
  return {
    id: `${field.path}#range`,
    field: field.path,
    kind: 'range',
    params: range,
  };
}

export function buildAllRules(fields) {
  const result = [];
  const walk = (nodes) => {
    for (const field of nodes) {
      if (field.fields.length === 0) {
        result.push(...buildRules(field));
      } else {
        walk(field.fields);
      }
    }
  };
  walk(fields);
  return result;
}
