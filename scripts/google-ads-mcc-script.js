/**
 * Busined's — Google Ads MCC Canlı Veri Köprüsü (GitHub API Doğrudan Senkronizasyon)
 * 
 * Bu script Google Ads içinde çalıştığında tüm hesapların PMax + Arama kampanyalarını,
 * 5 farklı tarih aralığını (Bugün, 5G, 7G, 14G, 30G), dönüşüm kırılımlarını ve arama terimlerini
 * çekip doğrudan GitHub depondaki data/mcc-live.json dosyasına yazar.
 */

const GITHUB_CONFIG = {
  OWNER: 'zideofturkey',
  REPO: 'busineds',
  BRANCH: 'main',
  FILE_PATH: 'data/mcc-live.json',
  TOKEN: 'ghp_BURAYA_GITHUB_TOKEN_GELECEK',
  IGNORED_IDS: ['999-888-7710']   // Yıldız Spot vb.
};

function main() {
  const accountIterator = AdsManagerApp.accounts().get();
  const result = [];

  const now = new Date();
  const tz = AdsApp.currentAccount().getTimeZone();
  const fmt = (d) => Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  const daysAgo = (n) => fmt(new Date(now.getTime() - n * 24 * 60 * 60 * 1000));

  const today = fmt(now);
  const d5 = daysAgo(5);
  const d7 = daysAgo(7);
  const d14 = daysAgo(14);
  const d30 = daysAgo(30);

  while (accountIterator.hasNext()) {
    const account = accountIterator.next();
    const cid = account.getCustomerId();
    if (GITHUB_CONFIG.IGNORED_IDS.indexOf(cid) !== -1) continue;

    AdsManagerApp.select(account);
    const name = account.getName() || 'İsimsiz Hesap';

    const ranges = {
      today: getAccountMetrics(today, today),
      '5d': getAccountMetrics(d5, today),
      '7d': getAccountMetrics(d7, today),
      '14d': getAccountMetrics(d14, today),
      '30d': getAccountMetrics(d30, today)
    };

    const campaigns = [];
    try {
      const campQuery = `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          metrics.cost_micros,
          metrics.conversions,
          metrics.clicks,
          metrics.impressions,
          metrics.ctr,
          metrics.search_impression_share,
          metrics.search_budget_lost_impression_share
        FROM campaign
        WHERE segments.date BETWEEN '${d5}' AND '${today}'
        ORDER BY metrics.cost_micros DESC
      `;
      const rows = AdsApp.search(campQuery);
      while (rows.hasNext()) {
        const r = rows.next();
        const cost5d = Math.round((r.metrics.costMicros || 0) / 1000000);
        if (r.campaign.status === 'ENABLED' || cost5d > 0) {
          campaigns.push({
            name: r.campaign.name,
            status: r.campaign.status,
            type: r.campaign.advertisingChannelType,
            spend5d: cost5d,
            conversions5d: Math.round((r.metrics.conversions || 0) * 10) / 10,
            clicks5d: Number(r.metrics.clicks || 0),
            impressions5d: Number(r.metrics.impressions || 0),
            ctr5d: Math.round((r.metrics.ctr || 0) * 10000) / 100,
            impShare: r.metrics.searchImpressionShare ? Math.round(r.metrics.searchImpressionShare * 100) : null,
            budgetLostShare: r.metrics.searchBudgetLostImpressionShare ? Math.round(r.metrics.searchBudgetLostImpressionShare * 100) : null
          });
        }
      }
    } catch (e) {}

    const conversionActions = [];
    try {
      const convQuery = `
        SELECT segments.conversion_action_name, metrics.conversions
        FROM customer
        WHERE segments.date BETWEEN '${d5}' AND '${today}'
      `;
      const cRows = AdsApp.search(convQuery);
      while (cRows.hasNext()) {
        const cr = cRows.next();
        if (cr.metrics.conversions > 0) {
          conversionActions.push({
            action: cr.segments.conversionActionName,
            count5d: Math.round(cr.metrics.conversions * 10) / 10
          });
        }
      }
    } catch (e) {}

    const topTerms = [];
    try {
      const termQuery = `
        SELECT search_term_view.search_term, metrics.clicks, metrics.cost_micros, metrics.conversions
        FROM search_term_view
        WHERE segments.date BETWEEN '${d5}' AND '${today}' AND metrics.cost_micros > 0
        ORDER BY metrics.cost_micros DESC LIMIT 12
      `;
      const tRows = AdsApp.search(termQuery);
      while (tRows.hasNext()) {
        const tr = tRows.next();
        topTerms.push({
          term: tr.searchTermView.searchTerm,
          clicks: Number(tr.metrics.clicks || 0),
          costTl: Math.round((tr.metrics.costMicros || 0) / 1000000),
          conv: Math.round((tr.metrics.conversions || 0) * 10) / 10
        });
      }
    } catch (e) {}

    result.push({
      customerId: cid,
      name: name,
      ranges: ranges,
      campaigns: campaigns,
      conversionActions: conversionActions,
      topSearchTerms: topTerms
    });
  }

  const payloadObj = {
    syncedAt: new Date().toISOString(),
    accountsCount: result.length,
    accounts: result
  };

  pushToGitHub(payloadObj);
}

