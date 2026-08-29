import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Mark a route (or entire controller) as public — skip JWT guard
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
