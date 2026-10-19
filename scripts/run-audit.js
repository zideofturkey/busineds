/**
 * Busined's — İki Katmanlı Otonom Denetim, Canlı Veri Birleştirme & E-Posta Bildirim Motoru
 * 
 * Katman 1: Günlük Hayati Kontrol (Health Check) & Veri Güncelleme (08:15 ve 23:30)
 *   - Canlı MCC verisini (`data/mcc-live.json`) panele işler.
 *   - Sadece hayati tehlikeleri (Dönüşüm durması, aşırı bütçe aşımı/sızıntı, kampanya durması) kontrol eder.
 *   - Acil durum YOKSA e-posta atmaz, rapor arşivini şişirmez. Acil durum VARSA anında "ACİL UYARI" maili atar.
 * 
 * Katman 2: 5 Günde Bir Kapsamlı Denetim & PDF Raporu (Gece 23:30 döngüsünde 5. gün dolduğunda)
 *   - Gemini API (Free Tier) ile tüm onaylı hesapları kendi kulvar ve kurallarına göre derinlemesine inceler.
 *   - 5 Günlük Genel Denetim Raporunu oluşturup arşive ekler ve özet + rapor detayını e-posta ile gönderir.
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'accounts.json');
const LIVE_MCC_FILE = path.join(__dirname, '..', 'data', 'mcc-live.json');

function mergeLiveMccData(db) {
  if (!fs.existsSync(LIVE_MCC_FILE)) return db;
  try {
    const liveRaw = fs.readFileSync(LIVE_MCC_FILE, 'utf-8');
    const livePayload = JSON.parse(liveRaw);
    const incomingList = Array.isArray(livePayload) ? livePayload : (livePayload.accounts || []);

    for (const item of incomingList) {
      if ((db.settings.ignoredCustomerIds || []).includes(item.customerId)) continue;

      let acc = db.accounts.find(a => a.customerId === item.customerId);
      const r5 = item.ranges?.['5d'] || item.ranges?.d5 || {};
      const r30 = item.ranges?.['30d'] || item.ranges?.d30 || {};

      const normalizedRanges = item.ranges ? {
        today: item.ranges.today,
        '5d': item.ranges['5d'] || item.ranges.d5,
        '7d': item.ranges['7d'] || item.ranges.d7,
        '14d': item.ranges['14d'] || item.ranges.d14,
        '30d': item.ranges['30d'] || item.ranges.d30
      } : undefined;

      if (acc) {
        acc.name = item.name || acc.name;
        acc.activeCampaigns = Array.isArray(item.campaigns) ? item.campaigns.length : acc.activeCampaigns;
        acc.spend5dTl = r5.spend ?? acc.spend5dTl;
        acc.conversions5d = r5.conversions ?? acc.conversions5d;
        acc.clicks5d = r5.clicks ?? acc.clicks5d;
        acc.impressions5d = r5.impressions ?? acc.impressions5d;
        acc.ctrPercent = r5.ctr ?? acc.ctrPercent;
        acc.currentCpaTl = r5.cpa ?? acc.currentCpaTl;
        acc.spend30dTl = r30.spend ?? acc.spend30dTl;
        acc.conversions30d = r30.conversions ?? acc.conversions30d;
        acc.impressionSharePercent = r5.impShare ?? acc.impressionSharePercent;
        acc.budgetLostSharePercent = r5.budgetLostShare ?? acc.budgetLostSharePercent;
        if (normalizedRanges) acc.ranges = normalizedRanges;
        if (Array.isArray(item.campaigns)) acc.campaigns = item.campaigns;
        if (Array.isArray(item.conversionActions)) acc.conversionActions = item.conversionActions;
        if (Array.isArray(item.topSearchTerms)) acc.topSearchTerms = item.topSearchTerms;
      } else {
        db.accounts.push({
          id: 'acc-' + item.customerId.replace(/[^0-9]/g, ''),
          customerId: item.customerId,
          name: item.name || 'Yeni MCC Hesabı',
          sector: 'Sektör Tanımlanmadı',
          location: 'İstanbul / Türkiye',
          approved: true,
          activeCampaigns: Array.isArray(item.campaigns) ? item.campaigns.length : 1,
          primaryGoal: Array.isArray(item.conversionActions)
            ? item.conversionActions.map(c => `${c.action} (${c.count5d})`).join(' · ')
            : 'Telefon & WhatsApp',
          targetCpaTl: 25,
          currentCpaTl: r5.cpa || 20,
          spend5dTl: r5.spend || 0,
          conversions5d: r5.conversions || 0,
          clicks5d: r5.clicks || 0,
          impressions5d: r5.impressions || 0,
          ctrPercent: r5.ctr || 0,
          spend30dTl: r30.spend || 0,
          conversions30d: r30.conversions || 0,
          impressionSharePercent: r5.impShare || 15,
          budgetLostSharePercent: r5.budgetLostShare || 10,
          customRules: '',
          status: 'healthy',
          healthScore: 85,
          ranges: normalizedRanges,
          campaigns: item.campaigns || [],
          conversionActions: item.conversionActions || [],
          topSearchTerms: item.topSearchTerms || [],
          findings: []
        });
      }
    }
    db.settings.lastSyncDate = new Date().toISOString();
    console.log(`[Busined's] Canlı MCC verisi (${incomingList.length} hesap) güncellendi.`);
  } catch (e) {
    console.warn(`[Busined's] mcc-live.json okunamadı:`, e.message);
  }
  return db;
}

/**
 * Günlük Hayati Kontrol (Health Check) Kural Motoru
 * Sadece 5 gün beklenemeyecek acil durumları yakalar.
 */
