const SPREADSHEET_ID = '1UVjxSh9d7mFpdR3pZIWGG7TCJWiaYTIMN2apSQHjg0U';

const TABS_CONFIG = [
    {
        gid: '1172321346',
        tabName: '賣貨便-訂單', platform: '賣貨便',
        dateIdx: 1, nameIdx: 4, qtyIdx: 7,
        matchType: 'name', inheritDate: true
    },
    {
        gid: '1589327275',
        tabName: '好賣+訂單', platform: '好賣+',
        dateIdx: 32, nameIdx: 9, qtyIdx: 12,
        matchType: 'name', inheritDate: true
    },
    {
        gid: '113883750',
        tabName: 'Order', platform: '蝦皮',
        dateIdx: 3, nameIdx: 14, qtyIdx: 15,
        matchType: 'code', inheritDate: false
    }
];

// 蝦皮財務分析（來自 Analysis 分頁）
const ANALYSIS_GID = '726971026';

// 售價來源
// Item sheet (gid=0)：      B(1)=Code, AA(26)=簡稱, I(8)=蝦皮售價
// 賣貨便 sheet (gid=779764966)：B(1)=Code, C(2)=Item name, G(6)=賣貨便售價
const MAIGO_PRICE_GID = '779764966';

// 賣貨便財務分析（直接從賣貨便-訂單分頁計算）
// 欄位：B(1)=訂單日期  F(5)=單價  G(6)=不含稅單價  H(7)=數量  J(9)=運費  K(10)=訂單總額
// 運費補貼：運費欄==0 → 我方補貼 $38；否則不補貼
// 稅金 = 數量 × (單價 - 不含稅單價)
// 實拿 = 訂單總額 - 稅金 - 運費補貼
// ⚠️ 只讀 B欄有日期的列（主列），空白繼承列不計入財務（避免重複）
const MAIGO_GID = '1172321346';

const PLATFORM_COLORS = {
    '蝦皮':  { bg: 'rgba(238, 77, 45, 0.82)',  border: '#cc3a18', line: '#ee4d2d' },
    '賣貨便': { bg: 'rgba(22, 163, 74, 0.82)',  border: '#15803d', line: '#16a34a' },
    '好賣+':  { bg: 'rgba(37, 99, 235, 0.82)',  border: '#1d4ed8', line: '#2563eb' }
};
const PLATFORMS = ['蝦皮', '賣貨便', '好賣+'];
const MONTHS_LABEL = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

let itemMap      = { codes: {}, names: {} };
let allOrdersData = [];
let analysisData  = [];   // 蝦皮：[{ ym, orders, sales, actual, fee }]
let maigoData     = [];   // 賣貨便：[{ ym, orders, sales, actual }]
let myChart       = null;

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('platform-select').addEventListener('change', onFilterChange);
    document.getElementById('month-select').addEventListener('change', onFilterChange);
    document.getElementById('year-select').addEventListener('change', renderProductMonthly);
    document.getElementById('analysis-year-select').addEventListener('change', () => renderAnalysis(currentAnalysisTab));
    document.getElementById('refresh-btn').addEventListener('click', loadAllData);
    await loadAllData();
});

let currentAnalysisTab = 'all'; // 'all' | 'shopee' | 'maigo' | 'haomai'

function onFilterChange() {
    const isHidden = document.getElementById('section-rank').classList.contains('hidden');
    const activeTab = isHidden ? 'monthly' : 'rank';
    if (activeTab === 'rank') renderData();
    else renderProductMonthly();
}

async function fetchGvizData(gid) {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    return JSON.parse(jsonStr);
}

