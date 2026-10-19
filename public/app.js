/**
 * Busined's — Ön Yüz Mantığı
 */

let state = {
  db: null,
  findingFilter: 'all',
  findingAccountFilter: 'all',
  findingCategoryFilter: 'all',
  accountFilter: 'all',
  activeDetailAccountId: null,
  detailRange: '5d'
};

const MCC_SCRIPT_SNIPPET = `// Busined's Google Ads MCC Veri Köprüsü
const IGNORED_IDS = ['999-888-7710']; // Yıldız Spot vb.

function main() {
  const accounts = AdsManagerApp.accounts().get();
  while (accounts.hasNext()) {
    const acc = accounts.next();
    if (IGNORED_IDS.indexOf(acc.getCustomerId()) !== -1) continue;
    AdsManagerApp.select(acc);
    const stats = acc.getStatsFor('LAST_7_DAYS');
    Logger.log(acc.getName() + ' | Harcama: ' + stats.getCost() + ' TL | Dönüşüm: ' + stats.getConversions());
  }
}`;

const CLAUDE_PROMPT_TEMPLATE = `Merhaba Claude. Türkiye'de yönettiğim lokal işletme Google Ads hesaplarını takip etmek ve her 5 günde bir denetlemek için "Busined's" adında bir sistem kullanıyorum.

Busined's nedir ve nasıl çalışır?
- Her Google Ads hesabını standart kalıplarla değil, kendi sektör dinamiklerine, lokasyonuna, dönüşüm hedefine, hedef EBM (CPA) sınırına ve hesaba özel kurallara göre inceleyen bir denetim sistemidir.
- Şimdi senin Google Ads / tarayıcı uzantınla şu an açık olan (veya sana göstereceğim) Google Ads hesabını detaylıca taramanı ve Busined's sistemime kaydedebilmem için gerekli "Hesap Kimlik Kartı" verilerini çıkarmanı istiyorum.

Lütfen şu adımları izle:
1. ÖNCE HESABI TARA (KESİNLİKLE TAHMİN YÜRÜTME / KAFANDAN SALLAMA):
   - Hesabın adını ve 10 haneli Müşteri ID'sini (XXX-XXX-XXXX) al.
   - Aktif kampanyaları, reklam gruplarını, anahtar kelimeleri ve reklam metinlerini inceleyerek işletmenin tam sektörünü ve odaklandığı hizmetleri çıkar.
   - Yer (Lokasyon) hedefleme ayarlarına bak (Hangi il/ilçe hedefleniyor? "Bulunduğu yer" mi yoksa "İlgi gösteren yer" mi seçili?).
   - Reklam zaman planlamasını kontrol et (Belirli gün veya saatlerde kapalı mı?).
   - Dönüşüm (Conversions) sayfasına ve son 5-7 günlük/30 günlük metriklere bak: Ana dönüşüm hedefi ne (Telefon araması, WhatsApp tıklaması, Form vb.)? Ortalama gerçekleşen EBM (CPA), Harcama, Tıklama Oranı (TO/CTR) ve Gösterim Payı ne durumda?
   - Arama terimleri (Search terms) ve negatif anahtar kelime listelerine bakarak mevcut sorunları veya sızıntıları tespit et.

2. EMİN OLAMADIĞIN VEYA EKSİK KALAN NOKTALARI BANA SOR:
   - Hesaptan doğrudan okunamayan işletme kuralları için (örneğin: "Müşterinin kabul ettiği maksimum Hedef EBM sınırı kaç TL?", "Pazar günleri veya mesai dışı saatlerde işletme açık mı?", "Özellikle odaklanılan veya kesinlikle reklam çıkılmaması gereken bir hizmet var mı?") kafandan değer uydurma.
   - Önce bulabildiğin net verileri bana özetle ve eksik kalan bu stratejik soruları maddeler halinde bana sor.

3. BEN CEVAP VERDİKTEN SONRA SONUÇ JSON ÇIKTISINI ÜRET:
   - Yanıtları aldıktan sonra Busined's paneline doğrudan yapıştırabileceğim şu JSON formatında tek bir kod bloğu ver:

{
  "name": "Firma / Hesap Adı",
  "customerId": "XXX-XXX-XXXX",
  "sector": "Sektör ve Alt Branş (Örn: Diş Kliniği - İmplant & Zirkonyum)",
  "location": "Hedeflenen İl / İlçe",
  "activeCampaigns": 3,
  "primaryGoal": "Ana Dönüşüm Hedefi (Örn: Telefon & WhatsApp)",
  "targetCpaTl": 250,
  "currentCpaTl": 280,
  "spend5dTl": 10000,
  "conversions5d": 35,
  "ctrPercent": 6.4,
  "impressionSharePercent": 68,
  "customRules": "Hesaba özel çalışma saatleri, negatiflenmesi gereken kelime grupları, coğrafi hassasiyetler ve dikkat edilecek tüm kurallar.",
  "findings": [
    {
      "severity": "critical",
      "category": "Sorun Kategorisi",
      "title": "Kısa ve net bulgu başlığı",
      "detail": "Tarama sırasında tespit edilen somut veri ve detay",
      "action": "Yapılması gereken net aksiyon"
    }
  ]
}`;