function getAccountMetrics(startDate, endDate) {
  try {
    const q = `
      SELECT
        metrics.cost_micros,
        metrics.conversions,
        metrics.clicks,
        metrics.impressions,
        metrics.ctr,
        metrics.search_impression_share,
        metrics.search_budget_lost_impression_share
      FROM customer
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;
    const rows = AdsApp.search(q);
    if (rows.hasNext()) {
      const r = rows.next();
      const spend = Math.round((r.metrics.costMicros || 0) / 1000000);
      const conv = Math.round((r.metrics.conversions || 0) * 10) / 10;
      const clicks = Number(r.metrics.clicks || 0);
      const imp = Number(r.metrics.impressions || 0);
      return {
        spend: spend,
        conversions: conv,
        clicks: clicks,
        impressions: imp,
        ctr: Math.round((r.metrics.ctr || 0) * 10000) / 100,
        cpa: conv > 0 ? Math.round(spend / conv) : 0,
        cpc: clicks > 0 ? Math.round((spend / clicks) * 10) / 10 : 0,
        impShare: r.metrics.searchImpressionShare ? Math.round(r.metrics.searchImpressionShare * 100) : null,
        budgetLostShare: r.metrics.searchBudgetLostImpressionShare ? Math.round(r.metrics.searchBudgetLostImpressionShare * 100) : null
      };
    }
  } catch (e) {}
  return { spend: 0, conversions: 0, clicks: 0, impressions: 0, ctr: 0, cpa: 0, cpc: 0 };
}

function pushToGitHub(dataObj) {
  if (GITHUB_CONFIG.TOKEN.indexOf('BURAYA_') !== -1) {
    Logger.log('GitHub Token henüz girilmedi. Veri sadece loglara yazıldı.');
    Logger.log(JSON.stringify(dataObj));
    return;
  }

  const apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.OWNER + '/' + GITHUB_CONFIG.REPO + '/contents/' + GITHUB_CONFIG.FILE_PATH;
  const headers = {
    'Authorization': 'Bearer ' + GITHUB_CONFIG.TOKEN,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'Busineds-MCC-Script'
  };

  // Mevcut dosyanın SHA değerini al (güncelleme için gerekli)
  let sha = null;
  const getRes = UrlFetchApp.fetch(apiUrl + '?ref=' + GITHUB_CONFIG.BRANCH, {
    method: 'get',
    headers: headers,
    muteHttpExceptions: true
  });

  if (getRes.getResponseCode() === 200) {
    const existing = JSON.parse(getRes.getContentText());
    sha = existing.sha;
  }

  const jsonString = JSON.stringify(dataObj, null, 2);
  const base64Content = Utilities.base64Encode(jsonString, Utilities.Charset.UTF_8);

  const body = {
    message: 'sync: Google Ads MCC canli veri aktarimi (' + new Date().toISOString().slice(0, 16) + ')',
    content: base64Content,
    branch: GITHUB_CONFIG.BRANCH
  };
  if (sha) body.sha = sha;

  const putRes = UrlFetchApp.fetch(apiUrl, {
    method: 'put',
    headers: headers,
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  Logger.log('GitHub Aktarım Durumu: HTTP ' + putRes.getResponseCode());
}
