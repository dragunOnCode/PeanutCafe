import { IsString, IsNotEmpty } from 'class-validator';

export class DebugPromptDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  agentId: string;

  @IsString()
  @IsNotEmpty()
  prompt: string;
}
