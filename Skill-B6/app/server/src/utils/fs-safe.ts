import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function ensureDirectories(dirs: string[]): void {
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
  }
}

export function assertSafeId(value: string, label = 'ID'): string {
  if (!value || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) {
    throw new Error(`${label} không hợp lệ: chỉ cho phép ký tự chữ, số, gạch dưới, gạch nối (1–80 ký tự).`);
  }
  return value;
}

export function slugifyTitle(title: string): string {
  const normalized = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || `project-${Date.now()}`;
}

/**
 * Resolve a project-relative path inside `root` and prevent path traversal or symlink escape.
 */
export function resolveInsideRoot(root: string, untrustedRelative: string, mustExist = false): string {
  if (!untrustedRelative || typeof untrustedRelative !== 'string') {
    throw new Error('Đường dẫn tương đối không được rỗng.');
  }
  if (untrustedRelative.includes('\0')) {
    throw new Error('Đường dẫn chứa byte null không hợp lệ.');
  }
  if (path.isAbsolute(untrustedRelative) || /^[a-zA-Z]+:/.test(untrustedRelative) || untrustedRelative.startsWith('\\\\')) {
    throw new Error(`Đường dẫn tuyệt đối bị chặn: ${untrustedRelative}`);
  }
  const realRoot = fs.realpathSync(path.resolve(root));
  const candidate = path.resolve(realRoot, untrustedRelative);

  if (candidate !== realRoot && !candidate.startsWith(realRoot + path.sep)) {
    throw new Error(`Path traversal bị chặn: ${untrustedRelative}`);
  }

  // Check existing ancestor realpath to block symlink escapes
  let checkPath = candidate;
  while (!fs.existsSync(checkPath)) {
    const parent = path.dirname(checkPath);
    if (parent === checkPath) break;
    checkPath = parent;
  }
  const realAncestor = fs.realpathSync(checkPath);
  if (realAncestor !== realRoot && !realAncestor.startsWith(realRoot + path.sep)) {
    throw new Error(`Symlink escape bị chặn: ${untrustedRelative}`);
  }

  if (mustExist && !fs.existsSync(candidate)) {
    throw new Error(`Không tìm thấy tệp/thư mục: ${untrustedRelative}`);
  }
  return candidate;
}

export async function writeAtomicFile(targetPath: string, data: string | Buffer): Promise<void> {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp.${process.pid}.${crypto.randomUUID()}`;
  const fh = await fsp.open(tmpPath, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }

  // On Windows NTFS, concurrent readers or indexing can briefly return EPERM/EBUSY/EACCES on rename-replace.
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fsp.rename(tmpPath, targetPath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt < maxAttempts && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
        await new Promise((r) => setTimeout(r, attempt * 20));
        continue;
      }
      await fsp.rm(tmpPath, { force: true }).catch(() => {});
      throw err;
    }
  }
}

export async function writeAtomicJson(targetPath: string, value: unknown): Promise<void> {
  await writeAtomicFile(targetPath, JSON.stringify(value, null, 2) + '\n');
}

export async function readJsonFile<T = unknown>(targetPath: string): Promise<T> {
  const raw = await fsp.readFile(targetPath, 'utf8');
  return JSON.parse(raw) as T;
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export function sha256Buffer(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function getFreeDiskBytes(targetPath: string): number {
  let checkPath = path.resolve(targetPath);
  while (!fs.existsSync(checkPath)) {
    const parent = path.dirname(checkPath);
    if (parent === checkPath) break;
    checkPath = parent;
  }
  const stats = fs.statfsSync(checkPath);
  return Number(stats.bavail) * Number(stats.bsize);
}

