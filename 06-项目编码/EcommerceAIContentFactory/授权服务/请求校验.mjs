import { z } from 'zod';
import {
  usernameSchema, passwordSchema, machineIdSchema, encodedKeySchema, signatureSchema, idSchema,
} from './密码与签名.mjs';

export const challengeSchema = z.strictObject({
  username: usernameSchema, machineId: machineIdSchema,
  devicePublicKey: encodedKeySchema, purpose: z.enum(['login', 'refresh']),
});
export const loginSchema = z.strictObject({
  username: usernameSchema, password: passwordSchema, challengeId: idSchema, signature: signatureSchema,
});
export const refreshSchema = z.strictObject({
  lease: z.string().min(100).max(4096), challengeId: idSchema, signature: signatureSchema,
});
