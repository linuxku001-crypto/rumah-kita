/* ===== Sambungan Google Drive — Client ID sama dengan login ===== */
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
let tokenDrive = null;

function tungguGS(cb, coba = 0) {
  if (window.google && google.accounts) return cb();
  if (coba < 50) setTimeout(() => tungguGS(cb, coba + 1), 200);
}

function sambungDrive(setelahSiap) {
  tungguGS(() => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleClientId,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error) { alert("Gagal terhubung: " + resp.error); return; }
        tokenDrive = resp.access_token;
        setelahSiap();
      }
    });
    tc.requestAccessToken();
  });
}

async function emailSaya() {
  const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: "Bearer " + tokenDrive }
  });
  return ((await r.json()).email || "").toLowerCase();
}

async function apiDrive(url, opsi = {}) {
  const res = await fetch("https://www.googleapis.com/drive/v3/" + url, {
    ...opsi,
    headers: { Authorization: "Bearer " + tokenDrive, ...(opsi.headers || {}) }
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 200));
  return res.json();
}

async function dapatkanFolder() {
  const q = encodeURIComponent(`name='${CONFIG.driveFolderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const data = await apiDrive(`files?q=${q}&fields=files(id,name)`);
  if (data.files.length) return data.files[0].id;

  const saya = await emailSaya();
  if (saya !== CONFIG.emailPemilikDrive.toLowerCase()) {
    throw new Error("Folder belum ada. Sahrul harus sambung Drive lebih dulu ya 🥺");
  }
  const buat = await apiDrive("files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: CONFIG.driveFolderName, mimeType: "application/vnd.google-apps.folder" })
  });
  // bagikan otomatis ke semua email kita yang lain
  for (const email of CONFIG.emailDiizinkan) {
    if (email.toLowerCase() !== saya && !email.startsWith("GANTI_")) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${buat.id}/permissions`, {
        method: "POST",
        headers: { Authorization: "Bearer " + tokenDrive, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "writer", type: "user", emailAddress: email })
      });
    }
  }
  return buat.id;
}

async function uploadMomen(file, caption, namaFile, olehNama, waktuIso) {
  const folderId = await dapatkanFolder();
  const metadata = {
    name: namaFile,
    parents: [folderId],
    description: JSON.stringify({
      caption, oleh: olehNama, likes: 0,
      waktu: waktuIso || new Date().toISOString()
    })
  };
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
    method: "POST",
    headers: { Authorization: "Bearer " + tokenDrive, "Content-Type": "application/json" },
    body: JSON.stringify(metadata)
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 200));
  const lokasi = res.headers.get("Location");
  const put = await fetch(lokasi, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file
  });
  if (!put.ok) throw new Error((await put.text()).slice(0, 200));
  const hasil = await put.json();
  await fetch(`https://www.googleapis.com/drive/v3/files/${hasil.id}/permissions`, {
    method: "POST",
    headers: { Authorization: "Bearer " + tokenDrive, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" })
  });
  return hasil.id;
}

async function daftarMomen(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const data = await apiDrive(`files?q=${q}&orderBy=createdTime desc&pageSize=1000&fields=files(id,name,mimeType,description,createdTime)`);
  return data.files.map(f => {
    let meta = {}; try { meta = JSON.parse(f.description || "{}"); } catch {}
    return { ...f, meta };
  });
}

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============ RUANG PRIVAT (buku harian masing-masing) ============ */
async function dapatkanFolderPrivat(nama) {
  const namaFolder = CONFIG.namaFolderPrivat[nama];
  const q = encodeURIComponent(`name='${namaFolder}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const data = await apiDrive(`files?q=${q}&fields=files(id,name)`);
  if (data.files.length) return data.files[0].id;

  const saya = await emailSaya();
  if ((CONFIG.petaEmail[saya] || "") !== nama) throw new Error("bukan-punya");
  const buat = await apiDrive("files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: namaFolder, mimeType: "application/vnd.google-apps.folder" })
  });
  return buat.id; // sengaja TIDAK di-share — hanya kamu & Google
}

async function uploadPrivat(teks, nama) {
  const folderId = await dapatkanFolderPrivat(nama);
  const now = new Date().toISOString();
  const metadata = {
    name: "Privat — " + now + ".txt",
    parents: [folderId],
    description: JSON.stringify({ caption: teks, oleh: nama, waktu: now })
  };
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
    method: "POST",
    headers: { Authorization: "Bearer " + tokenDrive, "Content-Type": "application/json" },
    body: JSON.stringify(metadata)
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 200));
  const lokasi = res.headers.get("Location");
  const put = await fetch(lokasi, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: new Blob([teks], { type: "text/plain" })
  });
  if (!put.ok) throw new Error((await put.text()).slice(0, 200));
  return (await put.json()).id;
}

async function daftarPrivat(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const data = await apiDrive(`files?q=${q}&orderBy=createdTime desc&pageSize=1000&fields=files(id,name,mimeType,description,createdTime)`);
  return data.files.map(f => {
    let meta = {}; try { meta = JSON.parse(f.description || "{}"); } catch {}
    return { ...f, meta };
  });
}