function runDailyEmergencyCheck(approvedAccounts) {
  const emergencies = [];

  for (const acc of approvedAccounts) {
    const todayStats = acc.ranges?.today || {};
    const d5Stats = acc.ranges?.['5d'] || { spend: acc.spend5dTl, conversions: acc.conversions5d, cpa: acc.currentCpaTl };

    // 1. Acil Durum: Bugün ciddi harcama var ama 0 dönüşüm (Dönüşüm etiketi kopmuş olabilir)
    if ((todayStats.spend || 0) >= 350 && (todayStats.conversions || 0) === 0) {
      emergencies.push({
        accountName: acc.name,
        customerId: acc.customerId,
        type: 'DÖNÜŞÜM KESİNTİSİ ŞÜPHESİ',
        message: `Bugün ₺${todayStats.spend} harcanmasına rağmen 0 dönüşüm kaydedildi. WhatsApp/Telefon dönüşüm etiketi veya açılış sayfası kontrol edilmeli.`
      });
    }

    // 2. Acil Durum: Gerçekleşen EBM, Hedef EBM'nin 1.8 katını aştıysa
    if (acc.targetCpaTl > 0 && d5Stats.cpa >= acc.targetCpaTl * 1.8 && d5Stats.spend > 500) {
      emergencies.push({
        accountName: acc.name,
        customerId: acc.customerId,
        type: 'AŞIRI EBM (CPA) FIRLAMASI',
        message: `Hedef EBM ₺${acc.targetCpaTl} iken mevcut EBM ₺${d5Stats.cpa} seviyesine fırladı.`
      });
    }

    // 3. Acil Durum: Aktif kampanya sayısı 0'a düştüyse (Kart/bütçe/red sorunu)
    if ((acc.activeCampaigns || 0) === 0) {
      emergencies.push({
        accountName: acc.name,
        customerId: acc.customerId,
        type: 'AKTİF KAMPANYA DURDU',
        message: `Hesapta çalışan aktif kampanya görünmüyor (Reklam reddi veya bakiye/ödeme sorunu olabilir).`
      });
    }
  }

  return emergencies;
}