function parseGvizDate(cell) {
    if (!cell || (cell.v == null && !cell.f)) return null;
    const raw = cell.f ? String(cell.f) : (cell.v != null ? String(cell.v) : '');
    const m1 = raw.match(/(\d{4})[年\/-](\d{1,2})/);
    if (m1) return `${m1[1]}.${m1[2].padStart(2, '0')}`;
    const m2 = String(cell.v ?? '').match(/Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)/);
    if (m2) return `${m2[1]}.${String(parseInt(m2[2]) + 1).padStart(2, '0')}`;
    if (typeof cell.v === 'number' && cell.v > 0) {
        const date = new Date((cell.v - 25569) * 86400 * 1000);
        if (!isNaN(date)) return `${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    return null;
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────
async function loadAllData() {
    const listEl = document.getElementById('ranking-list');
    listEl.innerHTML = '<li class="py-3 text-center text-gray-400">正在同步雲端資料...</li>';
    try {
        await fetchItemDictionary();
        allOrdersData = [];
        await Promise.all([
            ...TABS_CONFIG.map(config => fetchTabOrders(config)),
            fetchAnalysisData(),
            fetchMaigoFinance()
        ]);
        console.log('✅ 總訂單筆數:', allOrdersData.length);
        console.log('✅ 蝦皮財務:', analysisData.length, '筆');
        console.log('✅ 賣貨便財務:', maigoData.length, '筆');
        if (allOrdersData.length === 0 && analysisData.length === 0 && maigoData.length === 0) {
            listEl.innerHTML = `<li class="py-4 text-center text-red-400 text-sm leading-7">
                ⚠️ 無法讀取資料<br>請確認試算表已設為「知道連結的人皆可檢視」</li>`;
            return;
        }
        initMonthSelect();
        renderData();
    } catch (e) {
        console.error('❌ 載入失敗:', e);
        listEl.innerHTML = `<li class="py-4 text-center text-red-400 text-sm">❌ 載入失敗：${e.message}</li>`;
    }
}

async function fetchItemDictionary() {
    try {
        const data = await fetchGvizData(0);
        itemMap = { codes: {}, names: {} };
        if (data?.table?.rows) {
            data.table.rows.forEach(row => {
                if (!row.c) return;
                const code        = row.c[1]?.v  ? String(row.c[1].v).trim()  : '';
                const shortName   = row.c[26]?.v ? String(row.c[26].v).trim() : '';
                const imgUrl      = row.c[28]?.v ? String(row.c[28].v).trim() : '';
                // I欄(8) = 蝦皮售價
                const shopeePrice = row.c[8]?.v  != null ? parseFloat(row.c[8].v) : null;
                if (!shortName) return;
                const entry = { shortName, imgUrl, shopeePrice, maigoPrice: null };
                if (code) itemMap.codes[code] = entry;
                itemMap.names[shortName] = entry;
            });
        }
        console.log('✅ 商品字典載入：', Object.keys(itemMap.names).length, '筆');
        // 載入賣貨便售價並合併進 itemMap
        await fetchMaigoPrice();
    } catch (e) { console.warn('⚠️ 商品字典載入失敗:', e.message); }
}

// ─── 讀取賣貨便售價（gid=779764966）────────────────────────────────────────
// B(1)=Code, C(2)=Item name, G(6)=賣貨便售價
async function fetchMaigoPrice() {
    try {
        const data = await fetchGvizData(MAIGO_PRICE_GID);
        if (data?.table?.rows) {
            data.table.rows.forEach(row => {
                if (!row.c) return;
                const code      = row.c[1]?.v ? String(row.c[1].v).trim() : '';
                const itemName  = row.c[2]?.v ? String(row.c[2].v).trim() : '';
                const maigoPrice = row.c[6]?.v != null ? parseFloat(row.c[6].v) : null;
                if (maigoPrice === null) return;

                // 用 code 比對
                if (code && itemMap.codes[code]) {
                    itemMap.codes[code].maigoPrice = maigoPrice;
                    // 同步更新 names
                    const sn = itemMap.codes[code].shortName;
                    if (itemMap.names[sn]) itemMap.names[sn].maigoPrice = maigoPrice;
                }
                // 用 itemName 模糊比對 AA欄簡稱
                if (itemName) {
                    for (const key in itemMap.names) {
                        if (itemName.includes(key) || key.includes(itemName)) {
                            itemMap.names[key].maigoPrice = maigoPrice;
                            break;
                        }
                    }
                }
            });
        }
        console.log('✅ 賣貨便售價載入完成');
    } catch (e) { console.warn('⚠️ 賣貨便售價載入失敗:', e.message); }
}

async function fetchTabOrders(config) {
    try {
        const data = await fetchGvizData(config.gid);
        let count = 0, lastValidDate = null;
        if (data?.table?.rows) {
            data.table.rows.forEach(row => {
                if (!row.c) return;
                try {
                    const parsedDate = parseGvizDate(row.c[config.dateIdx]);
                    if (parsedDate) { lastValidDate = parsedDate; }
                    else if (config.inheritDate && lastValidDate) { /* 繼承 */ }
                    else { return; }
                    const ym = lastValidDate;
                    const nameCell = row.c[config.nameIdx];
                    if (!nameCell) return;
                    const rawId = nameCell.v ? String(nameCell.v).trim() : '';
                    if (!rawId || rawId === 'null') return;
                    // 純數字只在 name 比對時過濾（避免把數量欄誤判），code 比對（蝦皮貨號）允許純數字
                    if (config.matchType === 'name' && /^\d+$/.test(rawId)) return;
                    let quantity = 1;
                    const qtyCell = row.c[config.qtyIdx];
                    if (qtyCell?.v != null) quantity = parseInt(qtyCell.v) || 1;
                    let resolved = { shortName: rawId, imgUrl: '' };
                    if (config.matchType === 'code') {
                        if (itemMap.codes[rawId]) resolved = itemMap.codes[rawId];
                        else console.warn(`⚠️ [${config.platform}] 找不到貨號：${rawId}`);
                    } else {
                        let matched = false;
                        for (const key in itemMap.names) {
                            if (rawId.includes(key) || key.includes(rawId)) { resolved = itemMap.names[key]; matched = true; break; }
                        }
                        if (!matched) console.warn(`⚠️ [${config.platform}] 找不到名稱對應：${rawId}`);
                    }
                    allOrdersData.push({ month: ym, platform: config.platform, name: resolved.shortName, imgUrl: resolved.imgUrl, quantity });
                    count++;
                } catch (e) { console.warn('單列解析失敗:', e.message); }
            });
        }
        console.log(`✅ [${config.tabName}] 成功讀取 ${count} 筆`);
    } catch (e) { console.error(`❌ [${config.tabName}] 連線失敗:`, e.message); }
}

// ─── 蝦皮財務（Analysis 分頁）────────────────────────────────────────────────
async function fetchAnalysisData() {
    try {
        const data = await fetchGvizData(ANALYSIS_GID);
        analysisData = [];
        if (data?.table?.rows) {
            data.table.rows.forEach(row => {
                if (!row.c) return;
                const cell0 = row.c[0];
                if (!cell0) return;
                const rawMonth = cell0.f ? String(cell0.f).trim() : cell0.v ? String(cell0.v).trim() : '';
                if (!rawMonth) return;
                const m = rawMonth.match(/(\d{4})[年\/\-](\d{1,2})/);
                if (!m) return;
                const ym = `${m[1]}.${m[2].padStart(2, '0')}`;
                analysisData.push({
                    ym,
                    orders: parseFloat(row.c[1]?.v) || 0,
                    sales:  parseFloat(row.c[2]?.v) || 0,
                    actual: parseFloat(row.c[3]?.v) || 0,
                    fee:    parseFloat(row.c[4]?.v) || 0
                });
            });
        }
        analysisData.sort((a, b) => a.ym.localeCompare(b.ym));
    } catch (e) { console.warn('⚠️ Analysis 載入失敗:', e.message); }
}

// ─── 賣貨便財務（直接從訂單分頁計算）─────────────────────────────────────────
// 欄位：B(1)日期  F(5)單價  G(6)不含稅單價  H(7)數量  J(9)運費  K(10)訂單總額
// 兩階段讀取：
//   主列（B欄有日期）：記錄日期、訂單總額、運費補貼（訂單層級）
//   所有列含繼承列：每列都累加稅金 = 數量 × (單價 - 不含稅單價)
async function fetchMaigoFinance() {
    try {
        const data = await fetchGvizData(MAIGO_GID);
        const tmp = {}; // { ym: { orders, sales, tax, freightSubsidy } }
        let lastYm = null;

        if (data?.table?.rows) {
            data.table.rows.forEach(row => {
                if (!row.c) return;

                const parsedYm = parseGvizDate(row.c[1]); // B欄日期

                if (parsedYm) {
                    // ── 主列：有日期，記錄訂單層級資料 ──
                    lastYm = parsedYm;
                    const orderTotal      = parseFloat(row.c[10]?.v) || 0; // K 訂單總額
                    const freight         = parseFloat(row.c[9]?.v)  || 0; // J 運費
                    const freightSubsidy  = freight === 0 ? 38 : 0;        // 運費補貼

                    if (!orderTotal) return; // 無訂單總額跳過

                    if (!tmp[lastYm]) tmp[lastYm] = { orders: 0, sales: 0, tax: 0, freightSubsidy: 0 };
                    tmp[lastYm].orders          += 1;
                    tmp[lastYm].sales           += orderTotal;
                    tmp[lastYm].freightSubsidy  += freightSubsidy;
                }

                // ── 所有列（含繼承列）：累加稅金 ──
                if (!lastYm) return; // 還沒遇到第一個日期，跳過
                const unitPrice   = parseFloat(row.c[5]?.v) || 0; // F 單價
                const unitPriceEx = parseFloat(row.c[6]?.v) || 0; // G 不含稅單價
                const qty         = parseFloat(row.c[7]?.v) || 0; // H 數量
                const tax         = qty * (unitPrice - unitPriceEx);

                if (!tmp[lastYm]) tmp[lastYm] = { orders: 0, sales: 0, tax: 0, freightSubsidy: 0 };
                tmp[lastYm].tax += tax;
            });
        }

        maigoData = Object.entries(tmp).map(([ym, v]) => ({
            ym,
            orders:          v.orders,
            sales:           v.sales,
            tax:             v.tax,
            freightSubsidy:  v.freightSubsidy,
            actual:          v.sales - v.tax - v.freightSubsidy
        })).sort((a, b) => a.ym.localeCompare(b.ym));

        console.log('✅ 賣貨便財務：', maigoData);
    } catch (e) { console.warn('⚠️ 賣貨便財務載入失敗:', e.message); }
}

// ─── 初始化下拉選單 ───────────────────────────────────────────────────────────
function initMonthSelect() {
    const monthSelect = document.getElementById('month-select');
    const months = [...new Set(allOrdersData.map(d => d.month))].sort((a, b) => b.localeCompare(a));
    monthSelect.innerHTML =
        '<option value="all">全部月份（年度累計）</option>' +
        months.map(m => `<option value="${m}">${m.replace('.', ' 年 ')} 月</option>`).join('');
    monthSelect.value = 'all';
    initYearSelect();
    initAnalysisYearSelect();
}

function initYearSelect() {
    const years = [...new Set(allOrdersData.map(d => d.month.split('.')[0]))].sort((a, b) => b - a);
    const sel = document.getElementById('year-select');
    const rangeLabel = years.length > 1 ? `${years[years.length-1]}–${years[0]} 全部` : (years[0] || '全部');
    sel.innerHTML = `<option value="all">${rangeLabel}</option>` +
        years.map(y => `<option value="${y}">${y} 年</option>`).join('');
    sel.value = 'all';
}

function initAnalysisYearSelect() {
    const allYears = [...new Set([
        ...analysisData.map(d => d.ym.split('.')[0]),
        ...maigoData.map(d => d.ym.split('.')[0])
    ])].sort((a, b) => b - a);
    const sel = document.getElementById('analysis-year-select');
    const rangeLabel = allYears.length > 1 ? `${allYears[allYears.length-1]}–${allYears[0]} 全部` : (allYears[0] || '全部');
    sel.innerHTML = `<option value="all">${rangeLabel}</option>` +
        allYears.map(y => `<option value="${y}">${y} 年</option>`).join('');
    sel.value = 'all';
}

// ─── Tab 切換 ─────────────────────────────────────────────────────────────────
function switchTab(tab) {
    ['rank', 'monthly', 'analysis'].forEach(t => {
        document.getElementById(`section-${t}`).classList.toggle('hidden', t !== tab);
        document.getElementById(`tab-btn-${t}`).classList.toggle('active', t === tab);
    });
    document.getElementById('month-select-wrap').classList.toggle('hidden', tab !== 'rank');
    document.getElementById('year-select-wrap').classList.toggle('hidden', tab !== 'monthly');
    document.getElementById('product-search-wrap').classList.toggle('hidden', tab !== 'monthly');
    document.getElementById('analysis-year-wrap').classList.toggle('hidden', tab !== 'analysis');
    document.getElementById('platform-select-wrap').classList.toggle('hidden', tab === 'analysis');

    if (tab === 'monthly') renderProductMonthly();
    if (tab === 'analysis') renderAnalysis(currentAnalysisTab);
}

// ─── 財務分析子 Tab 切換 ──────────────────────────────────────────────────────
function switchAnalysisTab(tab) {
    currentAnalysisTab = tab;
    ['all', 'shopee', 'maigo', 'haomai'].forEach(t => {
        document.getElementById(`atab-${t}`).classList.toggle('atab-active', t === tab);
    });
    renderAnalysis(tab);
}

// ─── 熱銷排行 ─────────────────────────────────────────────────────────────────
function renderData() {
    const p = document.getElementById('platform-select').value;
    const m = document.getElementById('month-select').value;
    const filtered = allOrdersData.filter(d =>
        (p === 'all' || d.platform === p) && (m === 'all' || d.month === m));
    const sum = {};
    filtered.forEach(d => {
        if (!sum[d.name]) sum[d.name] = { qty: 0, img: d.imgUrl };
        sum[d.name].qty += d.quantity;
        if (!sum[d.name].img && d.imgUrl) sum[d.name].img = d.imgUrl;
    });
    const sorted = Object.entries(sum).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty);
    updateChart(sorted);
    updateList(sorted);
}

function updateChart(data) {
    const ctx = document.getElementById('salesChart').getContext('2d');
    if (myChart) myChart.destroy();
    const top = data.slice(0, 15);
    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top.map(d => d.name),
            datasets: [{ label: '銷售件數', data: top.map(d => d.qty),
                backgroundColor: 'rgba(59,130,246,0.75)', borderColor: 'rgba(59,130,246,1)',
                borderWidth: 1, borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { ticks: { maxRotation: 30, font: { size: 11 } } },
                      y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
}

function updateList(data) {
    const el = document.getElementById('ranking-list');
    if (!data.length) { el.innerHTML = '<li class="py-3 text-gray-400 text-center">無銷售數據</li>'; return; }
    el.innerHTML = data.map((d, i) => {
        const imgSrc = d.img?.startsWith('http') ? d.img : 'https://placehold.co/100x100?text=No+Img';
        const rankColor = i===0?'text-yellow-500':i===1?'text-gray-400':i===2?'text-amber-600':'text-gray-300';
        return `<li class="py-4 flex items-center gap-4">
            <span class="text-lg font-bold ${rankColor} w-6 text-center">${i+1}</span>
            <img src="${imgSrc}" class="w-12 h-12 rounded object-cover border bg-gray-100 flex-shrink-0"
                 onerror="this.src='https://placehold.co/100x100?text=Error'">
            <div class="flex-1 min-w-0"><p class="font-medium text-gray-800 break-words">${d.name}</p></div>
            <span class="font-semibold text-blue-600 whitespace-nowrap">${d.qty} 件</span>
        </li>`;
    }).join('');
}

// ─── 商品月銷量 ───────────────────────────────────────────────────────────────
function filterProductCards() { renderProductMonthly(); }
let monthlyCharts = {};

function renderProductMonthly() {
    const platformFilter = document.getElementById('platform-select').value;
    const yearVal = document.getElementById('year-select').value;
    const q = (document.getElementById('product-search').value || '').trim().toLowerCase();

    let allMonths = yearVal === 'all'
        ? [...new Set(allOrdersData.map(d => d.month))].sort()
        : MONTHS_LABEL.map((_, i) => `${yearVal}.${String(i+1).padStart(2,'0')}`);

    const axisLabels = allMonths.map(ym => {
        const [y, m] = ym.split('.');
        return yearVal === 'all' ? `${y}/${m}` : `${parseInt(m)}月`;
    });

    const filtered = allOrdersData.filter(d =>
        (yearVal === 'all' || d.month.startsWith(yearVal)) &&
        (platformFilter === 'all' || d.platform === platformFilter));
    const activePlatforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];

    const productMap = {};
    filtered.forEach(d => {
        const monthIdx = allMonths.indexOf(d.month);
        if (monthIdx === -1) return;
        if (!productMap[d.name]) {
            // 從 itemMap 取得售價
            const entry = itemMap.names[d.name] || Object.values(itemMap.names).find(e => e.shortName === d.name);
            productMap[d.name] = {
                img: d.imgUrl,
                shopeePrice: entry?.shopeePrice ?? null,
                maigoPrice:  entry?.maigoPrice  ?? null
            };
            PLATFORMS.forEach(pl => { productMap[d.name][pl] = new Array(allMonths.length).fill(0); });
        }
        productMap[d.name][d.platform][monthIdx] += d.quantity;
        if (!productMap[d.name].img && d.imgUrl) productMap[d.name].img = d.imgUrl;
    });

    let products = Object.entries(productMap).map(([name, v]) => {
        const total = activePlatforms.reduce((s, pl) => s + v[pl].reduce((a, n) => a+n, 0), 0);
        return { name, img: v.img, shopeePrice: v.shopeePrice, maigoPrice: v.maigoPrice, data: v, total };
    }).sort((a, b) => b.total - a.total);
    if (q) products = products.filter(p => p.name.toLowerCase().includes(q));

    const container = document.getElementById('product-monthly-cards');
    Object.values(monthlyCharts).forEach(c => c.destroy());
    monthlyCharts = {};

    if (!products.length) { container.innerHTML = '<p class="text-gray-400 text-center py-12">無銷售數據</p>'; return; }

    const legendHtml = activePlatforms.map(pl => {
        const c = PLATFORM_COLORS[pl];
        return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#6b7280;">
            <span style="width:10px;height:10px;border-radius:2px;background:${c.bg};border:1px solid ${c.border};display:inline-block;"></span>${pl}</span>`;
    }).join('');
    const chartHeight = yearVal === 'all' ? 240 : 200;

    container.innerHTML = products.map((p, i) => {
        const imgSrc = p.img?.startsWith('http') ? p.img : 'https://placehold.co/100x100?text=No+Img';
        const yearLabel = yearVal === 'all'
            ? `${allMonths[0].split('.')[0]}–${allMonths[allMonths.length-1].split('.')[0]} 全期`
            : `${yearVal} 年`;
        const shopeePriceHtml = p.shopeePrice != null ? `<span style="color:#ee4d2d;">蝦皮售價 $${p.shopeePrice.toLocaleString()}</span>` : '';
        const maigoPriceHtml  = p.maigoPrice  != null ? `<span style="color:#16a34a;">賣貨便/好賣+售價 $${p.maigoPrice.toLocaleString()}</span>` : '';
        const priceHtml = [shopeePriceHtml, maigoPriceHtml].filter(Boolean).join('<span style="color:#d1d5db;margin:0 4px;">／</span>');
        return `<div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div class="flex items-center gap-4 mb-4">
                <img src="${imgSrc}" class="w-14 h-14 rounded-lg object-cover border bg-gray-100 flex-shrink-0"
                     onerror="this.src='https://placehold.co/100x100?text=Error'">
                <div class="flex-1">
                    <p class="font-semibold text-gray-800 text-base">${p.name}</p>
                    ${priceHtml ? `<p class="text-sm font-medium mt-0.5" style="display:flex;gap:4px;align-items:center;">${priceHtml}</p>` : ''}
                    <p class="text-sm text-gray-400 mt-0.5">${yearLabel} 累計銷量：<span class="font-semibold text-blue-600">${p.total} 件</span></p>
                </div>
            </div>
            ${activePlatforms.length > 1 ? `<div style="display:flex;gap:16px;margin-bottom:10px;">${legendHtml}</div>` : ''}
            <div class="relative" style="height:${chartHeight}px;">
                <canvas id="mchart-${i}"></canvas>
            </div>
        </div>`;
    }).join('');

    products.forEach((p, i) => {
        const ctx = document.getElementById(`mchart-${i}`).getContext('2d');
        monthlyCharts[i] = new Chart(ctx, {
            type: 'bar',
            data: { labels: axisLabels, datasets: activePlatforms.map(pl => ({
                label: pl, data: p.data[pl],
                backgroundColor: PLATFORM_COLORS[pl].bg, borderColor: PLATFORM_COLORS[pl].border,
                borderWidth: 1, borderRadius: 2
            }))},
            options: { responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false },
                    tooltip: { callbacks: { footer: items => `合計：${items.reduce((s,it)=>s+it.parsed.y,0)} 件` }}},
                scales: {
                    x: { stacked: true, ticks: { font: { size: yearVal==='all'?10:11 }, autoSkip: false, maxRotation: yearVal==='all'?45:0 }},
                    y: { stacked: true, beginAtZero: true, ticks: { precision: 0, font: { size: 11 }}}
                }
            }
        });
    });
}

