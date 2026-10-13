import { CanActivate, Injectable } from '@nestjs/common';
import { MediaGatewayService } from './media-gateway.service';

@Injectable()
export class MediaGatewayMockGuard implements CanActivate {
  constructor(private readonly media: MediaGatewayService) {}
  canActivate() {
    // Block disabled/production routes before Multer buffers any upload.
    this.media.assertMockEnabled();
    return true;
  }
}
