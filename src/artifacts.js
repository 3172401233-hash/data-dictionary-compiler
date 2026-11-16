/**
 * 下游产物清单（manifest）。
 * DLP 脱敏申请与下游 SQL 不再各自手抄字段定义，而是消费同一份 manifest；
 * 每个条目带来源字段路径和内容指纹，字段变更后指纹变化，便于发现过期副本。
 */

import { createHash } from 'node:crypto';
import { flattenFields } from './normalize.js';

const DLP_MASKING_STRATEGY = {
  email: 'email-mask',
  phone: 'tokenize',
  id: 'hash',
  text: 'redact',
  money: 'range-bucket',
  default: 'tokenize',
};

const STABLE_REPLACER = (_key, value) => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = value[key];
      return acc;
    }, {});
  }
  return value;
};

export function stableStringify(value) {
  return JSON.stringify(value, STABLE_REPLACER);
}

export function sha256(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/**
 * 单个字段的内容指纹：只纳入规范化后的语义定义，不含产物自身。
 */
export function fieldFingerprint(field) {
  return sha256({
    path: field.path,
    semanticType: field.semanticType.name,
    physicalType: field.physicalType.raw,
    physicalFamily: field.physicalType.family ?? null,
    unit: field.unit.name,
    nullable: field.nullable,
    enum: field.enum.present ? field.enum.values : [],
    default: field.default.present ? field.default.value : null,
    unresolved: field.unresolved,
  });
}

export function buildManifest(compiled) {
  const leaves = flattenFields(compiled.fields);
  const entries = leaves.map((field) => buildEntry(field, compiled.version));
  const dlp = entries
    .filter((entry) => entry.dlp !== null)
    .map((entry) => entry.dlp);
  const sql = entries.map((entry) => entry.sql);
  const validation = entries.map((entry) => entry.validation);

  const manifest = {
    dictionary: compiled.name,
    version: compiled.version,
    generatedAt: compiled.generatedAt,
    compilerVersion: compiled.compilerVersion,
    summary: {
      totalFields: entries.length,
      unresolvedFields: entries.filter((entry) => entry.unresolved).length,
    },
    fields: entries,
    artifacts: {
      'dlp-masking-policy': {
        kind: 'dlp-masking-policy',
        version: compiled.version,
        entries: dlp,
        fingerprint: sha256(dlp),
      },
      'sql-schema': {
        kind: 'sql-schema',
        version: compiled.version,
        entries: sql,
        fingerprint: sha256(sql),
      },
      'validation-rules': {
        kind: 'validation-rules',
        version: compiled.version,
        entries: validation,
        fingerprint: sha256(validation),
      },
    },
  };
  manifest.fingerprint = sha256({
    dictionary: manifest.dictionary,
    version: manifest.version,
    fields: manifest.fields,
  });
  return manifest;
}

function buildEntry(field, version) {
  const fingerprint = fieldFingerprint(field);
  return {
    path: field.path,
    version,
    fingerprint,
    unresolved: field.unresolved,
    unresolvedReasons: collectUnresolvedReasons(field),
    dlp: buildDlpEntry(field, fingerprint),
    sql: buildSqlEntry(field, fingerprint),
    validation: buildValidationEntry(field, fingerprint),
  };
}

function collectUnresolvedReasons(field) {
  const reasons = [];
  if (field.semanticType.unresolved) reasons.push(field.semanticType.reason);
  if (field.physicalType.unresolved) reasons.push(field.physicalType.reason);
  if (field.unit.unresolved) reasons.push(field.unit.reason);
  if (field.enum.unresolved) reasons.push(field.enum.reason);
  if (field.default.unresolved) reasons.push(field.default.reason);
  return reasons;
}

function buildDlpEntry(field, fingerprint) {
  if (field.semanticType.unresolved) {
    return {
      path: field.path,
      fingerprint,
      strategy: 'unresolved',
      reason: field.semanticType.reason,
      action: 'manual-review-required',
    };
  }
  const semanticName = field.semanticType.name;
  return {
    path: field.path,
    fingerprint,
    strategy: DLP_MASKING_STRATEGY[semanticName] ?? DLP_MASKING_STRATEGY.default,
    reason: `semantic-type:${semanticName}`,
    action: 'apply-policy',
  };
}

function buildSqlEntry(field, fingerprint) {
  const entry = {
    path: field.path,
    fingerprint,
    column: field.path.split('.').pop(),
    physicalType: field.physicalType.unresolved ? null : field.physicalType.raw,
    nullable: field.nullable,
    default: field.default.unresolved ? null : (field.default.present ? field.default.sqlLiteral : null),
    enumValues: field.enum.present && !field.enum.unresolved ? [...field.enum.values] : [],
    unit: field.unit.implicit ? null : field.unit.name,
    unresolved: field.unresolved,
  };
  if (field.physicalType.unresolved) {
    entry.ddl = `-- unresolved: ${field.path} (${field.physicalType.reason})`;
  } else {
    const parts = [`"${entry.column}" ${entry.physicalType}`];
    parts.push(entry.nullable ? 'NULL' : 'NOT NULL');
    if (entry.default !== null) parts.push(`DEFAULT ${entry.default}`);
    entry.ddl = parts.join(' ');
  }
  return entry;
}

function buildValidationEntry(field, fingerprint) {
  return {
    path: field.path,
    fingerprint,
    rules: field.rules.map((rule) => ({ id: rule.id, kind: rule.kind, params: rule.params })),
    unresolved: field.unresolved,
  };
}

/**
 * 校验下游副本是否仍与当前 manifest 一致。
 * 用于发现 DLP/SQL 侧手抄后漏改的过期产物。
 */
export function verifyArtifact(manifest, artifactName, storedEntries) {
  const artifact = manifest.artifacts[artifactName];
  if (!artifact) {
    throw new Error(`manifest 中不存在产物: ${artifactName}`);
  }
  const currentFingerprint = sha256(storedEntries);
  return {
    artifact: artifactName,
    currentFingerprint: artifact.fingerprint,
    storedFingerprint: currentFingerprint,
    upToDate: currentFingerprint === artifact.fingerprint,
  };
}
