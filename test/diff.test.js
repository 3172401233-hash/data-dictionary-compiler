import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compileDictionary, compileHistory, diffDictionaries, createRegistry } from '../src/index.js';
import { v1Dictionary, v2Dictionary, findByPath } from '../helpers/fixtures.mjs';

function changeOf(report, code, path) {
  return report.changes.find((change) => change.code === code && change.path === path);
}

test('删除字段是破坏性变化，新增字段兼容', () => {
  const v1 = compileDictionary(v1Dictionary());
  const v2 = compileDictionary(v2Dictionary());
  const report = diffDictionaries(v1, v2, createRegistry());

  const shrunk = compileDictionary({
    ...v2Dictionary(),
    version: '2.1.0',
    fields: v2Dictionary().fields.filter((field) => field.name !== 'contact'),
  });
  const report2 = diffDictionaries(v2, shrunk, createRegistry());
  const removedNested = changeOf(report2, 'field-removed', 'contact.email');
  assert.equal(removedNested.severity, 'breaking');
  assert.equal(removedNested.compatible, false);

  const added = changeOf(report, 'field-added', 'created_at');
  assert.equal(added.severity, 'info');
  assert.equal(added.compatible, true);
});

test('枚举扩大兼容，枚举收窄（删除取值）是破坏性变化', () => {
  const v1 = compileDictionary(v1Dictionary());
  const v2 = compileDictionary(v2Dictionary());
  const widened = diffDictionaries(v1, v2, createRegistry());
  const widenedChange = changeOf(widened, 'enum-widened', 'status');
  assert.equal(widenedChange.compatible, true);
  assert.deepEqual(widenedChange.added, ['refunded']);

  const narrowed = compileDictionary({
    ...v1Dictionary(),
    version: '1.1.0',
    fields: v1Dictionary().fields.map((field) =>
      field.name === 'status'
        ? { ...field, enum: ['pending', 'paid'] }
        : field),
  });
  const report = diffDictionaries(v1, narrowed, createRegistry());
  const breaking = changeOf(report, 'enum-narrowed', 'status');
  assert.equal(breaking.severity, 'breaking');
  assert.deepEqual(breaking.removed, ['cancelled']);
  assert.equal(report.compatible, false);
});

test('物理类型放宽为 info，收窄与类型族冲突为 breaking', () => {
  const registry = createRegistry();
  const base = compileDictionary({
    name: 't',
    version: '1.0.0',
    fields: [
      { name: 'n', semanticType: 'integer', physicalType: 'INT', nullable: true },
    ],
  });

  const widened = compileDictionary({
    name: 't',
    version: '1.1.0',
    fields: [
      { name: 'n', semanticType: 'integer', physicalType: 'BIGINT', nullable: true },
    ],
  });
  const wideningReport = diffDictionaries(base, widened, registry);
  assert.equal(changeOf(wideningReport, 'physical-type-widening', 'n').severity, 'info');

  const narrowed = compileDictionary({
    name: 't',
    version: '2.0.0',
    fields: [
      { name: 'n', semanticType: 'integer', physicalType: 'SMALLINT', nullable: true },
    ],
  });
  const narrowingReport = diffDictionaries(widened, narrowed, registry);
  assert.equal(changeOf(narrowingReport, 'physical-type-narrowing', 'n').severity, 'breaking');

  const conflict = compileDictionary({
    name: 't',
    version: '3.0.0',
    fields: [
      { name: 'n', semanticType: 'text', physicalType: 'VARCHAR(32)', nullable: true },
    ],
  });
  const conflictReport = diffDictionaries(base, conflict, registry);
  assert.equal(changeOf(conflictReport, 'physical-type-conflict', 'n').severity, 'breaking');
});

test('单位变化：已登记换算给 warning 且保留系数，未登记/不兼容为 breaking', () => {
  const registry = createRegistry();
  const v1 = compileDictionary(v1Dictionary());
  const v2 = compileDictionary(v2Dictionary());
  const report = diffDictionaries(v1, v2, registry);
  const unitChange = changeOf(report, 'unit-changed-convertible', 'amount');
  assert.equal(unitChange.severity, 'warning');
  assert.equal(unitChange.factor, 0.01);
  assert.equal(unitChange.compatible, true);

  const fahrenheit = compileDictionary({
    ...v1Dictionary(),
    version: '1.1.0',
    fields: v1Dictionary().fields.map((field) =>
      field.name === 'amount' ? { ...field, unit: 'celsius' } : field),
  });
  const incompatible = diffDictionaries(v1, fahrenheit, registry);
  assert.equal(changeOf(incompatible, 'unit-incompatible', 'amount').severity, 'breaking');
});

test('默认值变化与移除产生 warning，新增默认值为 info', () => {
  const registry = createRegistry();
  const v1 = compileDictionary(v1Dictionary());
  const changed = compileDictionary({
    ...v1Dictionary(),
    version: '1.1.0',
    fields: v1Dictionary().fields.map((field) =>
      field.name === 'status' ? { ...field, default: 'paid' } : field),
  });
  const report = diffDictionaries(v1, changed, registry);
  const defaultChange = changeOf(report, 'default-changed', 'status');
  assert.equal(defaultChange.severity, 'warning');
  assert.equal(defaultChange.from, "'pending'");
  assert.equal(defaultChange.to, "'paid'");

  const withoutDefault = compileDictionary({
    ...v1Dictionary(),
    version: '1.2.0',
    fields: v1Dictionary().fields.map((field) => {
      const copy = { ...field };
      delete copy.default;
      return copy;
    }),
  });
  const removedReport = diffDictionaries(v1, withoutDefault, registry);
  assert.equal(changeOf(removedReport, 'default-removed', 'status').severity, 'warning');

  const withNewDefault = compileDictionary({
    ...v1Dictionary(),
    version: '1.3.0',
    fields: v1Dictionary().fields.map((field) =>
      field.name === 'order_id' ? { ...field, default: 0 } : field),
  });
  const addedReport = diffDictionaries(v1, withNewDefault, registry);
  assert.equal(changeOf(addedReport, 'default-added', 'order_id').severity, 'info');
});

