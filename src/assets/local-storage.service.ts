import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class LocalStorageService {
  private readonly baseDir: string;

  constructor(private readonly configService: ConfigService) {
    const configured = this.configService.get<string>('storage.local.baseDir');
    this.baseDir = configured && configured.trim().length
      ? configured.trim()
      : path.resolve(process.cwd(), 'uploads', 'assets');

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

  async exists(key: string) {
    const abs = this.resolveKey(key);
    try {
      await fs.promises.access(abs, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  createReadStream(key: string) {
    const abs = this.resolveKey(key);
    return fs.createReadStream(abs);
  }
}
