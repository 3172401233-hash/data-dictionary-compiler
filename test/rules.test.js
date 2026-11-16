import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compileDictionary } from '../src/index.js';
import { v1Dictionary, findByPath } from '../helpers/fixtures.mjs';

test('非空、类型、枚举、默认值生成规范化规则', () => {
  const compiled = compileDictionary(v1Dictionary());
  const status = findByPath(compiled, 'status');
  const kinds = status.rules.map((rule) => rule.kind);

  assert.deepEqual(kinds, ['not-null', 'type', 'range', 'enum', 'default']);
  assert.deepEqual(
    status.rules.find((rule) => rule.kind === 'range').params,
    { maxLength: 16 },
  );
  const enumRule = status.rules.find((rule) => rule.kind === 'enum');
  assert.deepEqual(enumRule.params.values, ['pending', 'paid', 'cancelled']);
  const defaultRule = status.rules.find((rule) => rule.kind === 'default');
  assert.equal(defaultRule.params.sqlLiteral, "'pending'");
});

test('带长度的字符串与 decimal 精度生成 range 规则', () => {
  const compiled = compileDictionary(v1Dictionary());
  const email = findByPath(compiled, 'contact.email');
  const range = email.rules.find((rule) => rule.kind === 'range');
  assert.deepEqual(range.params, { maxLength: 255 });

  const amount = findByPath(compiled, 'amount');
  const decimalRange = amount.rules.find((rule) => rule.kind === 'range');
  assert.deepEqual(decimalRange.params, { precision: 12, scale: 2 });
});

test('percent 语义生成 0-100 范围规则', () => {
  const compiled = compileDictionary({
    name: 'ratios',
    version: '1.0.0',
    fields: [
      { name: 'ratio', semanticType: 'percent', physicalType: 'DECIMAL(5,2)', nullable: false },
    ],
  });
  const range = findByPath(compiled, 'ratio').rules.find((rule) => rule.kind === 'range');
  assert.deepEqual(range.params, { min: 0, max: 100 });
});

test('unresolved 字段输出 unresolved 规则而非伪造类型规则', () => {
  const compiled = compileDictionary({
    name: 'u',
    version: '1.0.0',
    fields: [
      { name: 'x', semanticType: 'wizardry', physicalType: 'MAGIC', unit: 'spell', nullable: true },
    ],
  });
  const field = findByPath(compiled, 'x');
  const kinds = field.rules.map((rule) => rule.kind);
  assert.ok(kinds.includes('unresolved'));
  assert.ok(!kinds.includes('format'));
});

test('单位规则只在显式声明单位时生成', () => {
  const compiled = compileDictionary(v1Dictionary());
  const amount = findByPath(compiled, 'amount');
  const unitRule = amount.rules.find((rule) => rule.kind === 'unit');
  assert.equal(unitRule.params.unit, 'cent');

  const orderId = findByPath(compiled, 'order_id');
  assert.equal(orderId.rules.find((rule) => rule.kind === 'unit'), undefined);
});
