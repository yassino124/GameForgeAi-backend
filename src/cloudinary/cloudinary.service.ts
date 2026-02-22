import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';

const cloudinary = require('cloudinary').v2 as any;

@Injectable()
export class CloudinaryService {
  constructor(private readonly configService: ConfigService) {
    console.log('ENV CHECK:', process.env.CLOUDINARY_CLOUD_NAME);
    
    const cloudName = this.configService.get<string>('cloudinary.cloudName');
    const apiKey = this.configService.get<string>('cloudinary.apiKey');
    const apiSecret = this.configService.get<string>('cloudinary.apiSecret');

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
    }
  }

  async uploadAvatar(file: any): Promise<{ url: string; publicId: string }> {
    const cloudName = this.configService.get<string>('cloudinary.cloudName');
    const apiKey = this.configService.get<string>('cloudinary.apiKey');
    const apiSecret = this.configService.get<string>('cloudinary.apiSecret');

    if (!cloudName || !apiKey || !apiSecret) {
      throw new BadRequestException(
        'Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET',
      );
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });

    const folder = this.configService.get<string>('cloudinary.avatarFolder') || 'gameforge/avatars';

    if (!file?.buffer || !file?.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Invalid image file');
    }

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          folder,
          overwrite: false,
          transformation: [
            {
              width: 512,
              height: 512,
              crop: 'fill',
              gravity: 'auto',
              quality: 'auto',
              fetch_format: 'auto',
            },
          ],
        },
        (error: any, result: any) => {
          if (error) {
            return reject(error);
          }

          if (!result?.secure_url || !result?.public_id) {
            return reject(new Error('No result from Cloudinary'));
          }

          resolve(result);
        },
      );

        Readable.from(file.buffer).pipe(uploadStream);
      });

      return { url: result.secure_url, publicId: result.public_id };
    } catch {
      throw new BadRequestException('Failed to upload image');
    }
  }
}