async function loadData() {
  const res = await fetch('/api/data');
  state.db = await res.json();
  populateFilterDropdowns();
  renderAll();
}

function formatTl(num) {
  return '₺' + Math.round(Number(num || 0)).toLocaleString('tr-TR');
}

function populateFilterDropdowns() {
  if (!state.db) return;
  const accSelect = document.getElementById('filterAccountSelect');
  const catSelect = document.getElementById('filterCategorySelect');

  const currentAcc = state.findingAccountFilter;
  const currentCat = state.findingCategoryFilter;

  const approved = state.db.accounts.filter(a => a.approved);
  accSelect.innerHTML = `<option value="all">Tüm Hesaplar (${approved.length})</option>` +
    approved.map(a => `<option value="${a.id}">${a.name}</option>`).join('');

  const categories = new Set();
  approved.forEach(a => {
    (a.findings || []).forEach(f => {
      if (f.category) categories.add(f.category);
    });
  });

  catSelect.innerHTML = `<option value="all">Tüm Konular</option>` +
    Array.from(categories).map(c => `<option value="${c}">${c}</option>`).join('');

  accSelect.value = currentAcc;
  catSelect.value = currentCat;
}

function renderAll() {
  if (!state.db) return;
  renderHeaderAndKpis();
  renderFindings();
  renderAccounts();
  renderArchive();
  renderIgnored();
  if (state.activeDetailAccountId) {
    renderAccountDetailModal(state.activeDetailAccountId);
  }
}

function renderHeaderAndKpis() {
  const { settings, accounts } = state.db;
  const approved = accounts.filter(a => a.approved);
  const pending = accounts.filter(a => !a.approved);

  const lastDate = settings.lastAuditDate
    ? new Date(settings.lastAuditDate).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';

  document.getElementById('lastAuditLabel').textContent = `SON DENETİM: ${lastDate.toUpperCase()}`;
  document.getElementById('aiModelBadge').textContent = (settings.aiModel || 'gemini-2.5-flash').toUpperCase();

  let criticals = 0;
  let warnings = 0;
  let totalSpend = 0;
  let totalConv = 0;

  approved.forEach(acc => {
    totalSpend += Number(acc.spend5dTl || 0);
    totalConv += Number(acc.conversions5d || 0);
    (acc.findings || []).forEach(f => {
      if (f.severity === 'critical') criticals++;
      else warnings++;
    });
  });

  document.getElementById('kpiApprovedCount').textContent = approved.length;
  document.getElementById('kpiPendingNote').textContent = `/ ${accounts.length} Bağlı (${pending.length} Pasif)`;
  document.getElementById('kpiCriticalCount').textContent = criticals;
  document.getElementById('kpiWarningCount').textContent = warnings;
  document.getElementById('kpiTotalSpend').textContent = formatTl(totalSpend);
  document.getElementById('kpiTotalConv').textContent = `${totalConv} Dönüşüm`;
}

