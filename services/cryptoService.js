const crypto = require('crypto');

// 256-bit key derivation from server secret or secure fallback
const ALGORITHM = 'aes-256-cbc';
const SECRET_KEY = process.env.PII_ENCRYPTION_KEY || 'taskflow-pro-enterprise-secure-master-key-32b';
const HASHED_KEY = crypto.createHash('sha256').update(SECRET_KEY).digest();

/**
 * Encrypt sensitive plain text string (PII) using AES-256-CBC
 * @param {string} text - Plaintext to encrypt
 * @returns {string} - Hex encoded iv:ciphertext
 */
const encryptPII = (text) => {
  if (!text || typeof text !== 'string') return text;
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, HASHED_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (err) {
    console.warn('[Crypto Service] Encryption notice:', err.message);
    return text;
  }
};

/**
 * Decrypt AES-256-CBC ciphertext
 * @param {string} encryptedData - Hex encoded iv:ciphertext
 * @returns {string} - Decrypted plaintext
 */
const decryptPII = (encryptedData) => {
  if (!encryptedData || typeof encryptedData !== 'string' || !encryptedData.includes(':')) {
    return encryptedData;
  }
  try {
    const [ivHex, cipherText] = encryptedData.split(':');
    if (!ivHex || !cipherText) return encryptedData;
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, HASHED_KEY, iv);
    let decrypted = decipher.update(cipherText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    // If text was not encrypted with this format, return original
    return encryptedData;
  }
};

/**
 * Mask PII string for secure display (e.g. j***@example.com or +1 ***-***-4567)
 * @param {string} str - Text to mask
 * @param {string} type - 'email' | 'phone' | 'general'
 * @returns {string}
 */
const maskPII = (str, type = 'general') => {
  if (!str || typeof str !== 'string') return '';
  if (type === 'email' && str.includes('@')) {
    const [local, domain] = str.split('@');
    if (local.length <= 2) return `${local[0]}*@${domain}`;
    return `${local[0]}***${local[local.length - 1]}@${domain}`;
  }
  if (type === 'phone' && str.length >= 7) {
    return str.slice(0, 3) + ' **** ' + str.slice(-4);
  }
  return str.length > 4 ? `${str.slice(0, 2)}***${str.slice(-2)}` : '***';
};

module.exports = {
  encryptPII,
  decryptPII,
  maskPII,
};
