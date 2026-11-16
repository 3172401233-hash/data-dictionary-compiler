import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compileDictionary, flattenFields } from '../src/index.js';
import { v1Dictionary, findByPath } from '../helpers/fixtures.mjs';

test('嵌套字段被递归规范化并按点路径展开', () => {
  const compiled = compileDictionary(v1Dictionary());
  const paths = flattenFields(compiled.fields).map((field) => field.path);
  assert.deepEqual(paths, [
    'order_id',
    'amount',
    'status',
    'contact',
    'contact.email',
    'contact.phone',
  ]);

  const email = findByPath(compiled, 'contact.email');
  assert.equal(email.physicalType.family, 'string');
  assert.equal(email.physicalType.params.length, 255);
  assert.equal(email.nullable, false);
});

test('未登记的语义/物理类型和单位保留 unresolved，不做猜测', () => {
  const compiled = compileDictionary({
    name: 'mystery',
    version: '1.0.0',
    fields: [
      {
        name: 'weird',
        semanticType: 'geohash',
        physicalType: 'GEOGRAPHY(Point)',
        unit: 'fathom',
        nullable: 'maybe',
      },
    ],
  });

  const field = findByPath(compiled, 'weird');
  assert.equal(field.unresolved, true);
  assert.equal(field.semanticType.unresolved, true);
  assert.match(field.semanticType.reason, /unknown-semantic-type:geohash/);
  assert.equal(field.physicalType.unresolved, true);
  assert.match(field.physicalType.reason, /unknown-physical-type:GEOGRAPHY/);
  assert.equal(field.unit.unresolved, true);
  assert.deepEqual(compiled.unresolved, ['weird']);

  const invalidNullable = field.issues.find((issue) => issue.code === 'invalid-nullable');
  assert.ok(invalidNullable);
  assert.equal(field.nullable, true);
});

test('枚举去重、非法值与默认值越界都会产生 issue', () => {
  const compiled = compileDictionary({
    name: 'issues',
    version: '1.0.0',
    fields: [
      {
        name: 'state',
        semanticType: 'enum',
        physicalType: 'VARCHAR(8)',
        nullable: false,
        enum: ['open', 'open', 'closed', { nested: true }],
        default: 'missing',
      },
    ],
  });

  const field = findByPath(compiled, 'state');
  assert.deepEqual(field.enum.values, ['open', 'closed']);
  const codes = field.issues.map((issue) => issue.code);
  assert.ok(codes.includes('duplicate-enum-value'));
  assert.ok(codes.includes('invalid-enum-value'));
  assert.ok(codes.includes('default-not-in-enum'));
});

test('语义类型与物理类型族冲突会被记录', () => {
  const compiled = compileDictionary({
    name: 'conflict',
    version: '1.0.0',
    fields: [
      {
        name: 'flag',
        semanticType: 'boolean',
        physicalType: 'JSON',
        nullable: true,
      },
    ],
  });

  const field = findByPath(compiled, 'flag');
  assert.ok(
    field.issues.some((issue) => issue.code === 'semantic-physical-conflict'),
  );
});

test('DLP 与 SQL 遗留格式通过适配器规范化', () => {
  const dlp = compileDictionary({
    name: 'legacy-dlp',
    version: '1.2.0',
    fields: [
      {
        field_name: 'user_email',
        semantic_type: 'email',
        physical_type: 'varchar(255)',
        is_nullable: 'NO',
      },
    ],
  });
  assert.equal(dlp.adapter, 'dlp');
  const field = findByPath(dlp, 'user_email');
  assert.equal(field.semanticType.name, 'email');
  assert.equal(field.nullable, false);

  const sql = compileDictionary({
    name: 'legacy-sql',
    version: '1.2.0',
    columns: [
      { column: 'ratio', semanticType: 'percent', type: 'DECIMAL(5,2)', nullable: true },
    ],
  });
  assert.equal(sql.adapter, 'sql');
  const ratio = findByPath(sql, 'ratio');
  assert.equal(ratio.physicalType.family, 'decimal');
});

test('结构性错误直接抛出而不是静默 unresolved', () => {
  assert.throws(
    () => compileDictionary({ version: '1.0.0', fields: [{ semanticType: 'text' }] }),
    /缺少 name/,
  );
  assert.throws(
    () => compileDictionary({
      version: '1.0.0',
      fields: [
        { name: 'a', semanticType: 'text', physicalType: 'TEXT' },
        { name: 'a', semanticType: 'text', physicalType: 'TEXT' },
      ],
    }),
    /字段名重复/,
  );
});
