import { compileDictionary, compileHistory, verifyArtifact } from '../src/index.js';

const v1 = {
  name: 'orders',
  version: '1.0.0',
  fields: [
    {
      name: 'amount',
      semanticType: 'money',
      physicalType: 'DECIMAL(12,2)',
      unit: 'cent',
      nullable: false,
      default: 0,
    },
    {
      name: 'status',
      semanticType: 'enum',
      physicalType: 'VARCHAR(16)',
      nullable: false,
      enum: ['pending', 'paid'],
    },
    {
      name: 'mystery',
      semanticType: 'geohash',
      physicalType: 'GEOGRAPHY(Point)',
      nullable: true,
    },
  ],
};

const v2 = {
  ...v1,
  version: '2.0.0',
  fields: [
    { ...v1.fields[0], unit: 'yuan' },
    { ...v1.fields[1], enum: ['pending', 'paid', 'refunded'] },
    v1.fields[2],
  ],
};

const history = compileHistory([v1, v2]);

for (const dict of history.dictionaries) {
  console.log(`\n== ${dict.version} ==`);
  console.log('unresolved:', dict.unresolved);
  console.log('DLP 条目:', dict.manifest.artifacts['dlp-masking-policy'].entries);
  console.log('SQL DDL:', dict.manifest.artifacts['sql-schema'].entries.map((entry) => entry.ddl));
}

console.log('\n== 兼容性报告 1.0.0 -> 2.0.0 ==');
for (const change of history.diffs[0].changes) {
  console.log(`[${change.severity}] ${change.code} ${change.path ?? ''} ${change.message}`);
}

const stored = history.dictionaries[0].manifest.artifacts['sql-schema'].entries;
console.log('\n下游副本是否过期:', verifyArtifact(history.dictionaries[1].manifest, 'sql-schema', stored));