// ─── 財務分析主渲染 ───────────────────────────────────────────────────────────
let analysisCharts = {};

function renderAnalysis(tab) {
    currentAnalysisTab = tab || 'all';
    const yearVal = document.getElementById('analysis-year-select').value;
    const container = document.getElementById('section-analysis');
    Object.values(analysisCharts).forEach(c => c.destroy());
    analysisCharts = {};

    // 子 Tab 列
    const subTabHtml = `
        <div class="flex gap-1 mb-6 border-b border-gray-200">
            ${[['all','全部'],['shopee','蝦皮'],['maigo','賣貨便'],['haomai','好賣+']].map(([id, label]) =>
                `<button id="atab-${id}" onclick="switchAnalysisTab('${id}')"
                    class="atab px-4 py-2.5 text-sm font-medium border-b-2 transition
                    ${currentAnalysisTab===id ? 'border-blue-600 text-blue-600 atab-active' : 'border-transparent text-gray-500 hover:text-gray-700'}"
                >${label}</button>`
            ).join('')}
        </div>`;

    if (currentAnalysisTab === 'all') {
        renderAnalysisAll(container, subTabHtml, yearVal);
    } else if (currentAnalysisTab === 'shopee') {
        renderAnalysisShopee(container, subTabHtml, yearVal);
    } else if (currentAnalysisTab === 'maigo') {
        renderAnalysisMaigo(container, subTabHtml, yearVal);
    } else {
        renderAnalysisHaomai(container, subTabHtml);
    }
}

