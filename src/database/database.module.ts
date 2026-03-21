import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MessageEntity, SessionEntity, UserEntity } from './entities';
import { databaseConfig } from '../config/configuration';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.getOrThrow<string>('DB_HOST'),
        port: configService.getOrThrow<number>('DB_PORT'),
        username: configService.getOrThrow<string>('DB_USERNAME'),
        password: configService.getOrThrow<string>('DB_PASSWORD'),
        database: configService.getOrThrow<string>('DB_DATABASE'),
        entities: [UserEntity, SessionEntity, MessageEntity],
        migrations: ['dist/database/migrations/*.js'],
        synchronize: true,
      }),
    }),
    TypeOrmModule.forFeature([UserEntity, SessionEntity, MessageEntity]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
