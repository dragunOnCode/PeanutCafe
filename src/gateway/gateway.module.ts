import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { SessionManager } from './session.manager';
import { MessageRouter } from './message.router';

@Module({
  providers: [ChatGateway, SessionManager, MessageRouter],
  exports: [SessionManager, MessageRouter],
})
export class GatewayModule {}
