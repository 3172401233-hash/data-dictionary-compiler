import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compileDictionary, verifyArtifact, flattenFields } from '../src/index.js';
import { v1Dictionary, findByPath } from '../helpers/fixtures.mjs';

test('manifest 包含 DLP、SQL、验证规则三类产物及指纹', () => {
  const compiled = compileDictionary(v1Dictionary(), { now: '2026-11-16T00:00:00.000Z' });
  const { manifest } = compiled;

  assert.equal(manifest.version, '1.0.0');
  for (const name of ['dlp-masking-policy', 'sql-schema', 'validation-rules']) {
    assert.match(manifest.artifacts[name].fingerprint, /^[0-9a-f]{64}$/);
  }

  const leaves = flattenFields(compiled.fields);
  assert.equal(manifest.summary.totalFields, leaves.length);
  assert.equal(manifest.summary.unresolvedFields, 0);
});

test('DLP 条目按语义类型选择脱敏策略，unresolved 要求人工处理', () => {
  const compiled = compileDictionary(v1Dictionary());
  const emailEntry = compiled.manifest.artifacts['dlp-masking-policy'].entries
    .find((entry) => entry.path === 'contact.email');
  assert.equal(emailEntry.strategy, 'email-mask');

  const unresolved = compileDictionary({
    name: 'u',
    version: '1.0.0',
    fields: [
      { name: 'secret', semanticType: 'aura', physicalType: 'AURA', nullable: true },
    ],
  });
  const entry = unresolved.manifest.artifacts['dlp-masking-policy'].entries[0];
  assert.equal(entry.strategy, 'unresolved');
  assert.equal(entry.action, 'manual-review-required');
});

test('SQL 产物生成 DDL，unresolved 物理类型只输出注释占位', () => {
  const compiled = compileDictionary(v1Dictionary());
  const status = compiled.manifest.artifacts['sql-schema'].entries
    .find((entry) => entry.path === 'status');
  assert.equal(status.ddl, '"status" VARCHAR(16) NOT NULL DEFAULT \'pending\'');

  const unresolved = compileDictionary({
    name: 'u',
    version: '1.0.0',
    fields: [{ name: 'x', semanticType: 'text', physicalType: 'WIDGET', nullable: true }],
  });
  const entry = unresolved.manifest.artifacts['sql-schema'].entries[0];
  assert.equal(entry.physicalType, null);
  assert.match(entry.ddl, /^-- unresolved: x/);
});

test('字段定义变更后产物指纹变化，verifyArtifact 能发现过期副本', () => {
  const v1 = compileDictionary(v1Dictionary());
  const storedEntries = v1.manifest.artifacts['sql-schema'].entries;
  assert.equal(verifyArtifact(v1.manifest, 'sql-schema', storedEntries).upToDate, true);

  const rebuilt = compileDictionary({
    ...v1Dictionary(),
    fields: v1Dictionary().fields.map((field) =>
      field.name === 'status'
        ? { ...field, enum: [...field.enum, 'refunded'] }
        : field),
  });
  assert.equal(
    verifyArtifact(rebuilt.manifest, 'sql-schema', storedEntries).upToDate,
    false,
  );
});

test('嵌套字段路径贯穿 DLP 与验证产物', () => {
  const compiled = compileDictionary(v1Dictionary());
  const dlpPaths = compiled.manifest.artifacts['dlp-masking-policy'].entries.map((entry) => entry.path);
  assert.ok(dlpPaths.includes('contact.phone'));

  const validation = compiled.manifest.artifacts['validation-rules'].entries
    .find((entry) => entry.path === 'contact.email');
  assert.ok(validation.rules.some((rule) => rule.kind === 'format' && rule.params.format === 'email'));
});
