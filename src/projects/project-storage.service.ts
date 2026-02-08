import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ProjectStorageService {
  private readonly baseDir: string;

  constructor(private readonly configService: ConfigService) {
    const configured = this.configService.get<string>('storage.projects.baseDir');
    this.baseDir = configured && configured.trim().length
      ? configured.trim()
      : path.resolve(process.cwd(), 'uploads', 'projects');

    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  resolveKey(key: string) {
    const safeKey = String(key).replace(/\\/g, '/').replace(/^\/+/, '');
    if (safeKey.includes('..')) {
      throw new BadRequestException('Invalid storage key');
    }
    return path.resolve(this.baseDir, safeKey);
  }

  async putBuffer(params: { key: string; buffer: Buffer }) {
    const abs = this.resolveKey(params.key);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, params.buffer);
    return { key: params.key };
  }
}