async function analyzeAccountWithGemini(account, apiKey, modelName) {
  if (!apiKey) {
    return account.findings || [];
  }

  const prompt = `
Sen kıdemli bir Türkiye Google Ads denetçisisin.
Aşağıdaki reklam hesabının gerçek son 5 günlük Google Ads verilerini (PMax + Arama kampanyaları, dönüşüm kırılımı ve arama terimleri) kendi sektörüne ve özel kurallarına göre denetle:

Hesap Adı: ${account.name} (${account.customerId})
Sektör: ${account.sector}
Lokasyon: ${account.location}
Hedef EBM (CPA): ${account.targetCpaTl} TL | Gerçekleşen 5G EBM: ${account.currentCpaTl} TL
5 Günlük Harcama: ${account.spend5dTl} TL | 5 Günlük Dönüşüm: ${account.conversions5d}
TO (CTR): %${account.ctrPercent} | Bütçe Kaynaklı Gösterim Kaybı: %${account.budgetLostSharePercent ?? 0}
Özel Kurallar: ${account.customRules}

Kampanyalar (5G):
${JSON.stringify(account.campaigns || [])}

Dönüşüm İşlemleri Kırılımı (5G):
${JSON.stringify(account.conversionActions || [])}

En Çok Harcayan Arama Terimleri (5G):
${JSON.stringify(account.topSearchTerms || [])}

Lütfen JSON dizisi formatında en kritik ve aksiyon odaklı 1-3 bulguyu döndür. Her eleman şu alanları içermeli:
[{"severity": "critical" | "warning" | "suggestion", "category": "...", "title": "...", "detail": "...", "action": "..."}]
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });
      if (res.status === 429 && attempt === 1) {
        console.log(`[Busined's AI] Rate limit (429) beklendi (12 sn)...`);
        await new Promise(r => setTimeout(r, 12000));
        continue;
      }
      if (!res.ok) {
        const errTxt = await res.text();
        throw new Error(`HTTP ${res.status}: ${errTxt.slice(0, 160)}`);
      }
      const json = await res.json();
      let text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        text = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log(`[Busined's AI] ${account.name} için ${parsed.length} yeni bulgu üretildi.`);
          return parsed;
        }
      }
    } catch (err) {
      console.warn(`[Busined's AI] ${account.name} için API çağrısı atlandı, mevcut bulgular korundu:`, err.message);
      break;
    }
  }
  return account.findings || [];
}

/**
 * E-Posta Gönderici (Google Apps Script / Webhook veya SMTP üzerinden)
 */
async function sendEmailNotification(subject, htmlBody, db) {
  const emailWebhook = process.env.EMAIL_WEBHOOK_URL || db.settings.emailWebhookUrl || '';
  const recipient = process.env.NOTIFY_EMAIL || db.settings.emailRecipient || '';

  if (!emailWebhook || !recipient) {
    console.log(`[Busined's Mail] Bildirim hazır (${subject}) — E-posta alıcısı veya Webhook tanımlanmadığı için konsola yazıldı.`);
    return;
  }

  try {
    await fetch(emailWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: recipient, subject, htmlBody })
    });
    console.log(`[Busined's Mail] E-posta başarıyla gönderildi -> ${recipient}`);
  } catch (e) {
    console.warn(`[Busined's Mail] Gönderim hatası:`, e.message);
  }
}

/**
 * Ana Çalıştırma Fonksiyonu
 * @param {Object} options - { forceFullReport: boolean }
 */
