// ============================================================
//  Pro-Bul Backend — server.js
//  Node.js + Express + sql.js (SQLite) + Nodemailer
//  Railway: https://pro-bul-server-production.up.railway.app
// ============================================================

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const bcrypt      = require('bcryptjs');
const nodemailer  = require('nodemailer');
const rateLimit   = require('express-rate-limit');
const path        = require('path');
const fs          = require('fs');

// .env dosyasını yükle (yerel geliştirme için)
try { require('./env-loader'); } catch (_) {}

// ============================================================
//  Ortam değişkenleri
// ============================================================
const PORT      = process.env.PORT      || 8080;   // Railway PORT env'ini otomatik atar
const MAIL_HOST = process.env.MAIL_HOST || 'smtp.gmail.com';
const MAIL_PORT = process.env.MAIL_PORT || 587;
const MAIL_USER = process.env.MAIL_USER || '';
const MAIL_PASS = process.env.MAIL_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || `"Pro-Bul ⚽" <${MAIL_USER}>`;
const ADMIN_KEY = process.env.ADMIN_KEY || 'probul-admin-2024';

// Railway'de /tmp kalıcıdır, öteki yollar deploy'da sıfırlanabilir
const DB_PATH = process.env.DB_PATH || path.join('/tmp', 'probul.db');

// ============================================================
//  sql.js — başlat
// ============================================================
let db;
const initSql = require('sql.js');

