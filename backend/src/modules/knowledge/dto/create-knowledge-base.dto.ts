import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateKnowledgeBaseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}
