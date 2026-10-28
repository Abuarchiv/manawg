import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '@/core/validators/currencies';

export const currencySchema = z.enum(SUPPORTED_CURRENCIES);
