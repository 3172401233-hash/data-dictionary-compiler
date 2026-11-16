import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseVersion, compareVersions, isRollback } from '../src/version.js';

test('parseVersion 解析 major.minor.patch 与前置标签', () => {
  const version = parseVersion('v2.1.0-beta.1');
  assert.deepEqual(
    { major: version.major, minor: version.minor, patch: version.patch, prerelease: version.prerelease },
    { major: 2, minor: 1, patch: 0, prerelease: 'beta.1' },
  );
});

test('parseVersion 拒绝非法版本号', () => {
  assert.throws(() => parseVersion('2.1'), /无法解析版本号/);
  assert.throws(() => parseVersion('latest'), /无法解析版本号/);
});

test('compareVersions 前置标签低于正式版', () => {
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
});

test('isRollback 识别同版本与降级发布', () => {
  assert.equal(isRollback('1.0.0', '1.0.0'), true);
  assert.equal(isRollback('1.9.0', '2.0.0'), true);
  assert.equal(isRollback('2.0.1', '2.0.0'), false);
});
