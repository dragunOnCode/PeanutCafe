import { IsNotEmpty, IsString, IsOptional, IsArray } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentionedAgents?: string[];
}
