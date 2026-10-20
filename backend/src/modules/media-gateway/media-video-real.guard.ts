import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { MediaVideoRealService } from './media-video-real.service';

@Injectable()
export class MediaVideoRealGuard implements CanActivate {
  constructor(private readonly media: MediaVideoRealService) {}

  canActivate(context: ExecutionContext): boolean {
    const { method, route } = context.switchToHttp().getRequest();
    // Recovery and replay still authorize ownership in the service, even after disabling new jobs.
    if ((method === 'GET' || method === 'POST') && typeof route?.path === 'string' &&
      /\/requests(?:\/|$)/.test(route.path)) return true;
    this.media.assertRealEnabled();
    return true;
  }
}
