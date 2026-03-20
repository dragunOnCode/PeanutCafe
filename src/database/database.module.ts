import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './entities/message.entity';
import { MessagePersistenceService } from './services/message-persistence.service';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'lobster',
      entities: [Message],
      synchronize: true,
    }),
    TypeOrmModule.forFeature([Message]),
  ],
  providers: [MessagePersistenceService],
  exports: [MessagePersistenceService],
})
export class DatabaseModule {}