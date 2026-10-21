const { createClient } = require('@supabase/supabase-js');

// Nama alternatif untuk variabel yang pernah salah ketik di pengaturan Vercel.
const ENV_ALIASES = {
  SUPABASE_SERVICE_ROLE_KEY: ['SUPABASE_SEERVICE_ROLE_KEY']
};

class ConfigError extends Error {}

function env(name) {
  const candidates = [name, ...(ENV_ALIASES[name] || [])];
  for (const key of candidates) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }
  throw new ConfigError(`Environment variable ${name} belum diatur di Vercel.`);
}
function adminClient() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
function send(res, status, body) {
  return res.status(status).json(body);
}
async function requireUser(req, allowedRoles = ['admin', 'cashier']) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return { error: { status: 401, message: 'Silakan login terlebih dahulu.' } };
  const supabase = adminClient();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return { error: { status: 401, message: 'Sesi login tidak valid. Silakan login kembali.' } };
  const { data: profile, error: profileError } = await supabase.from('profiles')
    .select('id, full_name, role').eq('id', authData.user.id).maybeSingle();
  if (profileError) return { error: { status: 500, message: 'Gagal memeriksa profil staf.' } };
  if (!profile || !allowedRoles.includes(profile.role)) return { error: { status: 403, message: 'Akun belum terdaftar sebagai staf yang berhak menggunakan fitur ini.' } };
  return { supabase, user: authData.user, profile };
}
module.exports = { adminClient, env, send, requireUser, ConfigError };
