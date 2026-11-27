const { createClient } = require('@supabase/supabase-js');

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} belum diatur di Vercel.`);
  return value;
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

// Pesanan online memakai tabel transactions yang sudah ada. Identitas pelanggan disimpan di kolom notes
// dengan format tetap: "[ONLINE] Nama | Kontak | Catatan" (karakter "|" dari pelanggan diganti "/").
const ONLINE_PREFIX = '[ONLINE] ';
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[|\r\n]+/g, '/').trim().slice(0, max) : '');
function buildOnlineNotes(name, contact, note) {
  return ONLINE_PREFIX + [clean(name, 60), clean(contact, 40), clean(note, 300)].join(' | ');
}
function parseOnlineNotes(notes) {
  if (typeof notes !== 'string' || !notes.startsWith(ONLINE_PREFIX)) return null;
  const [name = '', contact = '', note = ''] = notes.slice(ONLINE_PREFIX.length).split(' | ');
  return { customer_name: name, customer_contact: contact, note };
}
module.exports = { adminClient, env, send, requireUser, ONLINE_PREFIX, buildOnlineNotes, parseOnlineNotes };