// ─── 全部：三平台折線圖比較 ───────────────────────────────────────────────────
function renderAnalysisAll(container, subTabHtml, yearVal) {
    // 合併蝦皮 + 賣貨便的月份軸
    const allYms = [...new Set([
        ...analysisData.map(d => d.ym),
        ...maigoData.map(d => d.ym)
    ])].filter(ym => yearVal === 'all' || ym.startsWith(yearVal)).sort();

    if (!allYms.length) {
        container.innerHTML = subTabHtml + '<p class="text-gray-400 text-center py-12">無資料</p>';
        return;
    }

    const labels = allYms.map(ym => {
        const [y, m] = ym.split('.');
        return yearVal === 'all' ? `${y}/${m}` : `${parseInt(m)}月`;
    });

    // 各平台依月份取值（無資料補 null）
    const shopeeOrders = allYms.map(ym => analysisData.find(d => d.ym === ym)?.orders ?? null);
    const shopeeSales  = allYms.map(ym => analysisData.find(d => d.ym === ym)?.sales  ?? null);
    const maigoOrders  = allYms.map(ym => maigoData.find(d => d.ym === ym)?.orders    ?? null);
    const maigoSales   = allYms.map(ym => maigoData.find(d => d.ym === ym)?.sales     ?? null);

    // 摘要卡片：各平台合計
    const shopTotOrders = analysisData.filter(d => yearVal==='all'||d.ym.startsWith(yearVal)).reduce((s,d)=>s+d.orders,0);
    const shopTotSales  = analysisData.filter(d => yearVal==='all'||d.ym.startsWith(yearVal)).reduce((s,d)=>s+d.sales,0);
    const maigoTotOrders = maigoData.filter(d => yearVal==='all'||d.ym.startsWith(yearVal)).reduce((s,d)=>s+d.orders,0);
    const maigoTotSales  = maigoData.filter(d => yearVal==='all'||d.ym.startsWith(yearVal)).reduce((s,d)=>s+d.sales,0);

    const fmt = n => n >= 10000 ? `$${(n/10000).toFixed(1)}萬` : `$${Math.round(n).toLocaleString()}`;

    container.innerHTML = subTabHtml + `
        <!-- 摘要卡片 -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 text-center">
                <p class="text-xs mb-1" style="color:#ee4d2d;">蝦皮 訂單數</p>
                <p class="text-2xl font-semibold text-gray-800">${Math.round(shopTotOrders).toLocaleString()}</p>
            </div>
            <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 text-center">
                <p class="text-xs mb-1" style="color:#ee4d2d;">蝦皮 銷售總額</p>
                <p class="text-2xl font-semibold text-gray-800">${fmt(shopTotSales)}</p>
            </div>
            <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 text-center">
                <p class="text-xs mb-1" style="color:#16a34a;">賣貨便 訂單數</p>
                <p class="text-2xl font-semibold text-gray-800">${Math.round(maigoTotOrders).toLocaleString()}</p>
            </div>
            <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 text-center">
                <p class="text-xs mb-1" style="color:#16a34a;">賣貨便 銷售總額</p>
                <p class="text-2xl font-semibold text-gray-800">${fmt(maigoTotSales)}</p>
            </div>
        </div>

        <!-- 銷售總額折線圖 -->
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-6">
            <p class="text-sm font-medium text-gray-600 mb-3">各平台月銷售總額比較</p>
            <div style="display:flex;gap:20px;margin-bottom:10px;flex-wrap:wrap;">
                <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#6b7280;">
                    <span style="width:24px;height:3px;background:#ee4d2d;display:inline-block;border-radius:2px;"></span>蝦皮</span>
                <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#6b7280;">
                    <span style="width:24px;height:3px;background:#16a34a;display:inline-block;border-radius:2px;"></span>賣貨便</span>
            </div>
            <div class="relative" style="height:260px;"><canvas id="all-sales-chart"></canvas></div>
        </div>

        <!-- 訂單數折線圖 -->
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-6">
            <p class="text-sm font-medium text-gray-600 mb-3">各平台月訂單數比較</p>
            <div style="display:flex;gap:20px;margin-bottom:10px;flex-wrap:wrap;">
                <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#6b7280;">
                    <span style="width:24px;height:3px;background:#ee4d2d;display:inline-block;border-radius:2px;"></span>蝦皮</span>
                <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#6b7280;">
                    <span style="width:24px;height:3px;background:#16a34a;display:inline-block;border-radius:2px;"></span>賣貨便</span>
            </div>
            <div class="relative" style="height:240px;"><canvas id="all-orders-chart"></canvas></div>
        </div>`;

    const tickRotate = yearVal === 'all' ? 45 : 0;
    const commonXTick = { font: { size: 11 }, autoSkip: false, maxRotation: tickRotate };
    const fmtY = v => v >= 10000 ? `${(v/10000).toFixed(0)}萬` : v.toLocaleString();

    analysisCharts.allSales = new Chart(document.getElementById('all-sales-chart').getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [
            { label: '蝦皮', data: shopeeSales, borderColor: '#ee4d2d', backgroundColor: 'rgba(238,77,45,0.07)',
              borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#ee4d2d', tension: 0.3, spanGaps: true },
            { label: '賣貨便', data: maigoSales, borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.07)',
              borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#16a34a', tension: 0.3, spanGaps: true }
        ]},
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { ticks: commonXTick }, y: { beginAtZero: true, ticks: { font:{size:11}, callback: fmtY }}}
        }
    });

    analysisCharts.allOrders = new Chart(document.getElementById('all-orders-chart').getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [
            { label: '蝦皮', data: shopeeOrders, borderColor: '#ee4d2d', backgroundColor: 'rgba(238,77,45,0.07)',
              borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#ee4d2d', tension: 0.3, spanGaps: true },
            { label: '賣貨便', data: maigoOrders, borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.07)',
              borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#16a34a', tension: 0.3, spanGaps: true }
        ]},
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { ticks: commonXTick }, y: { beginAtZero: true, ticks: { precision: 0, font:{size:11} }}}
        }
    });
}

