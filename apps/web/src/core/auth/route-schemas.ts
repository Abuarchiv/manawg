import { z } from 'zod';
import { MEMBER_NAME_MAX_LENGTH } from '@/shared/lib/limits';

export const emailField = z.string().trim().toLowerCase().email().max(254);
// Strength is Supabase's call (`weak_password`); only bound the size here.
export const passwordField = z.string().min(1).max(256);
export const nameField = z.string().trim().min(1).max(MEMBER_NAME_MAX_LENGTH);
export const nextField = z.string().max(2048).default('/');
export const providerField = z.enum(['google']);
