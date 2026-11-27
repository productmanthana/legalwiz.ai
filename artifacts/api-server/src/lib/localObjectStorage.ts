import { createReadStream } from 'fs';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';

/**
 * Disk-backed object storage for environments without Replit Object Storage
 * (local Docker / sandbox previews). Enabled by setting LOCAL_OBJECT_DIR;
 * when unset, the app keeps using Replit Object Storage unchanged.
 * Objects live at `${LOCAL_OBJECT_DIR}/uploads/<uuid>` with a `.json` sidecar for the content type.
 */
export const LOCAL_UPLOAD_ROUTE = '/api/storage/local-uploads/';

export function localObjectDir(): string | null {
  return process.env.LOCAL_OBJECT_DIR?.trim() || null;
}

const ID_RE = /^[0-9a-f-]{36}$/;

function fileFor(id: string): string {
  if (!ID_RE.test(id)) throw new Error('Invalid object id');
  return path.join(localObjectDir()!, 'uploads', id);
}

/** Minimal subset of the GCS File API the app uses, so callers stay storage-agnostic. */
export class LocalFile {
  readonly local = true;
  constructor(readonly id: string) {}

  get filePath() {
    return fileFor(this.id);
  }

  async exists(): Promise<boolean> {
    return stat(this.filePath).then(() => true, () => false);
  }

  async download(): Promise<[Buffer]> {
    return [await readFile(this.filePath)];
  }

  createReadStream() {
    return createReadStream(this.filePath);
  }

  async getMetadata(): Promise<[{ contentType?: string; size?: number }]> {
    const [s, meta] = await Promise.all([
      stat(this.filePath),
      readFile(`${this.filePath}.json`, 'utf8').then((t) => JSON.parse(t) as { contentType?: string }, () => ({ contentType: undefined })),
    ]);
    return [{ contentType: meta.contentType, size: s.size }];
  }
}

export async function saveLocalObject(id: string, body: Buffer, contentType: string): Promise<void> {
  const file = fileFor(id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  await writeFile(`${file}.json`, JSON.stringify({ contentType }));
}
