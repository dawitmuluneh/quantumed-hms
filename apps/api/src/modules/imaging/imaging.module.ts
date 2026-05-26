import { Module } from '@nestjs/common';

import { ImagingReportsService } from './imaging-reports.service';
import { ImagingRequestsService } from './imaging-requests.service';
import { ImagingStudiesService } from './imaging-studies.service';
import { ImagingController } from './imaging.controller';

@Module({
  controllers: [ImagingController],
  providers: [ImagingRequestsService, ImagingStudiesService, ImagingReportsService],
  exports: [ImagingRequestsService, ImagingStudiesService, ImagingReportsService],
})
export class ImagingModule {}
