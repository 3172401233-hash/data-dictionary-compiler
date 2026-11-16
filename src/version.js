/**
 * 语义版本号工具：只支持 major.minor.patch（可带前置标签），
 * 版本号是版本兼容性判断的唯一依据，因此这里显式解析而不依赖字符串比较。
 */

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(raw) {
  if (typeof raw !== 'string') {
    throw new TypeError(`版本号必须是字符串，收到 ${typeof raw}`);
  }
  const match = VERSION_RE.exec(raw.trim());
  if (!match) {
    throw new Error(`无法解析版本号: ${raw}`);
  }
  const [, major, minor, patch, prerelease] = match;
  return {
    raw: raw.trim(),
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ?? null,
  };
}

/**
 * 比较两个版本号：返回 -1 / 0 / 1。
 * 带前置标签的版本低于同号正式版本（1.0.0-alpha < 1.0.0）。
 */
export function compareVersions(a, b) {
  const left = typeof a === 'string' ? parseVersion(a) : a;
  const right = typeof b === 'string' ? parseVersion(b) : b;

  const keys = ['major', 'minor', 'patch'];
  for (const key of keys) {
    if (left[key] !== right[key]) {
      return left[key] < right[key] ? -1 : 1;
    }
  }

  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/**
 * 版本回滚：新版本号不高于（<=）已有版本号。
 */
export function isRollback(incomingVersion, existingVersion) {
  return compareVersions(incomingVersion, existingVersion) <= 0;
}

/**
 * 按版本号升序返回，回滚版本（<= 前一个版本）不会被重排，
 * 保持输入顺序以便 diff 报告准确反映发布次序。
 */
export function sortVersions(dicts) {
  return [...dicts].sort((a, b) => compareVersions(a.version, b.version));
}
