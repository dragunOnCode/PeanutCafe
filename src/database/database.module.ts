import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Message } from './entities/message.entity';
import { MessagePersistenceService } from './services/message-persistence.service';
import { databaseConfig } from '../config/configuration';

@Module({
  imports: [
    ConfigModule.forFeature(databaseConfig),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule.forFeature(databaseConfig)],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('database.host'),
        port: configService.get<number>('database.port'),
        username: configService.get<string>('database.username'),
        password: configService.get<string>('database.password'),
        database: configService.get<string>('database.database'),
        entities: [Message],
        synchronize: true,
      }),
    }),
    TypeOrmModule.forFeature([Message]),
  ],
  providers: [MessagePersistenceService],
  exports: [MessagePersistenceService],
})
export class DatabaseModule {}
