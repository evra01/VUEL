import { Controller, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CapturesService } from './captures.service';

@UseGuards(JwtAuthGuard)
@Controller('duels/:id/proof')
export class CapturesController {
  constructor(private capturesService: CapturesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  submit(@Req() req: any, @Param('id') duelId: string, @UploadedFile() file: Express.Multer.File) {
    return this.capturesService.submitProof(req.user.userId, duelId, file.buffer);
  }
}
