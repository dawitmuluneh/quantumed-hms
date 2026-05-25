import { Global, Module } from '@nestjs/common';

import { FieldEncryptionService } from './field-encryption.service';
import { KMS_PORT } from './kms.port';
import { LocalKmsAdapter } from './local-kms.adapter';

@Global()
@Module({
  providers: [
    LocalKmsAdapter,
    { provide: KMS_PORT, useExisting: LocalKmsAdapter },
    FieldEncryptionService,
  ],
  exports: [FieldEncryptionService, KMS_PORT],
})
export class EncryptionModule {}