test('可空性收紧为 breaking，放宽为 info', () => {
  const registry = createRegistry();
  const v1 = compileDictionary(v1Dictionary());
  const tightened = compileDictionary({
    ...v1Dictionary(),
    version: '1.1.0',
    fields: v1Dictionary().fields.map((field) =>
      field.name === 'contact' ? { ...field, nullable: false } : field),
  });
  const report = diffDictionaries(v1, tightened, registry);
  assert.equal(changeOf(report, 'nullable-tightened', 'contact').severity, 'breaking');

  const relaxed = compileDictionary({
    ...v1Dictionary(),
    version: '1.2.0',
    fields: v1Dictionary().fields.map((field) =>
      field.name === 'order_id' ? { ...field, nullable: true } : field),
  });
  const relaxedReport = diffDictionaries(v1, relaxed, registry);
  assert.equal(changeOf(relaxedReport, 'nullable-relaxed', 'order_id').severity, 'info');
});

test('版本回滚在 history 中被标记且整体不可视为兼容发布', () => {
  const v1 = v1Dictionary();
  const v2 = v2Dictionary();
  const rollbackInput = v1Dictionary({ version: '1.9.0' });

  const history = compileHistory([v2, rollbackInput, v1]);
  assert.deepEqual(history.versions, ['1.0.0', '1.9.0', '2.0.0']);
  assert.equal(history.diffs.length, 2);
  assert.equal(history.rollbacks.length, 2);
  assert.ok(history.diffs.every((diff) => diff.rollback === true));
  const rollbackReport = history.rollbacks[0];
  assert.equal(rollbackReport.from, '2.0.0');
  assert.equal(rollbackReport.to, '1.9.0');
  assert.equal(rollbackReport.rollback, true);
  assert.equal(rollbackReport.compatible, false);
  assert.ok(
    rollbackReport.changes.some((change) => change.code === 'field-removed' && change.path === 'created_at'),
  );
  const secondRollback = history.rollbacks[1];
  assert.equal(secondRollback.from, '1.9.0');
  assert.equal(secondRollback.to, '1.0.0');
});

test('无单位字段新增显式单位按不兼容处理', () => {
  const registry = createRegistry();
  const withoutUnit = compileDictionary({
    name: 'u',
    version: '1.0.0',
    fields: [{ name: 'x', semanticType: 'integer', physicalType: 'INT', nullable: true }],
  });
  const withUnit = compileDictionary({
    name: 'u',
    version: '1.1.0',
    fields: [{ name: 'x', semanticType: 'integer', physicalType: 'INT', nullable: true, unit: 'meter' }],
  });
  const report = diffDictionaries(withoutUnit, withUnit, registry);
  const change = changeOf(report, 'unit-incompatible', 'x');
  assert.equal(change.severity, 'breaking');
  assert.equal(change.from, 'none');
  assert.equal(change.to, 'meter');
});

test('任一侧 unresolved 时类型兼容性结论保持 unresolved', () => {
  const registry = createRegistry();
  const known = compileDictionary({
    name: 'u',
    version: '1.0.0',
    fields: [{ name: 'x', semanticType: 'text', physicalType: 'TEXT', nullable: true }],
  });
  const unknown = compileDictionary({
    name: 'u',
    version: '1.1.0',
    fields: [{ name: 'x', semanticType: 'text', physicalType: 'WIDGET', nullable: true }],
  });
  const report = diffDictionaries(known, unknown, registry);
  const change = changeOf(report, 'physical-type-unresolved', 'x');
  assert.equal(change.unresolved, true);
  assert.equal(change.severity, 'warning');
});

test('v1 -> v2 夹具整体兼容（只有 warning/info）', () => {
  const report = diffDictionaries(
    compileDictionary(v1Dictionary()),
    compileDictionary(v2Dictionary()),
    createRegistry(),
  );
  assert.equal(report.compatible, true);
  assert.deepEqual(report.breaking, []);
  assert.ok(report.warnings.some((change) => change.code === 'unit-changed-convertible'));
});

test('嵌套字段的变化按点路径定位', () => {
  const registry = createRegistry();
  const v1 = compileDictionary(v1Dictionary());
  const v2 = compileDictionary(v2Dictionary({
    fields: v2Dictionary().fields.map((field) =>
      field.name === 'contact'
        ? {
            ...field,
            fields: field.fields.map((child) =>
              child.name === 'phone' ? { ...child, nullable: false } : child),
          }
        : field),
  }));
  const report = diffDictionaries(v1, v2, registry);
  assert.equal(changeOf(report, 'nullable-tightened', 'contact.phone').severity, 'breaking');
});

test('findByPath 夹具自检', () => {
  const compiled = compileDictionary(v1Dictionary());
  assert.equal(findByPath(compiled, 'contact.email').name, 'email');
});