function renderFindings() {
  const container = document.getElementById('findingsLedger');
  const approved = state.db.accounts.filter(a => a.approved);

  const allFindings = [];
  approved.forEach(acc => {
    (acc.findings || []).forEach(f => {
      allFindings.push({
        ...f,
        accountId: acc.id,
        accountName: acc.name,
        accountSector: acc.sector,
        customerId: acc.customerId
      });
    });
  });

  const order = { critical: 1, warning: 2, suggestion: 3 };
  allFindings.sort((a, b) => (order[a.severity] || 9) - (order[b.severity] || 9));

  const filtered = allFindings.filter(f => {
    if (state.findingFilter !== 'all' && f.severity !== state.findingFilter) return false;
    if (state.findingAccountFilter !== 'all' && f.accountId !== state.findingAccountFilter) return false;
    if (state.findingCategoryFilter !== 'all' && f.category !== state.findingCategoryFilter) return false;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="finding-row"><div class="finding-detail">Seçili filtrelere uygun bulgu yok.</div></div>`;
    return;
  }

  const badgeLabels = {
    critical: 'KRİTİK',
    warning: 'UYARI',
    suggestion: 'ÖNERİ'
  };

  container.innerHTML = filtered.map(f => `
    <article class="finding-row sev-${f.severity}">
      <div class="finding-meta-col">
        <span class="sev-badge ${f.severity}">${badgeLabels[f.severity] || 'BULGU'}</span>
        <span class="finding-acc-name" onclick="openAccountDetail('${f.accountId}')" title="Hesap detayını aç">${f.accountName}</span>
        <span class="finding-acc-sector">${f.accountSector}</span>
      </div>
      <div class="finding-body-col">
        <span class="finding-cat">${f.category}</span>
        <h3 class="finding-title">${f.title}</h3>
        <p class="finding-detail">${f.detail}</p>
      </div>
      <div class="finding-action-col">
        <span class="action-label">AKSİYON</span>
        <p class="action-text">${f.action}</p>
      </div>
    </article>
  `).join('');
}

function renderAccounts() {
  const grid = document.getElementById('accountsGrid');
  const all = state.db.accounts;

  const approvedCount = all.filter(a => a.approved).length;
  const pendingCount = all.length - approvedCount;
  const tabs = document.querySelectorAll('#accountFilters .tab-btn');
  if (tabs.length === 3) {
    tabs[0].textContent = `Tümü (${all.length})`;
    tabs[1].textContent = `Aktif (${approvedCount})`;
    tabs[2].textContent = `Pasif (${pendingCount})`;
  }

  let list = all;
  if (state.accountFilter === 'approved') list = all.filter(a => a.approved);
  if (state.accountFilter === 'pending') list = all.filter(a => !a.approved);

  grid.innerHTML = list.map(acc => {
    const overCpa = acc.currentCpaTl > acc.targetCpaTl;
    return `
      <div class="account-card ${acc.approved ? '' : 'unapproved'}">
        <div class="acc-card-clickable" onclick="openAccountDetail('${acc.id}')">
          <div class="acc-card-top">
            <div class="acc-header-row">
              <div>
                <span class="acc-cid">${acc.customerId} · ${acc.location}</span>
                <h3 class="acc-title">${acc.name}</h3>
                <span class="acc-kulvar">${acc.sector} · ${acc.primaryGoal}</span>
              </div>
              <span class="health-pill">Skor: ${acc.healthScore}</span>
            </div>
          </div>

          <div class="acc-metrics-grid">
            <div class="acc-metric">
              <span class="acc-metric-lbl">KAMPANYA</span>
              <span class="acc-metric-val">${acc.activeCampaigns} Aktif</span>
            </div>
            <div class="acc-metric">
              <span class="acc-metric-lbl">HEDEF / EBM</span>
              <span class="acc-metric-val ${overCpa ? 'over-cpa' : ''}">₺${acc.targetCpaTl} / ₺${acc.currentCpaTl}</span>
            </div>
            <div class="acc-metric">
              <span class="acc-metric-lbl">5G HARCAMA</span>
              <span class="acc-metric-val">${formatTl(acc.spend5dTl)}</span>
            </div>
            <div class="acc-metric">
              <span class="acc-metric-lbl">5G DÖNÜŞÜM</span>
              <span class="acc-metric-val">${acc.conversions5d}</span>
            </div>
          </div>

          <div class="acc-rules-box">
            ${acc.customRules || 'Özel kural tanımlanmadı.'}
          </div>
        </div>

        <div class="acc-card-footer">
          <div class="approval-toggle" onclick="toggleApproval('${acc.id}', '${acc.name.replace(/'/g, "\\'")}', ${acc.approved})">
            <span class="toggle-dot ${acc.approved ? 'on' : ''}"></span>
            <span>${acc.approved ? 'TAKİP AKTİF' : 'PASİF'}</span>
          </div>
          <div style="display:flex; gap:0.4rem;">
            <button class="btn btn-crimson btn-sm" onclick="openAccountDetail('${acc.id}')">Detay &amp; Metrikler</button>
            <button class="btn btn-outline btn-sm" onclick="openEditAccount('${acc.id}')">Düzenle</button>
            <button class="btn btn-outline btn-sm" onclick="ignoreAccount('${acc.id}', '${acc.name.replace(/'/g, "\\'")}')" title="Yoksayılanlara taşı">Yoksay</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Hesap Detay Modalı ve Tarih Aralığı Hesaplamaları
function getRangeMultipliers(rangeKey) {
  switch (rangeKey) {
    case 'today': return { days: 1, factor: 0.21, label: 'Bugün' };
    case '5d':    return { days: 5, factor: 1.0,  label: 'Son 5 Gün' };
    case '7d':    return { days: 7, factor: 1.38, label: 'Son 7 Gün' };
    case '14d':   return { days: 14, factor: 2.72, label: 'Son 14 Gün' };
    case '30d':   return { days: 30, factor: 5.85, label: 'Son 30 Gün' };
    default:      return { days: 5, factor: 1.0,  label: 'Son 5 Gün' };
  }
}

function openAccountDetail(id) {
  state.activeDetailAccountId = id;
  renderAccountDetailModal(id);
  document.getElementById('accountDetailModal').classList.remove('hidden');
}

function renderAccountDetailModal(id) {
  const acc = state.db.accounts.find(a => a.id === id);
  if (!acc) return;

  const { factor, label } = getRangeMultipliers(state.detailRange);

  document.getElementById('detCid').textContent = `MÜŞTERİ ID: ${acc.customerId} · ${acc.location}`;
  document.getElementById('detName').textContent = acc.name;
  document.getElementById('detSector').textContent = `${acc.sector} · Ana Hedef: ${acc.primaryGoal}`;

  const realRange = acc.ranges && acc.ranges[state.detailRange];
  const spend = realRange ? Math.round(realRange.spend) : Math.round(acc.spend5dTl * factor);
  const conversions = realRange ? Math.round(realRange.conversions * 10) / 10 : Math.round(acc.conversions5d * factor);
  const clicks = realRange ? realRange.clicks : Math.round((acc.clicks5d || 1) * factor);
  const impressions = realRange ? realRange.impressions : Math.round((acc.impressions5d || 1) * factor);
  const ctr = realRange ? Number(realRange.ctr || 0) : Number(acc.ctrPercent || 0);
  const cpa = conversions > 0 ? Math.round(spend / conversions) : 0;
  const avgCpc = clicks > 0 ? (spend / clicks).toFixed(1) : 0;
  const convRate = clicks > 0 ? ((conversions / clicks) * 100).toFixed(1) : 0;
  const impShare = (realRange && realRange.impShare != null) ? realRange.impShare : (acc.impressionSharePercent ?? '—');
  const lostBudgetShare = (realRange && realRange.budgetLostShare != null) ? realRange.budgetLostShare : (acc.budgetLostSharePercent ?? '—');

  const overCpa = cpa > acc.targetCpaTl;
  const convBreakdownText = Array.isArray(acc.conversionActions) && acc.conversionActions.length > 0
    ? acc.conversionActions.map(ca => `${ca.action}: ${ca.count5d}`).join(' · ')
    : 'Canlı MCC Verisi';

  document.getElementById('detailMetricsGrid').innerHTML = `
    <div class="detail-metric-box">
      <span class="detail-metric-lbl">HARCAMA (${label.toUpperCase()})</span>
      <span class="detail-metric-val">${formatTl(spend)}</span>
      <span class="detail-metric-sub">30 Günlük: ${formatTl(acc.spend30dTl || acc.spend5dTl * 5.8)}</span>
    </div>
    <div class="detail-metric-box">
      <span class="detail-metric-lbl">DÖNÜŞÜM (${label.toUpperCase()})</span>
      <span class="detail-metric-val">${conversions}</span>
      <span class="detail-metric-sub">Dönüşüm Oranı: %${convRate}</span>
    </div>
    <div class="detail-metric-box">
      <span class="detail-metric-lbl">GERÇEKLEŞEN EBM / HEDEF</span>
      <span class="detail-metric-val ${overCpa ? 'crimson-text' : ''}">₺${cpa}</span>
      <span class="detail-metric-sub">Hedef Sınırı: ₺${acc.targetCpaTl}</span>
    </div>
    <div class="detail-metric-box">
      <span class="detail-metric-lbl">TIKLAMA &amp; ORT. TBM (CPC)</span>
      <span class="detail-metric-val">${clicks.toLocaleString('tr-TR')}</span>
      <span class="detail-metric-sub">Ort. TBM: ₺${avgCpc}</span>
    </div>
    <div class="detail-metric-box">
      <span class="detail-metric-lbl">GÖSTERİM &amp; TO (CTR)</span>
      <span class="detail-metric-val">${impressions.toLocaleString('tr-TR')}</span>
      <span class="detail-metric-sub">TO (CTR): %${ctr.toFixed(2)}</span>
    </div>
    <div class="detail-metric-box">
      <span class="detail-metric-lbl">GÖSTERİM PAYI &amp; BÜTÇE KAYBI</span>
      <span class="detail-metric-val">%${impShare}</span>
      <span class="detail-metric-sub">Bütçe Kaynaklı Kayıp: %${lostBudgetShare}</span>
    </div>
    <div class="detail-metric-box" style="grid-column: span 2;">
      <span class="detail-metric-lbl">5 GÜNLÜK DÖNÜŞÜM İŞLEMİ KIRILIMI (GERÇEK HEDEF DAĞILIMI)</span>
      <span class="detail-metric-val" style="font-size:1.05rem;">${convBreakdownText}</span>
      <span class="detail-metric-sub">Aktif Kampanya: ${acc.activeCampaigns} (PMax &amp; Arama)</span>
    </div>
  `;

  // Gerçek Kampanya Kırılım Satırları (Son 5 Gün Gerçek + Oranlama)
  const realCampaigns = Array.isArray(acc.campaigns) && acc.campaigns.length > 0 ? acc.campaigns : [];
  const rowsHtml = realCampaigns.map(c => {
    const cSpend = Math.round((c.spend5d || 0) * factor);
    const cConv = Math.max(0, Math.round((c.conversions5d || 0) * factor * 10) / 10);
    const cClicks = Math.max(1, Math.round((c.clicks5d || 1) * factor));
    const cImp = Math.max(1, Math.round((c.impressions5d || 1) * factor));
    const cCtr = Number(c.ctr5d || ((cClicks / cImp) * 100)).toFixed(2);
    const cCpc = (cSpend / cClicks).toFixed(1);
    const cCpa = cConv > 0 ? Math.round(cSpend / cConv) : cSpend;
    const typeLabel = c.type === 'PERFORMANCE_MAX' ? 'PMax' : (c.type === 'SEARCH' ? 'Arama' : (c.type || 'Aktif'));
    const lostTxt = c.budgetLostShare != null ? ` (Bütçe Kaybı: %${c.budgetLostShare})` : '';

    return `
      <tr>
        <td><strong>${c.name}</strong><div style="font-size:0.72rem; color:var(--text-muted);">${typeLabel}${lostTxt}</div></td>
        <td><span style="color:var(--emerald); font-family:var(--font-mono); font-size:0.72rem;">${typeLabel.toUpperCase()}</span></td>
        <td>${formatTl(cSpend)}</td>
        <td>${cImp.toLocaleString('tr-TR')}</td>
        <td>${cClicks.toLocaleString('tr-TR')}</td>
        <td>%${cCtr}</td>
        <td>₺${cCpc}</td>
        <td>${cConv}</td>
        <td class="${cCpa > acc.targetCpaTl ? 'crimson-text' : ''}"><strong>₺${cCpa}</strong></td>
      </tr>
    `;
  });

  document.querySelector('#detailCampaignsTable tbody').innerHTML = rowsHtml.join('') || `<tr><td colspan="9">Aktif kampanya verisi yok.</td></tr>`;

  // Gerçek Arama Terimleri Tablosu
  const terms = Array.isArray(acc.topSearchTerms) ? acc.topSearchTerms : [];
  const termRows = terms.map(t => {
    const tCost = Number(t.costTl || 0);
    const tConv = Math.round(Number(t.conv || 0) * 10) / 10;
    const tCpa = tConv > 0 ? `₺${Math.round(tCost / tConv)}` : '0 Dönüşüm';
    return `
      <tr>
        <td><strong>${t.term}</strong></td>
        <td>${t.clicks}</td>
        <td>${formatTl(tCost)}</td>
        <td>${tConv}</td>
        <td class="${tConv === 0 ? 'crimson-text' : ''}"><strong>${tCpa}</strong></td>
      </tr>
    `;
  });
  const searchTermsBody = document.querySelector('#detailSearchTermsTable tbody');
  if (searchTermsBody) {
    searchTermsBody.innerHTML = termRows.join('') || `<tr><td colspan="5">Arama terimi verisi yok.</td></tr>`;
  }

  document.getElementById('detRulesBanner').innerHTML = `<strong>Hesap Kuralları:</strong> ${acc.customRules || 'Özel kural girilmemiş.'}`;

  const badgeLabels = { critical: 'KRİTİK', warning: 'UYARI', suggestion: 'ÖNERİ' };
  const fList = acc.findings || [];
  document.getElementById('detailFindingsList').innerHTML = fList.map(f => `
    <article class="finding-row sev-${f.severity}" style="grid-template-columns: 140px 1fr 260px;">
      <div class="finding-meta-col">
        <span class="sev-badge ${f.severity}">${badgeLabels[f.severity] || 'BULGU'}</span>
        <span class="finding-acc-sector">${f.category}</span>
      </div>
      <div class="finding-body-col">
        <h3 class="finding-title" style="margin-top:0;">${f.title}</h3>
        <p class="finding-detail">${f.detail}</p>
      </div>
      <div class="finding-action-col">
        <span class="action-label">AKSİYON</span>
        <p class="action-text">${f.action}</p>
      </div>
    </article>
  `).join('');
}

function renderArchive() {
  const list = document.getElementById('archiveList');
  const reports = state.db.reportsArchive || [];

  list.innerHTML = reports.map(rep => `
    <div class="archive-item">
      <div class="archive-date">
        <span>${rep.date}</span>
        <span>${rep.accountsAudited} HESAP</span>
      </div>
      <h4 class="archive-name">${rep.title}</h4>
      <p class="archive-summary">${rep.summary}</p>
      <div class="archive-actions">
        <span style="font-family:var(--font-mono); font-size:0.7rem; color:var(--text-muted);">
          🔴 ${rep.criticalCount} · 🟡 ${rep.warningCount} · 🟢 ${rep.suggestionCount}
        </span>
        <button class="btn btn-crimson btn-sm" onclick="downloadReportPdf('${rep.id}')">
          PDF İndir
        </button>
      </div>
    </div>
  `).join('');
}

function renderIgnored() {
  const list = document.getElementById('ignoredList');
  const ignored = state.db.ignoredAccounts || [];
  if (ignored.length === 0) {
    list.innerHTML = `<div class="ignored-item">Yoksayılan hesap yok.</div>`;
    return;
  }
  list.innerHTML = ignored.map(item => `
    <div class="ignored-item">
      <strong>${item.name}</strong>
      <span>ID: ${item.customerId} — ${item.reason}</span>
    </div>
  `).join('');
}

// İkinci onay (Confirmation) ile Aktif/Pasif değiştirme
async function toggleApproval(id, name, currentlyApproved) {
  const actionText = currentlyApproved
    ? `"${name}" hesabını 5 günlük denetim takibinden çıkarıp PASİF yapmak istediğine emin misin?`
    : `"${name}" hesabını 5 günlük denetim takibine dahil edip AKTİF yapmak istiyor musun?`;

  if (!confirm(actionText)) return;

  const res = await fetch('/api/accounts/toggle-approval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
  const data = await res.json();
  if (data.db) {
    state.db = data.db;
    populateFilterDropdowns();
    renderAll();
  }
}

async function ignoreAccount(id, name) {
  if (!confirm(`"${name}" hesabını Yıldız Spot gibi yoksayılanlar listesine taşımak istiyor musun?`)) return;
  const res = await fetch('/api/accounts/ignore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, reason: 'Panel üzerinden takip dışı bırakıldı.' })
  });
  const data = await res.json();
  if (data.db) {
    state.db = data.db;
    populateFilterDropdowns();
    renderAll();
  }
}

function openEditAccount(id) {
  const modal = document.getElementById('accountModal');
  const acc = state.db.accounts.find(a => a.id === id);
  if (!acc) return;

  document.getElementById('accountModalTitle').textContent = `${acc.name} — Düzenle`;
  document.getElementById('accId').value = acc.id;
  document.getElementById('accName').value = acc.name;
  document.getElementById('accCustomerId').value = acc.customerId;
  document.getElementById('accSector').value = acc.sector;
  document.getElementById('accLocation').value = acc.location;
  document.getElementById('accGoal').value = acc.primaryGoal;
  document.getElementById('accCampaigns').value = acc.activeCampaigns;
  document.getElementById('accTargetCpa').value = acc.targetCpaTl;
  document.getElementById('accCurrentCpa').value = acc.currentCpaTl;
  document.getElementById('accRules').value = acc.customRules;

  modal.classList.remove('hidden');
}

function downloadReportPdf(reportId) {
  const rep = state.db.reportsArchive.find(r => r.id === reportId) || state.db.reportsArchive[0];
  const approved = state.db.accounts.filter(a => a.approved);
  const printBox = document.getElementById('printableReportContainer');

  const findingsHtml = approved.map(acc => {
    const items = (acc.findings || []).map(f => `
      <li style="margin-bottom:8px;">
        <strong>[${f.severity.toUpperCase()} — ${f.category}] ${f.title}:</strong>
        ${f.detail} <br/>
        <em>Aksiyon: ${f.action}</em>
      </li>
    `).join('');
    return `
      <div style="margin-bottom:18px; padding-bottom:12px; border-bottom:1px solid #ccc;">
        <h3 style="margin:0 0 4px 0; color:#1D232C;">${acc.name} (${acc.customerId}) — ${acc.sector}</h3>
        <div style="font-size:13px; color:#555; margin-bottom:6px;">
          5G Harcama: ${formatTl(acc.spend5dTl)} | 5G Dönüşüm: ${acc.conversions5d} | Hedef EBM: ₺${acc.targetCpaTl} | Mevcut EBM: ₺${acc.currentCpaTl}
        </div>
        <ul style="margin:0; padding-left:18px; font-size:14px;">${items}</ul>
      </div>
    `;
  }).join('');

  printBox.innerHTML = `
    <div style="border-bottom:3px solid #FF3147; padding-bottom:14px; margin-bottom:20px;">
      <div style="font-size:12px; letter-spacing:2px; color:#FF3147; font-weight:bold;">BUSINED'S — 5 GÜNLÜK DENETİM RAPORU</div>
      <h1 style="font-size:30px; margin:4px 0;">${rep.title}</h1>
      <div style="font-size:14px; color:#444;">Dönem: ${rep.period} | İncelenen Hesap: ${rep.accountsAudited} | Toplam Harcama: ${formatTl(rep.totalSpendTl)}</div>
    </div>
    <p style="font-size:15px; margin-bottom:20px;"><strong>Özet:</strong> ${rep.summary}</p>
    ${findingsHtml}
  `;

  window.print();
}

document.addEventListener('DOMContentLoaded', () => {
  loadData();

  // Bölüm 1 Filtreleri
  document.getElementById('findingFilters').addEventListener('click', e => {
    if (!e.target.classList.contains('tab-btn')) return;
    document.querySelectorAll('#findingFilters .tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    state.findingFilter = e.target.dataset.filter;
    renderFindings();
  });

  document.getElementById('filterAccountSelect').addEventListener('change', e => {
    state.findingAccountFilter = e.target.value;
    renderFindings();
  });

  document.getElementById('filterCategorySelect').addEventListener('change', e => {
    state.findingCategoryFilter = e.target.value;
    renderFindings();
  });

  // Bölüm 2 Filtreleri
  document.getElementById('accountFilters').addEventListener('click', e => {
    if (!e.target.classList.contains('tab-btn')) return;
    document.querySelectorAll('#accountFilters .tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    state.accountFilter = e.target.dataset.accFilter;
    renderAccounts();
  });

  // Hesap Detay Modalı Olayları
  document.getElementById('closeDetailModal').addEventListener('click', () => {
    state.activeDetailAccountId = null;
    document.getElementById('accountDetailModal').classList.add('hidden');
  });

  document.getElementById('detailRangeTabs').addEventListener('click', e => {
    if (!e.target.classList.contains('tab-btn')) return;
    document.querySelectorAll('#detailRangeTabs .tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    state.detailRange = e.target.dataset.range;
    if (state.activeDetailAccountId) {
      renderAccountDetailModal(state.activeDetailAccountId);
    }
  });

  document.getElementById('btnEditFromDetail').addEventListener('click', () => {
    const id = state.activeDetailAccountId;
    document.getElementById('accountDetailModal').classList.add('hidden');
    if (id) openEditAccount(id);
  });

  // Claude İle Hızlı Ekle Modalı
  document.getElementById('btnOpenClaudeImport').addEventListener('click', () => {
    document.getElementById('claudePromptText').value = CLAUDE_PROMPT_TEMPLATE;
    document.getElementById('claudeModal').classList.remove('hidden');
  });

  document.getElementById('closeClaudeModal').addEventListener('click', () => {
    document.getElementById('claudeModal').classList.add('hidden');
  });

  document.getElementById('btnCopyClaudePrompt').addEventListener('click', () => {
    const txt = document.getElementById('claudePromptText');
    txt.select();
    navigator.clipboard.writeText(txt.value);
    const btn = document.getElementById('btnCopyClaudePrompt');
    btn.textContent = 'Kopyalandı!';
    setTimeout(() => { btn.textContent = 'Promptu Kopyala'; }, 2000);
  });

  document.getElementById('btnImportClaudeJson').addEventListener('click', async () => {
    const raw = document.getElementById('claudeJsonInput').value.trim();
    if (!raw) return alert('Lütfen Claude tarafından üretilen JSON çıktısını yapıştırın.');
    try {
      const parsed = JSON.parse(raw);
      const res = await fetch('/api/accounts/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });
      const data = await res.json();
      if (data.db) {
        state.db = data.db;
        populateFilterDropdowns();
        renderAll();
        document.getElementById('claudeJsonInput').value = '';
        document.getElementById('claudeModal').classList.add('hidden');
      }
    } catch (err) {
      alert('JSON formatı okunamadı. Lütfen sadece { ... } bloğunu yapıştırdığından emin ol.');
    }
  });

  // Hesap Ekle / Düzenle
  document.getElementById('btnNewAccount').addEventListener('click', () => {
    document.getElementById('accountForm').reset();
    document.getElementById('accId').value = '';
    document.getElementById('accountModalTitle').textContent = 'Yeni Hesap Ekle';
    document.getElementById('accountModal').classList.remove('hidden');
  });

  document.getElementById('closeAccountModal').addEventListener('click', () => {
    document.getElementById('accountModal').classList.add('hidden');
  });
  document.getElementById('btnCancelAccount').addEventListener('click', () => {
    document.getElementById('accountModal').classList.add('hidden');
  });

  document.getElementById('accountForm').addEventListener('submit', async e => {
    e.preventDefault();
    const payload = {
      id: document.getElementById('accId').value || undefined,
      name: document.getElementById('accName').value,
      customerId: document.getElementById('accCustomerId').value,
      sector: document.getElementById('accSector').value,
      location: document.getElementById('accLocation').value,
      primaryGoal: document.getElementById('accGoal').value,
      activeCampaigns: Number(document.getElementById('accCampaigns').value),
      targetCpaTl: Number(document.getElementById('accTargetCpa').value),
      currentCpaTl: Number(document.getElementById('accCurrentCpa').value || 200),
      customRules: document.getElementById('accRules').value
    };
    const res = await fetch('/api/accounts/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.db) {
      state.db = data.db;
      populateFilterDropdowns();
      renderAll();
      document.getElementById('accountModal').classList.add('hidden');
    }
  });

  // Ayarlar
  document.getElementById('btnOpenSettings').addEventListener('click', () => {
    const { settings } = state.db;
    document.getElementById('setAiModel').value = settings.aiModel || 'gemini-2.5-flash';
    document.getElementById('setEmail').value = settings.emailRecipient || '';
    document.getElementById('setIgnoredIds').value = (settings.ignoredCustomerIds || []).join(', ');
    document.getElementById('mccScriptPreview').textContent = MCC_SCRIPT_SNIPPET;
    document.getElementById('settingsModal').classList.remove('hidden');
  });

  document.getElementById('closeSettingsModal').addEventListener('click', () => {
    document.getElementById('settingsModal').classList.add('hidden');
  });

  document.getElementById('settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const ignoredCustomerIds = document.getElementById('setIgnoredIds').value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const payload = {
      aiModel: document.getElementById('setAiModel').value,
      emailRecipient: document.getElementById('setEmail').value,
      ignoredCustomerIds
    };
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.db) {
      state.db = data.db;
      renderAll();
      document.getElementById('settingsModal').classList.add('hidden');
    }
  });

  document.getElementById('btnRunAudit').addEventListener('click', async () => {
    const btn = document.getElementById('btnRunAudit');
    const orig = btn.textContent;
    btn.textContent = 'DENETLENİYOR...';
    btn.disabled = true;
    try {
      const res = await fetch('/api/audit/run', { method: 'POST' });
      const data = await res.json();
      if (data.db) {
        state.db = data.db;
        populateFilterDropdowns();
        renderAll();
      }
    } finally {
      btn.textContent = orig;
      btn.disabled = false;
    }
  });
});