// ─── 蝦皮財務 ─────────────────────────────────────────────────────────────────
function renderAnalysisShopee(container, subTabHtml, yearVal) {
    const rows = analysisData.filter(d => yearVal==='all' || d.ym.startsWith(yearVal));
    if (!rows.length) { container.innerHTML = subTabHtml + '<p class="text-gray-400 text-center py-12">無資料</p>'; return; }

    const labels = rows.map(d => { const [y,m]=d.ym.split('.'); return yearVal==='all'?`${y}/${m}`:`${parseInt(m)}月`; });
    const totOrders = rows.reduce((s,d)=>s+d.orders,0);
    const totSales  = rows.reduce((s,d)=>s+d.sales,0);
    const totActual = rows.reduce((s,d)=>s+d.actual,0);
    const totFee    = rows.reduce((s,d)=>s+d.fee,0);
    const fmt = n => n>=10000?`$${(n/10000).toFixed(1)}萬`:`$${Math.round(n).toLocaleString()}`;
    const tickRotate = yearVal==='all'?45:0;

    container.innerHTML = subTabHtml + `
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 text-center">
                <p class="text-xs text-gray-400 mb-1">訂單總數</p>
                <p class="text-2xl font-semibold text-gray-800">${Math.round(totOrders).toLocaleString()}</p>
            </div>
            <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 text-center">
                <p class="text-xs text-gray-400 mb-1">銷售總額</p>
                <p class="text-2xl font-semibold text-blue-600">${fmt(totSales)}</p>
            </div>
            <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 text-center">
                <p class="text-xs text-gray-400 mb-1">實拿總額</p>
                <p class="text-2xl font-semibold text-green-600">${fmt(totActual)}</p>
            </div>
            <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 text-center">
                <p class="text-xs text-gray-400 mb-1">平台手續費</p>
                <p class="text-2xl font-semibold text-red-500">${fmt(totFee)}</p>
                <p class="text-xs text-gray-400 mt-1">（約 ${totSales>0?((totFee/totSales)*100).toFixed(1):0}%）</p>
            </div>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-6">
            <div style="display:flex;gap:20px;margin-bottom:12px;flex-wrap:wrap;">
                <span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#6b7280;"><span style="width:24px;height:3px;background:#2563eb;display:inline-block;border-radius:2px;"></span>銷售總額</span>
                <span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#6b7280;"><span style="width:24px;height:3px;background:#16a34a;display:inline-block;border-radius:2px;"></span>實拿總額</span>
                <span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#6b7280;"><span style="width:24px;height:3px;background:#ef4444;display:inline-block;border-radius:2px;"></span>平台手續費</span>
            </div>
            <div class="relative" style="height:260px;"><canvas id="shopee-line-chart"></canvas></div>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-6">
            <p class="text-sm font-medium text-gray-600 mb-3">每月訂單數</p>
            <div class="relative" style="height:220px;"><canvas id="shopee-order-chart"></canvas></div>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <p class="text-sm font-medium text-gray-600 mb-4">月份明細</p>
            <div class="overflow-x-auto"><table class="w-full text-sm">
                <thead><tr class="border-b border-gray-100">
                    <th class="text-left py-2 pr-4 text-gray-400 font-medium">月份</th>
                    <th class="text-right py-2 px-4 text-gray-400 font-medium">訂單數</th>
                    <th class="text-right py-2 px-4 text-gray-400 font-medium">銷售總額</th>
                    <th class="text-right py-2 px-4 text-gray-400 font-medium">實拿總額</th>
                    <th class="text-right py-2 pl-4 text-gray-400 font-medium">平台手續費</th>
                </tr></thead>
                <tbody>${rows.map((d,i)=>{
                    const [y,mo]=d.ym.split('.');
                    const bg=i%2===0?'':'background:#f9fafb;';
                    return `<tr style="${bg}">
                        <td class="py-2.5 pr-4 text-gray-700">${y} 年 ${parseInt(mo)} 月</td>
                        <td class="text-right py-2.5 px-4 text-gray-800">${Math.round(d.orders).toLocaleString()}</td>
                        <td class="text-right py-2.5 px-4 text-blue-600 font-medium">$${Math.round(d.sales).toLocaleString()}</td>
                        <td class="text-right py-2.5 px-4 text-green-600 font-medium">$${Math.round(d.actual).toLocaleString()}</td>
                        <td class="text-right py-2.5 pl-4 text-red-500">$${Math.round(d.fee).toLocaleString()}</td>
                    </tr>`;
                }).join('')}</tbody>
                <tfoot><tr class="border-t-2 border-gray-200">
                    <td class="py-2.5 pr-4 text-gray-500 font-medium">合計</td>
                    <td class="text-right py-2.5 px-4 font-semibold text-gray-800">${Math.round(totOrders).toLocaleString()}</td>
                    <td class="text-right py-2.5 px-4 font-semibold text-blue-600">$${Math.round(totSales).toLocaleString()}</td>
                    <td class="text-right py-2.5 px-4 font-semibold text-green-600">$${Math.round(totActual).toLocaleString()}</td>
                    <td class="text-right py-2.5 pl-4 font-semibold text-red-500">$${Math.round(totFee).toLocaleString()}</td>
                </tr></tfoot>
            </table></div>
        </div>`;

    analysisCharts.shopeeLine = new Chart(document.getElementById('shopee-line-chart').getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [
            { label:'銷售總額', data:rows.map(d=>d.sales), borderColor:'#2563eb', backgroundColor:'rgba(37,99,235,0.08)', borderWidth:2, pointRadius:4, pointBackgroundColor:'#2563eb', tension:0.3, fill:false },
            { label:'實拿總額', data:rows.map(d=>d.actual), borderColor:'#16a34a', backgroundColor:'rgba(22,163,74,0.08)', borderWidth:2, pointRadius:4, pointBackgroundColor:'#16a34a', tension:0.3, fill:false },
            { label:'平台手續費', data:rows.map(d=>d.fee), borderColor:'#ef4444', borderDash:[5,4], borderWidth:2, pointRadius:3, pointBackgroundColor:'#ef4444', tension:0.3, fill:false }
        ]},
        options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
            scales:{ x:{ticks:{font:{size:11},autoSkip:false,maxRotation:tickRotate}},
                y:{beginAtZero:true,ticks:{font:{size:11},callback:v=>v>=10000?`${(v/10000).toFixed(0)}萬`:v.toLocaleString()}}}}
    });
    analysisCharts.shopeeOrder = new Chart(document.getElementById('shopee-order-chart').getContext('2d'), {
        type: 'bar',
        data: { labels, datasets: [{ label:'訂單數', data:rows.map(d=>d.orders), backgroundColor:'rgba(124,58,237,0.72)', borderColor:'#6d28d9', borderWidth:1, borderRadius:3 }]},
        options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
            scales:{ x:{ticks:{font:{size:11},autoSkip:false,maxRotation:tickRotate}}, y:{beginAtZero:true,ticks:{precision:0,font:{size:11}}}}}
    });
}

