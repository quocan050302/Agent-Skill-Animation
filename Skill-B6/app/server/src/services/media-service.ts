import fs from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { resolveInsideRoot } from '../utils/fs-safe.js';
import type { ProjectService } from './project-service.js';

const MIME_MAP: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

export class MediaService {
  constructor(private readonly projectService: ProjectService) {}

  async streamProjectMedia(
    projectId: string,
    relativePath: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const projectDir = this.projectService.getProjectDir(projectId);
    const decodedRel = decodeURIComponent(relativePath).replace(/^\/+/, '');
    const filePath = resolveInsideRoot(projectDir, decodedRel, true);

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      reply.code(404).send({ error: 'Không phải tệp hợp lệ.' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_MAP[ext] ?? 'application/octet-stream';
    const total = stat.size;
    const rangeHeader = request.headers.range;

    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'no-store');

    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = Number.parseInt(parts[0] ?? '0', 10);
      const end = parts[1] ? Number.parseInt(parts[1], 10) : Math.min(total - 1, start + 1024 * 1024 - 1);

      if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start >= total || end >= total || end < start) {
        reply.code(416).header('Content-Range', `bytes */${total}`).send();
        return;
      }

      const chunkSize = end - start + 1;
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${total}`);
      reply.header('Content-Length', chunkSize);
      return reply.send(fs.createReadStream(filePath, { start, end }));
    }

    reply.code(200);
    reply.header('Content-Length', total);
    return reply.send(fs.createReadStream(filePath));
  }
}
