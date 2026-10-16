// One-off: generate VAPID keypair for Web Push (PWA notifications).
// Run: node scripts/gen-vapid-keys.mjs
// The PUBLIC key goes in src/lib/webPush.ts; the PRIVATE key goes to the
// Supabase Edge Function secret WEBPUSH_VAPID_PRIVATE_KEY. Never commit the
// private key to git.
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });
const x = Buffer.from(pub.x, 'base64url');
const y = Buffer.from(pub.y, 'base64url');
const appKey = Buffer.concat([Buffer.from([4]), x, y]).toString('base64url');
const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
console.log('VAPID_PUBLIC_KEY=' + appKey);
console.log('VAPID_PRIVATE_KEY_JWK_D=' + priv.d);
console.log('VAPID_PRIVATE_KEY_PKCS8_B64=' + pkcs8);

