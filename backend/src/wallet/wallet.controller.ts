import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WalletService } from './wallet.service';
import { DepositDto, WithdrawDto } from './dto/wallet.dto';

@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private walletService: WalletService) {}

  @Get()
  get(@Req() req: any) {
    return this.walletService.getWallet(req.user.userId);
  }

  @Get('transactions')
  transactions(@Req() req: any) {
    return this.walletService.getTransactions(req.user.userId);
  }

  @Post('deposit')
  deposit(@Req() req: any, @Body() dto: DepositDto) {
    return this.walletService.deposit(req.user.userId, dto);
  }

  @Post('withdraw')
  withdraw(@Req() req: any, @Body() dto: WithdrawDto) {
    return this.walletService.withdraw(req.user.userId, dto);
  }
}
