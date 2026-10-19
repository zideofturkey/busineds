/**
 * Busined's — Yerel & Hibrit Komuta Merkezi Sunucusu
 * Sıfır harici bağımlılık (Zero-Dependency Node.js HTTP Server)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { runAuditCycle } = require('./scripts/run-audit');

const { exec } = require('child_process');

const PORT = process.env.PORT || 3400;
const DATA_PATH = path.join(__dirname, 'data', 'accounts.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Buluttaki (GitHub) yeni verileri yerel bilgisayara otomatik çeken fonksiyon
let lastGitPull = 0;
function autoSyncFromCloud() {
  const now = Date.now();
  if (now - lastGitPull < 30000) return Promise.resolve(); // 30 saniyede bir kontrol et
  lastGitPull = now;
  return new Promise(resolve => {
    exec('git pull --rebase --autostash origin main', { cwd: __dirname }, () => resolve());
  });
}
setInterval(autoSyncFromCloud, 5 * 60 * 1000); // Arka planda her 5 dakikada bir otomatik çek

function readDb() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
}

function writeDb(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // API: Tüm Verileri Getir (Önce buluttaki son veriyi otomatik senkronize et)
  if (req.method === 'GET' && url.pathname === '/api/data') {
    await autoSyncFromCloud();
    return sendJson(res, 200, readDb());
  }

  // API: Hesap Onay Durumunu Değiştir (Takip Et / Takip Dışı Bırak)
  if (req.method === 'POST' && url.pathname === '/api/accounts/toggle-approval') {
    try {
      const { id } = await parseBody(req);
      const db = readDb();
      const account = db.accounts.find(a => a.id === id);
      if (!account) return sendJson(res, 404, { error: 'Hesap bulunamadı' });
      account.approved = !account.approved;
      if (account.approved && account.status === 'pending') {
        account.status = 'healthy';
      } else if (!account.approved) {
        account.status = 'pending';
      }
      writeDb(db);
      return sendJson(res, 200, { ok: true, account, db });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // API: Hesap Kimlik Kartını Güncelle veya Yeni Hesap Ekle
  if (req.method === 'POST' && url.pathname === '/api/accounts/save') {
    try {
      const payload = await parseBody(req);
      const db = readDb();

      if (payload.id) {
        const idx = db.accounts.findIndex(a => a.id === payload.id);
        if (idx !== -1) {
          db.accounts[idx] = { ...db.accounts[idx], ...payload };
        }
      } else {
        const newAcc = {
          id: 'acc-' + Date.now(),
          customerId: payload.customerId || '000-000-0000',
          name: payload.name || 'Yeni Reklam Hesabı',
          sector: payload.sector || 'Genel Lokal İşletme',
          location: payload.location || 'Türkiye',
          approved: payload.approved !== undefined ? payload.approved : true,
          activeCampaigns: Number(payload.activeCampaigns || 1),
          primaryGoal: payload.primaryGoal || 'Telefon & WhatsApp',
          targetCpaTl: Number(payload.targetCpaTl || 200),
          currentCpaTl: Number(payload.currentCpaTl || 190),
          spend5dTl: Number(payload.spend5dTl || 0),
          conversions5d: Number(payload.conversions5d || 0),
          ctrPercent: Number(payload.ctrPercent || 5.0),
          impressionSharePercent: Number(payload.impressionSharePercent || 60),
          customRules: payload.customRules || '',
          status: payload.status || 'healthy',
          healthScore: Number(payload.healthScore || 88),
          findings: Array.isArray(payload.findings) && payload.findings.length > 0 ? payload.findings : [
            {
              severity: 'suggestion',
              category: 'Yeni Hesap Kaydı',
              title: 'Hesap sisteme eklendi',
              detail: 'İlk 5 günlük denetim döngüsünde detaylı arama terimi ve EBM analizi üretilecek.',
              action: 'MCC Script senkronizasyonunun aktif olduğundan emin olun.'
            }
          ]
        };
        db.accounts.unshift(newAcc);
      }

      writeDb(db);
      return sendJson(res, 200, { ok: true, db });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // API: Hesabı Yoksayılanlara Taşı (Örn: Yıldız Spot gibi)
  if (req.method === 'POST' && url.pathname === '/api/accounts/ignore') {
    try {
      const { id, reason } = await parseBody(req);
      const db = readDb();
      const idx = db.accounts.findIndex(a => a.id === id);
      if (idx === -1) return sendJson(res, 404, { error: 'Hesap bulunamadı' });

      const removed = db.accounts.splice(idx, 1)[0];
      db.ignoredAccounts.push({
        customerId: removed.customerId,
        name: removed.name,
        reason: reason || 'Kullanıcı tarafından MCC takip dışı listesine alındı.'
      });
      if (!db.settings.ignoredCustomerIds.includes(removed.customerId)) {
        db.settings.ignoredCustomerIds.push(removed.customerId);
      }
      writeDb(db);
      return sendJson(res, 200, { ok: true, db });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // API: Ayarları Güncelle (AI Modeli, E-posta vb.)
  if (req.method === 'POST' && url.pathname === '/api/settings') {
    try {
      const payload = await parseBody(req);
      const db = readDb();
      db.settings = { ...db.settings, ...payload };
      writeDb(db);
      return sendJson(res, 200, { ok: true, db });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // API: 5 Günlük Denetimi Şimdi Tetikle & Yeni Rapor Üret
  if (req.method === 'POST' && url.pathname === '/api/audit/run') {
    try {
      const result = await runAuditCycle({ forceFullReport: true });
      return sendJson(res, 200, { ok: true, report: result.report, db: result.db });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // API: MCC Script Webhook Senkronizasyonu
  if (req.method === 'POST' && url.pathname === '/api/mcc-sync') {
    try {
      const payload = await parseBody(req);
      const db = readDb();
      const incoming = payload.accounts || [];
      for (const item of incoming) {
        if (db.settings.ignoredCustomerIds.includes(item.customerId)) continue;
        const existing = db.accounts.find(a => a.customerId === item.customerId);
        if (existing) {
          existing.spend5dTl = Math.round(item.cost || existing.spend5dTl);
          existing.conversions5d = Math.round(item.conversions || existing.conversions5d);
          existing.activeCampaigns = item.activeCampaigns ?? existing.activeCampaigns;
          if (existing.conversions5d > 0) {
            existing.currentCpaTl = Math.round(existing.spend5dTl / existing.conversions5d);
          }
        }
      }
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // Statik Dosya Sunumu
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  const resolvedPath = path.join(PUBLIC_DIR, path.normalize(filePath));

  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(resolvedPath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Sayfa bulunamadı');
    }
    const ext = path.extname(resolvedPath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`\n=============================================================`);
  console.log(`  Busined's — Reklam Denetim & İstihbarat Komuta Merkezi`);
  console.log(`  Panel Adresi: http://localhost:${PORT}`);
  console.log(`=============================================================\n`);
});