// ─── 賣貨便財務 ───────────────────────────────────────────────────────────────
function renderAnalysisMaigo(container, subTabHtml, yearVal) {
    const rows = maigoData.filter(d => yearVal==='all' || d.ym.startsWith(yearVal));
    if (!rows.length) { container.innerHTML = subTabHtml + '<p class="text-gray-400 text-center py-12">無資料</p>'; return; }

    const labels = rows.map(d => { const [y,m]=d.ym.split('.'); return yearVal==='all'?`${y}/${m}`:`${parseInt(m)}月`; });
    const totOrders  = rows.reduce((s,d)=>s+d.orders,0);
    const totSales   = rows.reduce((s,d)=>s+d.sales,0);
    const totActual  = rows.reduce((s,d)=>s+d.actual,0);
    const totTax     = rows.reduce((s,d)=>s+d.tax,0);
    const totFreight = rows.reduce((s,d)=>s+d.freightSubsidy,0);
    const fmt = n => n>=10000?`$${(n/10000).toFixed(1)}萬`:`$${Math.round(n).toLocaleString()}`;
    const tickRotate = yearVal==='all'?45:0;

    container.innerHTML = subTabHtml + `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
            <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 text-center">
                <p class="text-xs text-gray-400 mb-1">訂單總數</p>
                <p class="text-2xl font-semibold text-gray-800">${Math.round(totOrders).toLocaleString()}</p>
            </div>
            <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 text-center">
                <p class="text-xs text-gray-400 mb-1">銷售總額</p>
                <p class="text-2xl font-semibold text-blue-600">${fmt(totSales)}</p>
            </div>
            <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 text-center">
                <p class="text-xs text-gray-400 mb-1">實拿總額</p>
                <p class="text-2xl font-semibold text-green-600">${fmt(totActual)}</p>
                <p class="text-xs text-gray-400 mt-1">（稅金 ${totSales>0?((totTax/totSales)*100).toFixed(1):0}% + 運費 ${totSales>0?((totFreight/totSales)*100).toFixed(1):0}%）</p>
            </div>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-6">
            <div style="display:flex;gap:20px;margin-bottom:12px;flex-wrap:wrap;">
                <span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#6b7280;"><span style="width:24px;height:3px;background:#2563eb;display:inline-block;border-radius:2px;"></span>銷售總額</span>
                <span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#6b7280;"><span style="width:24px;height:3px;background:#16a34a;display:inline-block;border-radius:2px;"></span>實拿總額</span>
            </div>
            <div class="relative" style="height:260px;"><canvas id="maigo-line-chart"></canvas></div>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-6">
            <p class="text-sm font-medium text-gray-600 mb-3">每月訂單數</p>
            <div class="relative" style="height:220px;"><canvas id="maigo-order-chart"></canvas></div>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <p class="text-sm font-medium text-gray-600 mb-4">月份明細</p>
            <div class="overflow-x-auto"><table class="w-full text-sm">
                <thead><tr class="border-b border-gray-100">
                    <th class="text-left py-2 pr-4 text-gray-400 font-medium">月份</th>
                    <th class="text-right py-2 px-4 text-gray-400 font-medium">訂單數</th>
                    <th class="text-right py-2 px-4 text-gray-400 font-medium">銷售總額</th>
                    <th class="text-right py-2 pl-4 text-gray-400 font-medium">實拿總額</th>
                </tr></thead>
                <tbody>${rows.map((d,i)=>{
                    const [y,mo]=d.ym.split('.');
                    const bg=i%2===0?'':'background:#f9fafb;';
                    return `<tr style="${bg}">
                        <td class="py-2.5 pr-4 text-gray-700">${y} 年 ${parseInt(mo)} 月</td>
                        <td class="text-right py-2.5 px-4 text-gray-800">${Math.round(d.orders).toLocaleString()}</td>
                        <td class="text-right py-2.5 px-4 text-blue-600 font-medium">$${Math.round(d.sales).toLocaleString()}</td>
                        <td class="text-right py-2.5 pl-4 text-green-600 font-medium">$${Math.round(d.actual).toLocaleString()}</td>
                    </tr>`;
                }).join('')}</tbody>
                <tfoot><tr class="border-t-2 border-gray-200">
                    <td class="py-2.5 pr-4 text-gray-500 font-medium">合計</td>
                    <td class="text-right py-2.5 px-4 font-semibold text-gray-800">${Math.round(totOrders).toLocaleString()}</td>
                    <td class="text-right py-2.5 px-4 font-semibold text-blue-600">$${Math.round(totSales).toLocaleString()}</td>
                    <td class="text-right py-2.5 pl-4 font-semibold text-green-600">$${Math.round(totActual).toLocaleString()}</td>
                </tr></tfoot>
            </table></div>
        </div>`;

    analysisCharts.maigoLine = new Chart(document.getElementById('maigo-line-chart').getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [
            { label:'銷售總額', data:rows.map(d=>d.sales), borderColor:'#2563eb', backgroundColor:'rgba(37,99,235,0.08)', borderWidth:2, pointRadius:4, pointBackgroundColor:'#2563eb', tension:0.3, fill:false },
            { label:'實拿總額', data:rows.map(d=>d.actual), borderColor:'#16a34a', backgroundColor:'rgba(22,163,74,0.08)', borderWidth:2, pointRadius:4, pointBackgroundColor:'#16a34a', tension:0.3, fill:false }
        ]},
        options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
            scales:{ x:{ticks:{font:{size:11},autoSkip:false,maxRotation:tickRotate}},
                y:{beginAtZero:true,ticks:{font:{size:11},callback:v=>v>=10000?`${(v/10000).toFixed(0)}萬`:v.toLocaleString()}}}}
    });
    analysisCharts.maigoOrder = new Chart(document.getElementById('maigo-order-chart').getContext('2d'), {
        type: 'bar',
        data: { labels, datasets: [{ label:'訂單數', data:rows.map(d=>d.orders), backgroundColor:'rgba(22,163,74,0.72)', borderColor:'#15803d', borderWidth:1, borderRadius:3 }]},
        options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
            scales:{ x:{ticks:{font:{size:11},autoSkip:false,maxRotation:tickRotate}}, y:{beginAtZero:true,ticks:{precision:0,font:{size:11}}}}}
    });
}

// ─── 好賣+ 財務（敬請期待）────────────────────────────────────────────────────
function renderAnalysisHaomai(container, subTabHtml) {
    container.innerHTML = subTabHtml + `
        <div class="flex flex-col items-center justify-center py-24 text-gray-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.2" class="mb-4 text-gray-300">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"/>
            </svg>
            <p class="text-lg font-medium">敬請期待</p>
            <p class="text-sm mt-1">好賣+ 尚無訂單數據</p>
        </div>`;
}
