import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import * as S from '@prolific/shared-types';

@Schema({ collection: 'employees', timestamps: true, autoIndex: true })
export class Employee
  extends Document
  implements Omit<S.Employee, 'id' | 'createdAt' | 'updatedAt'>
{
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: string;

  @Prop({ type: String, required: true, index: true })
  restaurantId!: string;

  @Prop({ type: String, required: true, index: true })
  branchId!: string;

  @Prop({ type: String, required: true, enum: Object.values(S.Role), index: true })
  role!: S.Role;

  @Prop({ type: String })
  pin?: string;

  @Prop({ type: String, unique: true, sparse: true })
  employeeNumber?: string;

  @Prop({ type: String })
  positionTitle?: string;

  @Prop({ type: [String], required: true, default: [] })
  assignedZoneIds!: string[];

  @Prop({ type: Date })
  joinedAt?: Date;
}

export const EmployeeSchema = SchemaFactory.createForClass(Employee);
EmployeeSchema.index({ userId: 1, branchId: 1 }, { unique: true });
EmployeeSchema.index({ branchId: 1, role: 1 });
