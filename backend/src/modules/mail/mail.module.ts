import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { SettingModule } from '../setting/setting.module';

@Global()
@Module({
  imports: [SettingModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
