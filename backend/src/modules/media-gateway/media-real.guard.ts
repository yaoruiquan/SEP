import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { MediaRealService } from './media-real.service';

@Injectable()
export class MediaRealGuard implements CanActivate {
  constructor(private readonly media: MediaRealService) {}

  async canActivate(context: ExecutionContext) {
    const { method, route } = context.switchToHttp().getRequest();
    if (method === 'GET' && typeof route?.path === 'string' && route.path.includes('/requests/')) return true;
    await this.media.assertRealEnabled();
    return true;
  }
}
