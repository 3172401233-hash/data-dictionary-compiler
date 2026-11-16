/**
 * 版本间兼容性检查。
 * 破坏性变化（删除字段、缩小枚举、类型收窄/冲突、单位不可换算、收紧可空性）
 * 统一标记 breaking；可自动兼容的标记 info；需要人工确认的标记 warning。
 * 凡任一侧定义处于 unresolved，结论也保持 unresolved，不猜测兼容性。
 */

import { flattenFields } from './normalize.js';
import { isRollback } from './version.js';

export function diffDictionaries(previous, next, registry) {
  const prevMap = new Map(flattenFields(previous.fields).map((field) => [field.path, field]));
  const nextMap = new Map(flattenFields(next.fields).map((field) => [field.path, field]));
  const changes = [];

  for (const [path, field] of prevMap) {
    if (!nextMap.has(path)) {
      changes.push({
        code: 'field-removed',
        severity: 'breaking',
        path,
        compatible: false,
        message: `字段 ${path} 在 ${next.version} 中被删除`,
      });
    }
  }

  for (const [path, field] of nextMap) {
    if (!prevMap.has(path)) {
      changes.push({
        code: 'field-added',
        severity: 'info',
        path,
        compatible: true,
        message: `新增字段 ${path}`,
      });
      continue;
    }
    changes.push(...diffField(prevMap.get(path), field, registry));
  }

  const rollback = isRollback(next.version, previous.version);
  return {
    from: previous.version,
    to: next.version,
    rollback,
    changes,
    breaking: changes.filter((change) => change.severity === 'breaking'),
    warnings: changes.filter((change) => change.severity === 'warning'),
    compatible: rollback
      ? false
      : changes.every((change) => change.severity !== 'breaking'),
  };
}

function diffField(prev, next, registry) {
  const changes = [];
  const push = (change) => changes.push({ path: prev.path, ...change });

  diffSemanticType(prev, next, push);
  diffPhysicalType(prev, next, registry, push);
  diffUnit(prev, next, registry, push);
  diffNullable(prev, next, push);
  diffEnum(prev, next, push);
  diffDefault(prev, next, push);

  return changes;
}

function diffSemanticType(prev, next, push) {
  if (prev.semanticType.name === next.semanticType.name) return;
  if (prev.semanticType.unresolved || next.semanticType.unresolved) {
    push({
      code: 'semantic-type-unresolved',
      severity: 'warning',
      compatible: false,
      unresolved: true,
      from: prev.semanticType.name,
      to: next.semanticType.name,
      message: `${prev.path} 语义类型变化无法确认（${prev.semanticType.name} -> ${next.semanticType.name}）`,
    });
    return;
  }
  push({
    code: 'semantic-type-changed',
    severity: 'breaking',
    compatible: false,
    from: prev.semanticType.name,
    to: next.semanticType.name,
    message: `${prev.path} 语义类型改变: ${prev.semanticType.name} -> ${next.semanticType.name}`,
  });
}

function diffPhysicalType(prev, next, registry, push) {
  const comparison = registry.comparePhysicalTypes(prev.physicalType, next.physicalType);
  if (comparison.direction === 'unchanged') return;

  if (comparison.direction === 'unresolved') {
    push({
      code: 'physical-type-unresolved',
      severity: 'warning',
      compatible: false,
      unresolved: true,
      from: prev.physicalType.raw,
      to: next.physicalType.raw,
      message: `${prev.path} 物理类型无法解析，兼容性未知`,
    });
    return;
  }

  const severityByDirection = {
    widening: 'info',
    narrowing: 'breaking',
    conflict: 'breaking',
  };
  push({
    code: `physical-type-${comparison.direction}`,
    severity: severityByDirection[comparison.direction],
    compatible: comparison.direction === 'widening',
    from: comparison.from ?? prev.physicalType.raw,
    to: comparison.to ?? next.physicalType.raw,
    message: `${prev.path} 物理类型${directionLabel(comparison.direction)}: ${prev.physicalType.raw} -> ${next.physicalType.raw}`,
  });
}

