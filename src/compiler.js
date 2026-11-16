/**
 * 编译器入口：规范化 -> 验证规则 -> 下游产物清单。
 */

import { createRegistry } from './registry.js';
import { normalizeDictionary, flattenFields } from './normalize.js';
import { buildAllRules, buildRules } from './rules.js';
import { buildManifest } from './artifacts.js';
import { diffDictionaries } from './diff.js';
import { parseVersion, compareVersions } from './version.js';

export const COMPILER_VERSION = '1.0.0';

export function compileDictionary(input, options = {}) {
  parseVersion(input.version);
  const registry = options.registry ?? createRegistry(options.registryOverrides);
  const normalized = normalizeDictionary(input, registry, { adapter: options.adapter });

  const withRules = attachRules(normalized);
  const generatedAt = options.now ?? new Date().toISOString();
  const compiled = {
    ...withRules,
    generatedAt,
    compilerVersion: COMPILER_VERSION,
    rules: buildAllRules(withRules.fields),
  };
  compiled.manifest = buildManifest(compiled);

  return compiled;
}

function attachRules(normalized) {
  const walk = (fields) => fields.map((field) => ({
    ...field,
    rules: field.fields.length === 0 ? buildRules(field) : [],
    fields: walk(field.fields),
  }));
  return { ...normalized, fields: walk(normalized.fields) };
}

/**
 * 编译一组按版本维护的字典，并对相邻版本做兼容性检查。
 * diff 按输入顺序（即发布顺序）计算以识别回滚；dictionaries 另按版本号排序返回。
 */
export function compileHistory(dictInputs, options = {}) {
  const registry = options.registry ?? createRegistry(options.registryOverrides);
  const parsed = dictInputs.map((input) => {
    parseVersion(input.version);
    return compileDictionary(input, { ...options, registry });
  });
  const ordered = [...parsed].sort((a, b) => compareVersions(a.version, b.version));

  // diff 必须按“发布顺序”（输入顺序）计算，否则回滚发布会被排序掩盖。
  const diffs = [];
  for (let index = 1; index < parsed.length; index += 1) {
    diffs.push(diffDictionaries(parsed[index - 1], parsed[index], registry));
  }

  return {
    versions: ordered.map((dict) => dict.version),
    dictionaries: ordered,
    diffs,
    rollbacks: diffs.filter((diff) => diff.rollback),
  };
}

export { createRegistry, flattenFields };