async function runAuditCycle(options = {}) {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  let db = JSON.parse(raw);

  // 1. Her çalışmada (08:15 ve 23:30) canlı MCC verisini birleştir
  db = mergeLiveMccData(db);

  const approvedAccounts = db.accounts.filter(a => a.approved);
  const now = new Date();
  const lastReportTime = db.settings.lastAuditDate ? new Date(db.settings.lastAuditDate).getTime() : 0;
  const daysSinceLastReport = (now.getTime() - lastReportTime) / (1000 * 60 * 60 * 24);

  const isTestRun = options.isTestRun === true;
  const isFiveDayDue = isTestRun || options.forceFullReport === true || daysSinceLastReport >= 4.8;

  if (!isFiveDayDue) {
    // KATMAN 1: SADECE GÜNLÜK HAYATİ KONTROL (HEALTH CHECK)
    console.log(`[Busined's] Günlük Hayati Kontrol (Health Check) çalıştırılıyor... (Son 5G rapordan bu yana ${daysSinceLastReport.toFixed(1)} gün geçti)`);
    const emergencies = runDailyEmergencyCheck(approvedAccounts);
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');

    if (emergencies.length > 0) {
      console.log(`[Busined's ACİL] ${emergencies.length} hayati durum tespit edildi! Acil uyarı gönderiliyor.`);
      const html = `<h3>Busined's — Günlük Acil Durum Uyarısı</h3><ul>` +
        emergencies.map(e => `<li><strong>${e.accountName} (${e.customerId}) — ${e.type}:</strong> ${e.message}</li>`).join('') +
        `</ul>`;
      await sendEmailNotification(`🚨 [Busined's ACİL] ${emergencies.length} Hesapta Hayati Uyarı!`, html, db);
    } else {
      console.log(`[Busined's] Tüm hesaplarda hayati göstergeler normal. Sessiz modda tamamlandı (5. gün rapor bekleniyor).`);
    }
    return { mode: 'daily_health_check', emergencies, db };
  }

  // KATMAN 2: 5 GÜNDE BİR KAPSAMLI YAPAY ZEKA DENETİMİ & PDF RAPOR BÜLTENİ
  console.log(`[Busined's] ${isTestRun ? '[TEST KOŞUSU] ' : ''}Kapsamlı Denetim & Raporlama Başladı (${approvedAccounts.length} Onaylı Hesap)...`);

  const apiKey = process.env.GEMINI_API_KEY || '';
  const modelName = db.settings.aiModel || 'gemini-2.5-flash';

  let criticalCount = 0;
  let warningCount = 0;
  let suggestionCount = 0;
  let totalSpendTl = 0;
  let totalConversions = 0;

  for (const acc of approvedAccounts) {
    const findings = await analyzeAccountWithGemini(acc, apiKey, modelName);
    acc.findings = findings;
    if (apiKey) await new Promise(r => setTimeout(r, 4000));
    totalSpendTl += Number(acc.spend5dTl || 0);
    totalConversions += Number(acc.conversions5d || 0);

    for (const f of findings) {
      if (f.severity === 'critical') criticalCount++;
      else if (f.severity === 'warning') warningCount++;
      else suggestionCount++;
    }
  }

  // Eğer bu bir TEST koşusu değilse normal 5 günlük sayacı sıfırla; TEST koşusuysa gerçek 5 günlük takvimi bozma!
  if (!isTestRun) {
    const next = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    db.settings.lastAuditDate = now.toISOString();
    db.settings.nextAuditDate = next.toISOString();
  }

  const reportNumber = (db.reportsArchive?.length || 1) + 1;
  const dateStr = now.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('tr-TR', { day: '2-digit', month: 'long' });

  const newReport = {
    id: `rep-${isTestRun ? 'test-' : ''}${now.toISOString().slice(0, 10)}-${Math.floor(Math.random() * 90 + 10)}`,
    title: isTestRun
      ? `[TEST RAPORU] Gemini 2.5 Flash Canlı Denetim Denemesi`
      : `5 Günlük Genel Denetim Raporu — #${reportNumber}`,
    date: dateStr,
    period: `${fiveDaysAgo} – ${dateStr}`,
    accountsAudited: approvedAccounts.length,
    criticalCount,
    warningCount,
    suggestionCount,
    totalSpendTl: Math.round(totalSpendTl),
    totalConversions: Math.round(totalConversions),
    summary: `${isTestRun ? '[TEST KOŞUSU — Gerçek 5 günlük zamanlayıcı bozulmadı] ' : ''}${approvedAccounts.length} onaylı hesap Gemini (${modelName}) ile canlı MCC verileri üzerinden denetlendi. ${criticalCount} kritik müdahale, ${warningCount} uyarı ve ${suggestionCount} büyüme önerisi oluşturuldu.`
  };

  // Varsa önceki test raporunu temizle ki arşiv kirlenmesin, en üste ekle
  if (isTestRun) {
    db.reportsArchive = (db.reportsArchive || []).filter(r => !String(r.id).startsWith('rep-test-'));
  }
  db.reportsArchive.unshift(newReport);
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');

  const reportHtml = `
    <h2>${newReport.title} (${newReport.period})</h2>
    <p><strong>Toplam 5G Harcama:</strong> ₺${newReport.totalSpendTl.toLocaleString('tr-TR')} | <strong>Toplam Dönüşüm:</strong> ${newReport.totalConversions}</p>
    <p>🔴 Kritik: ${criticalCount} | 🟡 Uyarı: ${warningCount} | 🟢 Öneri: ${suggestionCount}</p>
    <p>${newReport.summary}</p>
  `;
  await sendEmailNotification(`📊 ${newReport.title} Hazır (${criticalCount} Kritik, ${warningCount} Uyarı)`, reportHtml, db);

  console.log(`[Busined's] Rapor tamamlandı ve arşive eklendi: ${newReport.title}`);
  return { mode: isTestRun ? 'test_report' : 'five_day_full_report', report: newReport, db };
}

if (require.main === module) {
  const isTest = process.argv.includes('--test-run') || process.env.TEST_RUN === 'true';
  const forceFull = process.argv.includes('--force-full') || process.env.FORCE_FULL_REPORT === 'true';
  runAuditCycle({ forceFullReport: forceFull, isTestRun: isTest }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runAuditCycle, mergeLiveMccData };