function diffUnit(prev, next, registry, push) {
  if (prev.unit.name === next.unit.name) return;
  const comparison = registry.compareUnits(prev.unit.name, next.unit.name);

  if (comparison.relation === 'convertible') {
    push({
      code: 'unit-changed-convertible',
      severity: 'warning',
      compatible: true,
      from: prev.unit.name,
      to: next.unit.name,
      factor: comparison.factor,
      message: `${prev.path} 单位变化可换算: ${prev.unit.name} -> ${next.unit.name}（系数 ${comparison.factor}），下游需显式换算`,
    });
    return;
  }

  if (comparison.relation === 'unregistered') {
    push({
      code: 'unit-changed-unregistered',
      severity: 'warning',
      compatible: false,
      unresolved: true,
      from: prev.unit.name,
      to: next.unit.name,
      message: `${prev.path} 单位同量纲但未登记换算系数: ${prev.unit.name} -> ${next.unit.name}`,
    });
    return;
  }

  push({
    code: 'unit-incompatible',
    severity: 'breaking',
    compatible: false,
    unresolved: comparison.relation === 'unresolved',
    relation: comparison.relation,
    from: prev.unit.name,
    to: next.unit.name,
    message: `${prev.path} 单位不兼容: ${prev.unit.name} -> ${next.unit.name}`,
  });
}

function diffNullable(prev, next, push) {
  if (prev.nullable === next.nullable) return;
  if (prev.nullable && !next.nullable) {
    push({
      code: 'nullable-tightened',
      severity: 'breaking',
      compatible: false,
      from: true,
      to: false,
      message: `${prev.path} 由可空收紧为非空，历史 NULL 数据将无法写入`,
    });
    return;
  }
  push({
    code: 'nullable-relaxed',
    severity: 'info',
    compatible: true,
    from: false,
    to: true,
    message: `${prev.path} 由非空放宽为可空`,
  });
}

function diffEnum(prev, next, push) {
  if (!prev.enum.present && next.enum.present) {
    push({
      code: 'enum-added',
      severity: 'warning',
      compatible: false,
      values: [...next.enum.values],
      message: `${prev.path} 新增枚举约束，历史数据可能不满足新枚举`,
    });
    return;
  }
  if (prev.enum.present && !next.enum.present) {
    push({
      code: 'enum-removed',
      severity: 'info',
      compatible: true,
      message: `${prev.path} 移除枚举约束`,
    });
    return;
  }
  if (!prev.enum.present || !next.enum.present) return;
  if (prev.enum.unresolved || next.enum.unresolved) {
    push({
      code: 'enum-unresolved',
      severity: 'warning',
      compatible: false,
      unresolved: true,
      message: `${prev.path} 枚举定义无法解析，兼容性未知`,
    });
    return;
  }

  const oldValues = new Set(prev.enum.values.map(String));
  const newValues = new Set(next.enum.values.map(String));
  const removed = [...oldValues].filter((value) => !newValues.has(value));
  const added = [...newValues].filter((value) => !oldValues.has(value));
  if (removed.length === 0 && added.length === 0) return;

  if (removed.length > 0) {
    push({
      code: added.length === 0 ? 'enum-narrowed' : 'enum-changed',
      severity: 'breaking',
      compatible: false,
      removed,
      added,
      message: `${prev.path} 枚举删除取值 ${removed.join(', ')}，历史数据将无法通过校验`,
    });
    return;
  }
  push({
    code: 'enum-widened',
    severity: 'info',
    compatible: true,
    removed,
    added,
    message: `${prev.path} 枚举扩大，新增取值 ${added.join(', ')}`,
  });
}

function diffDefault(prev, next, push) {
  if (!prev.default.present && next.default.present) {
    push({
      code: 'default-added',
      severity: 'info',
      compatible: true,
      from: null,
      to: next.default.unresolved ? null : next.default.sqlLiteral,
      message: `${prev.path} 新增默认值`,
    });
    return;
  }
  if (prev.default.present && !next.default.present) {
    push({
      code: 'default-removed',
      severity: 'warning',
      compatible: false,
      from: prev.default.unresolved ? null : prev.default.sqlLiteral,
      to: null,
      message: `${prev.path} 移除默认值，依赖默认值的写入行为会改变`,
    });
    return;
  }
  if (!prev.default.present || !next.default.present) return;
  if (prev.default.unresolved || next.default.unresolved) {
    push({
      code: 'default-unresolved',
      severity: 'warning',
      compatible: false,
      unresolved: true,
      message: `${prev.path} 默认值存在无法解析的字面量，兼容性未知`,
    });
    return;
  }
  if (prev.default.sqlLiteral !== next.default.sqlLiteral) {
    push({
      code: 'default-changed',
      severity: 'warning',
      compatible: false,
      from: prev.default.sqlLiteral,
      to: next.default.sqlLiteral,
      message: `${prev.path} 默认值变化: ${prev.default.sqlLiteral} -> ${next.default.sqlLiteral}`,
    });
  }
}

function directionLabel(direction) {
  const labels = {
    widening: '放宽',
    narrowing: '收窄',
    conflict: '冲突',
  };
  return labels[direction] ?? direction;
}