async function initDb() {
  const SQL = await initSql();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('  📂  Mevcut veritabanı yüklendi:', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('  🆕  Yeni veritabanı oluşturuldu:', DB_PATH);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      fullName  TEXT    NOT NULL,
      email     TEXT    NOT NULL UNIQUE,
      phone     TEXT    NOT NULL,
      password  TEXT    NOT NULL,
      photo     TEXT,
      verified  INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS otp_codes (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      email     TEXT    NOT NULL,
      code      TEXT    NOT NULL,
      type      TEXT    NOT NULL DEFAULT 'register',
      expiresAt INTEGER NOT NULL,
      used      INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS pending_users (
      email     TEXT PRIMARY KEY,
      fullName  TEXT NOT NULL,
      phone     TEXT NOT NULL,
      password  TEXT NOT NULL,
      photo     TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  saveDb();
}

function saveDb() {
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error('  ❌  DB kayıt hatası:', err.message);
  }
}

function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

// ============================================================
//  E-posta
// ============================================================
const transporter = nodemailer.createTransport({
  host: MAIL_HOST,
  port: Number(MAIL_PORT),
  secure: false,
  auth: { user: MAIL_USER, pass: MAIL_PASS },
  tls: { rejectUnauthorized: false }
});

async function sendOtpEmail(to, code, type = 'register') {
  const isReset  = type === 'forgot';
  const subject  = isReset ? '🔑 Pro-Bul Şifre Sıfırlama Kodu' : '✅ Pro-Bul E-posta Doğrulama';
  const title    = isReset ? 'Şifreni Sıfırla' : 'E-posta Adresini Doğrula';
  const bodyText = isReset
    ? 'Şifre sıfırlama talebinde bulundun. Aşağıdaki kodu kullan:'
    : "Pro-Bul'a hoş geldin! Hesabını aktifleştirmek için kodu gir:";

  const html = `<!DOCTYPE html>
<html lang="tr">
<body style="margin:0;padding:0;background:#0F0E0D;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0F0E0D;padding:40px 20px;">
  <tr><td align="center">
    <table width="420" cellpadding="0" cellspacing="0" style="background:#1C1A18;border-radius:20px;overflow:hidden;">
      <tr>
        <td style="background:linear-gradient(135deg,#FF5C1A,#FFD234);padding:32px;text-align:center;">
          <h1 style="margin:0;color:#0F0E0D;font-size:28px;font-weight:800;">Pro-Bul ⚽</h1>
          <p style="margin:6px 0 0;color:rgba(15,14,13,0.7);font-size:14px;">${title}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:36px 32px;">
          <p style="color:#9A9286;font-size:15px;margin:0 0 20px;">${bodyText}</p>
          <div style="text-align:center;background:#242220;border-radius:16px;padding:28px;margin:0 0 28px;">
            <span style="font-size:42px;font-weight:800;letter-spacing:12px;color:#FF5C1A;font-family:monospace;">${code}</span>
          </div>
          <p style="color:#9A9286;font-size:13px;text-align:center;margin:0;">
            ⏰ Bu kod <strong style="color:#F5F0E8;">10 dakika</strong> geçerlidir.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 32px 28px;text-align:center;">
          <p style="color:rgba(154,146,134,0.5);font-size:12px;margin:0;">
            Pro-Bul · Spor Arkadaşı Bul Uygulaması
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  await transporter.sendMail({ from: MAIL_FROM, to, subject, html });
}

// ============================================================
//  OTP yardımcıları
// ============================================================
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function saveOtp(email, code, type = 'register') {
  dbRun(`DELETE FROM otp_codes WHERE email = ? AND type = ?`, [email, type]);
  dbRun(
    `INSERT INTO otp_codes (email, code, type, expiresAt) VALUES (?, ?, ?, ?)`,
    [email, code, type, Date.now() + 10 * 60 * 1000]
  );
}

function validateOtp(email, code, type = 'register') {
  const row = dbGet(
    `SELECT * FROM otp_codes WHERE email = ? AND type = ? AND used = 0 ORDER BY id DESC LIMIT 1`,
    [email, type]
  );
  if (!row)                        return { ok: false, error: 'Kod bulunamadı. Yeni kod isteyin.' };
  if (row.code !== code)           return { ok: false, error: 'Kod hatalı. Tekrar deneyin.' };
  if (Date.now() > row.expiresAt)  return { ok: false, error: 'Kodun süresi doldu. Yeni kod isteyin.' };
  dbRun(`UPDATE otp_codes SET used = 1 WHERE id = ?`, [row.id]);
  return { ok: true };
}

// ============================================================
//  Sunucuyu başlat
// ============================================================
async function startServer() {
  await initDb();

  const app = express();

  // ---- Güvenlik middleware'leri ----
  app.use(helmet({
    contentSecurityPolicy: false,   // SPA için kapatıyoruz
    crossOriginEmbedderPolicy: false
  }));

  app.use(cors({
    origin: [
      'https://pro-bul-server-production.up.railway.app',
      'http://localhost:3000',
      'http://localhost:8080'
    ],
    credentials: true
  }));

  app.use(express.json({ limit: '10mb' }));

  // ---- Rate limiting ----
  // Genel API limiti
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 dakika
    max: 100,
    message: { ok: false, error: 'Çok fazla istek gönderildi. 15 dakika sonra tekrar deneyin.' },
    standardHeaders: true,
    legacyHeaders: false
  });

  // OTP gönderim limiti (spam önleme)
  const otpLimiter = rateLimit({
    windowMs: 60 * 1000,        // 1 dakika
    max: 3,
    message: { ok: false, error: 'Çok fazla OTP isteği. 1 dakika bekleyin.' },
    standardHeaders: true,
    legacyHeaders: false
  });

  // Login brute force önleme
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 dakika
    max: 10,
    message: { ok: false, error: 'Çok fazla başarısız giriş. 15 dakika sonra tekrar deneyin.' },
    standardHeaders: true,
    legacyHeaders: false
  });

  app.use('/api/', apiLimiter);
  app.use('/api/send-otp', otpLimiter);
  app.use('/api/resend-otp', otpLimiter);
  app.use('/api/forgot-password', otpLimiter);
  app.use('/api/login', loginLimiter);

  // ---- Static dosyalar ----
  app.use(express.static(path.join(__dirname, 'public')));

  // ============================================================
  //  ENDPOINTS
  // ============================================================

  // Health check — Railway bunu kullanır
  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()) + 's'
    });
  });

  // ── 1. Kayıt OTP gönder ──────────────────────────────────
  app.post('/api/send-otp', async (req, res) => {
    try {
      const { email, phone, fullName, photo, password } = req.body;

      if (!email || !fullName || !phone || !password)
        return res.json({ ok: false, error: 'Tüm alanlar zorunludur.' });

      if (password.length < 6)
        return res.json({ ok: false, error: 'Şifre en az 6 karakter olmalıdır.' });

      // E-posta format kontrolü
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email))
        return res.json({ ok: false, error: 'Geçersiz e-posta adresi.' });

      const existing = dbGet(`SELECT id FROM users WHERE email = ? AND verified = 1`, [email]);
      if (existing)
        return res.json({ ok: false, error: 'Bu e-posta adresi zaten kayıtlı.' });

      const hashed = await bcrypt.hash(password, 12);
      dbRun(
        `INSERT INTO pending_users (email, fullName, phone, password, photo) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           fullName = excluded.fullName,
           phone    = excluded.phone,
           password = excluded.password,
           photo    = excluded.photo`,
        [email, fullName, phone, hashed, photo || null]
      );

      const code = generateOtp();
      saveOtp(email, code, 'register');
      await sendOtpEmail(email, code, 'register');

      res.json({ ok: true, message: 'Doğrulama kodu e-posta adresinize gönderildi.' });
    } catch (err) {
      console.error('[send-otp]', err.message);
      res.json({ ok: false, error: 'E-posta gönderilemedi. Lütfen tekrar deneyin.' });
    }
  });

  // ── 2. OTP doğrula ───────────────────────────────────────
  app.post('/api/verify-otp', (req, res) => {
    try {
      const { email, code } = req.body;
      if (!email || !code)
        return res.json({ ok: false, error: 'E-posta ve kod gerekli.' });

      const result = validateOtp(email, code, 'register');
      if (!result.ok) return res.json(result);

      const pending = dbGet(`SELECT * FROM pending_users WHERE email = ?`, [email]);
      if (!pending)
        return res.json({ ok: false, error: 'Kayıt bilgileri bulunamadı. Tekrar kayıt olun.' });

      dbRun(
        `INSERT INTO users (email, fullName, phone, password, photo, verified) VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(email) DO UPDATE SET
           fullName = excluded.fullName,
           phone    = excluded.phone,
           password = excluded.password,
           photo    = excluded.photo,
           verified = 1`,
        [pending.email, pending.fullName, pending.phone, pending.password, pending.photo]
      );
      dbRun(`DELETE FROM pending_users WHERE email = ?`, [email]);

      const user = dbGet(`SELECT id, fullName, email, phone, photo FROM users WHERE email = ?`, [email]);
      res.json({ ok: true, message: 'Hesabınız başarıyla oluşturuldu!', user });
    } catch (err) {
      console.error('[verify-otp]', err.message);
      res.json({ ok: false, error: 'Sunucu hatası.' });
    }
  });

  // ── 3. OTP tekrar gönder ─────────────────────────────────
  app.post('/api/resend-otp', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email)
        return res.json({ ok: false, error: 'E-posta adresi gerekli.' });

      const pending = dbGet(`SELECT * FROM pending_users WHERE email = ?`, [email]);
      if (!pending)
        return res.json({ ok: false, error: 'Bekleyen kayıt bulunamadı. Tekrar kayıt olun.' });

      const code = generateOtp();
      saveOtp(email, code, 'register');
      await sendOtpEmail(email, code, 'register');

      res.json({ ok: true, message: 'Yeni kod e-posta adresinize gönderildi.' });
    } catch (err) {
      console.error('[resend-otp]', err.message);
      res.json({ ok: false, error: 'Kod gönderilemedi. Lütfen tekrar deneyin.' });
    }
  });

  // ── 4. Giriş ────────────────────────────────────────────
  app.post('/api/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password)
        return res.json({ ok: false, error: 'E-posta ve şifre gerekli.' });

      const user = dbGet(`SELECT * FROM users WHERE email = ?`, [email]);
      if (!user)
        return res.json({ ok: false, error: 'Bu e-posta ile kayıtlı hesap bulunamadı.' });

      if (!user.verified)
        return res.json({ ok: false, error: 'Hesabın henüz doğrulanmamış. E-postanı kontrol et.' });

      const match = await bcrypt.compare(password, user.password);
      if (!match)
        return res.json({ ok: false, error: 'Şifre hatalı.' });

      res.json({
        ok: true,
        message: 'Giriş başarılı!',
        user: { id: user.id, fullName: user.fullName, email: user.email, phone: user.phone }
      });
    } catch (err) {
      console.error('[login]', err.message);
      res.json({ ok: false, error: 'Sunucu hatası.' });
    }
  });

  // ── 5. Şifre sıfırlama OTP ───────────────────────────────
  app.post('/api/forgot-password', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email)
        return res.json({ ok: false, error: 'E-posta adresi gerekli.' });

      const user = dbGet(`SELECT id FROM users WHERE email = ? AND verified = 1`, [email]);
      // Güvenlik: kullanıcı var mı yok mu söylemiyoruz (enumeration önleme)
      if (!user) {
        return res.json({ ok: true, message: 'Eğer bu e-posta kayıtlıysa, sıfırlama kodu gönderildi.' });
      }

      const code = generateOtp();
      saveOtp(email, code, 'forgot');
      await sendOtpEmail(email, code, 'forgot');

      res.json({ ok: true, message: 'Şifre sıfırlama kodu e-posta adresinize gönderildi.' });
    } catch (err) {
      console.error('[forgot-password]', err.message);
      res.json({ ok: false, error: 'Kod gönderilemedi. Lütfen tekrar deneyin.' });
    }
  });

  // ── 6. Şifre güncelle ────────────────────────────────────
  app.post('/api/reset-password', async (req, res) => {
    try {
      const { email, code, newPassword } = req.body;
      if (!email || !code || !newPassword)
        return res.json({ ok: false, error: 'Tüm alanlar zorunludur.' });

      if (newPassword.length < 6)
        return res.json({ ok: false, error: 'Şifre en az 6 karakter olmalıdır.' });

      const result = validateOtp(email, code, 'forgot');
      if (!result.ok) return res.json(result);

      const hashed = await bcrypt.hash(newPassword, 12);
      dbRun(`UPDATE users SET password = ? WHERE email = ?`, [hashed, email]);

      res.json({ ok: true, message: 'Şifreniz başarıyla güncellendi.' });
    } catch (err) {
      console.error('[reset-password]', err.message);
      res.json({ ok: false, error: 'Sunucu hatası.' });
    }
  });

  // ── 7. Admin: Kullanıcıları listele ─────────────────────
  // GET /api/admin/users   →   Header: x-admin-key: <ADMIN_KEY>
  app.get('/api/admin/users', (req, res) => {
    try {
      if (req.headers['x-admin-key'] !== ADMIN_KEY)
        return res.status(401).json({ ok: false, error: 'Yetkisiz erişim.' });

      const users = dbAll(
        `SELECT id, fullName, email, phone, verified, createdAt FROM users ORDER BY id DESC`
      );
      res.json({ ok: true, total: users.length, users });
    } catch (err) {
      console.error('[admin/users]', err.message);
      res.json({ ok: false, error: 'Sunucu hatası.' });
    }
  });

  // ── 8. Admin: Veritabanı istatistikleri ─────────────────
  app.get('/api/admin/stats', (req, res) => {
    try {
      if (req.headers['x-admin-key'] !== ADMIN_KEY)
        return res.status(401).json({ ok: false, error: 'Yetkisiz erişim.' });

      const totalUsers    = dbGet(`SELECT COUNT(*) as c FROM users WHERE verified = 1`);
      const pendingUsers  = dbGet(`SELECT COUNT(*) as c FROM pending_users`);
      const totalOtps     = dbGet(`SELECT COUNT(*) as c FROM otp_codes WHERE used = 0 AND expiresAt > ?`, [Date.now()]);
      const todayUsers    = dbGet(`SELECT COUNT(*) as c FROM users WHERE date(createdAt) = date('now') AND verified = 1`);

      res.json({
        ok: true,
        stats: {
          totalVerifiedUsers : totalUsers?.c   || 0,
          pendingRegistrations: pendingUsers?.c || 0,
          activeOtpCodes     : totalOtps?.c    || 0,
          registeredToday    : todayUsers?.c   || 0
        }
      });
    } catch (err) {
      console.error('[admin/stats]', err.message);
      res.json({ ok: false, error: 'Sunucu hatası.' });
    }
  });

  // ── SPA fallback ─────────────────────────────────────────
  app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.json({ ok: true, message: 'Pro-Bul API çalışıyor 🚀', version: '1.0.0' });
    }
  });

  // ── Sunucuyu başlat ──────────────────────────────────────
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  ⚽  Pro-Bul Sunucu Başladı!');
    console.log(`  🌐  http://localhost:${PORT}`);
    console.log(`  🚀  https://pro-bul-server-production.up.railway.app`);
    console.log('');
    if (!MAIL_USER || !MAIL_PASS)
      console.warn('  ⚠️   UYARI: .env dosyasında MAIL_USER ve MAIL_PASS boş!\n');
  });

  // Temiz kapanış
  process.on('SIGTERM', () => {
    console.log('  📴  Sunucu kapatılıyor...');
    saveDb();
    process.exit(0);
  });
}

startServer().catch(err => {
  console.error('  ❌  Sunucu başlatılamadı:', err);
  process.exit(1);
});
