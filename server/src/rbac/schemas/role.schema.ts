import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type { RoleDefinition as IRoleDefinition } from '@prolific/shared-types';
import { Permission, Role as RoleType } from '@prolific/shared-types';

@Schema({ collection: 'roles', timestamps: true, autoIndex: true })
export class RoleDefinition
  extends Document
  implements Omit<IRoleDefinition, 'createdAt' | 'updatedAt'>
{
  @Prop({
    type: String,
    required: true,
    unique: true,
    enum: Object.values(RoleType),
    index: true,
  })
  role!: RoleType;

  @Prop({
    type: [String],
    enum: Object.values(Permission),
    required: true,
    default: [],
  })
  permissions!: Permission[];

  @Prop({ type: String })
  description?: string;
}

export const RoleDefinitionSchema = SchemaFactory.createForClass(RoleDefinition);
RoleDefinitionSchema.index({ role: 1 }, { unique: true });
