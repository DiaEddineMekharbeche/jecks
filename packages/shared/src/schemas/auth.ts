import { z } from 'zod';
import { dzPhoneSchema, emailSchema } from './common.js';

/** Staff sign-in — PRD F-AD-92 (e-mail + password, optional TOTP second factor). */
export const staffLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const otpRequestSchema = z.object({
  phone: dzPhoneSchema,
  purpose: z.enum(['login', 'checkout', 'verify']).default('login'),
});

export const otpVerifySchema = z.object({
  phone: dzPhoneSchema,
  code: z.string().regex(/^\d{6}$/, 'The code is 6 digits'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(16).optional(),
});

/** PRD Section 10.8 — staff passwords. Kept deliberately simple: length beats symbols. */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
    message: 'Include an upper case letter, a lower case letter and a digit',
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'The two passwords do not match',
    path: ['confirmPassword'],
  });

export const inviteStaffSchema = z.object({
  email: emailSchema,
  name: z.string().min(2).max(120),
  phone: dzPhoneSchema.optional(),
  roleSlugs: z.array(z.string().min(1)).min(1, 'Pick at least one role'),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(16),
  password: passwordSchema,
});

export const enable2faSchema = z.object({
  secret: z.string().min(16),
  code: z.string().regex(/^\d{6}$/),
});

export type StaffLoginInput = z.infer<typeof staffLoginSchema>;
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  type: 'STAFF' | 'CUSTOMER';
  roles: string[];
  permissions: string[];
  twoFactorEnabled: boolean;
}
