const SPREADSHEET_ID = '1UVjxSh9d7mFpdR3pZIWGG7TCJWiaYTIMN2apSQHjg0U';

const TABS_CONFIG = [
    {
        gid: '1172321346',
        tabName: '賣貨便-訂單',
        platform: '賣貨便',
        dateIdx: 1,
        nameIdx: 4,
        qtyIdx: 7,
        matchType: 'name',
        inheritDate: true
    },
    {
        gid: '1589327275',
        tabName: '好賣+訂單',
        platform: '好賣+',
        dateIdx: 32,
        nameIdx: 9,
        qtyIdx: 12,
        matchType: 'name',
        inheritDate: true
    },
    {
        gid: '113883750',
        tabName: 'Order',
        platform: '蝦皮',
        dateIdx: 3,
        nameIdx: 14,
        qtyIdx: 15,
        matchType: 'code',
        inheritDate: false
    }
];

const ANALYSIS_GID = '726971026';

const PLATFORM_COLORS = {
    '蝦皮':  { bg: 'rgba(238, 77, 45, 0.82)',  border: '#cc3a18' },
    '賣貨便': { bg: 'rgba(22, 163, 74, 0.82)',  border: '#15803d' },
    '好賣+':  { bg: 'rgba(37, 99, 235, 0.82)',  border: '#1d4ed8' }
};
const PLATFORMS = ['蝦皮', '賣貨便', '好賣+'];
const MONTHS_LABEL = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

let itemMap = { codes: {}, names: {} };
let allOrdersData = [];
let analysisData = [];   // [{ ym:'2025.06', orders, sales, actual, fee }]
let myChart = null;

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('platform-select').addEventListener('change', onFilterChange);
    document.getElementById('month-select').addEventListener('change', onFilterChange);
    document.getElementById('year-select').addEventListener('change', renderProductMonthly);
    document.getElementById('analysis-year-select').addEventListener('change', renderAnalysis);
    document.getElementById('refresh-btn').addEventListener('click', loadAllData);
    await loadAllData();
});

function onFilterChange() {
    const activeTab = document.getElementById('section-rank').classList.contains('hidden') ? 'monthly' : 'rank';
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
    if (m2) {
        const month = parseInt(m2[2]) + 1;
        return `${m2[1]}.${String(month).padStart(2, '0')}`;
    }
    if (typeof cell.v === 'number' && cell.v > 0) {
        const date = new Date((cell.v - 25569) * 86400 * 1000);
        if (!isNaN(date)) {
            return `${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
        }
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
            fetchAnalysisData()
        ]);
        console.log('✅ 總訂單筆數:', allOrdersData.length);
        console.log('✅ Analysis 筆數:', analysisData.length);
        if (allOrdersData.length === 0 && analysisData.length === 0) {
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
                const code      = row.c[1]?.v  ? String(row.c[1].v).trim()  : '';
                const shortName = row.c[26]?.v ? String(row.c[26].v).trim() : '';
                const imgUrl    = row.c[28]?.v ? String(row.c[28].v).trim() : '';
                if (!shortName) return;
                if (code) itemMap.codes[code] = { shortName, imgUrl };
                itemMap.names[shortName] = { shortName, imgUrl };
            });
        }
        console.log('✅ 商品字典載入：', Object.keys(itemMap.names).length, '筆');
    } catch (e) {
        console.warn('⚠️ 商品字典載入失敗:', e.message);
    }
}

async function fetchTabOrders(config) {
    try {
        const data = await fetchGvizData(config.gid);
        let count = 0;
        let lastValidDate = null;
        if (data?.table?.rows) {
            data.table.rows.forEach(row => {
                if (!row.c) return;
                try {
                    const dateCell = row.c[config.dateIdx];
                    const parsedDate = parseGvizDate(dateCell);
                    if (parsedDate) {
                        lastValidDate = parsedDate;
                    } else if (config.inheritDate && lastValidDate) {
                        // 沿用上一列日期
                    } else {
                        return;
                    }
                    const ym = lastValidDate;
                    const nameCell = row.c[config.nameIdx];
                    if (!nameCell) return;
                    const rawId = nameCell.v ? String(nameCell.v).trim() : '';
                    if (!rawId || rawId === 'null' || /^\d+$/.test(rawId)) return;
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
                            if (rawId.includes(key) || key.includes(rawId)) {
                                resolved = itemMap.names[key];
                                matched = true;
                                break;
                            }
                        }
                        if (!matched) console.warn(`⚠️ [${config.platform}] 找不到名稱對應：${rawId}`);
                    }
                    allOrdersData.push({
                        month: ym,
                        platform: config.platform,
                        name: resolved.shortName,
                        imgUrl: resolved.imgUrl,
                        quantity
                    });
                    count++;
                } catch (innerErr) {
                    console.warn('單列解析失敗:', innerErr.message);
                }
            });
        }
        console.log(`✅ [${config.tabName}] 成功讀取 ${count} 筆`);
    } catch (e) {
        console.error(`❌ [${config.tabName}] 連線失敗:`, e.message);
    }
}

// ─── 讀取 Analysis 分頁 ───────────────────────────────────────────────────────
// A欄(0)=月份(2025年6月)  B欄(1)=訂單數  C欄(2)=銷售總額  D欄(3)=實拿總額  E欄(4)=平台手續費
// 第1-2列是標題，第3列起資料（gviz 已吸收標題列，所以 rows[0] 是第3列）
async function fetchAnalysisData() {
    try {
        const data = await fetchGvizData(ANALYSIS_GID);
        analysisData = [];
        if (data?.table?.rows) {
            data.table.rows.forEach(row => {
                if (!row.c) return;
                // 解析月份：支援 "2025年6月" / "2025/06" 等格式
                const rawMonth = row.c[0]?.v ? String(row.c[0].v).trim()
                               : row.c[0]?.f ? String(row.c[0].f).trim() : '';
                if (!rawMonth) return;
                const m = rawMonth.match(/(\d{4})[年\/\-](\d{1,2})/);
                if (!m) return;
                const ym = `${m[1]}.${m[2].padStart(2, '0')}`;

                const orders = parseFloat(row.c[1]?.v) || 0;
                const sales  = parseFloat(row.c[2]?.v) || 0;
                const actual = parseFloat(row.c[3]?.v) || 0;
                const fee    = parseFloat(row.c[4]?.v) || 0;

                analysisData.push({ ym, orders, sales, actual, fee });
            });
        }
        // 升序排列
        analysisData.sort((a, b) => a.ym.localeCompare(b.ym));
        console.log('✅ Analysis 資料：', analysisData);
    } catch (e) {
        console.warn('⚠️ Analysis 載入失敗:', e.message);
    }
}

// ─── 初始化月份下拉（熱銷排行）────────────────────────────────────────────────
function initMonthSelect() {
    const monthSelect = document.getElementById('month-select');
    const months = [...new Set(allOrdersData.map(d => d.month))].sort((a, b) => b.localeCompare(a));
    monthSelect.innerHTML =
        '<option value="all">全部月份（年度累計）</option>' +
        months.map(m => `<option value="${m}">${m.replace('.', ' 年 ')} 月</option>`).join('');
    monthSelect.value = 'all';   // ← 預設全部

    initYearSelect();
    initAnalysisYearSelect();
}

// ─── 初始化年份下拉（商品月銷量）─────────────────────────────────────────────
function initYearSelect() {
    const years = [...new Set(allOrdersData.map(d => d.month.split('.')[0]))].sort((a, b) => b - a);
    const sel = document.getElementById('year-select');
    const rangeLabel = years.length > 1
        ? `${years[years.length - 1]}–${years[0]} 全部`
        : (years[0] ? `${years[0]} 年` : '全部');
    sel.innerHTML =
        `<option value="all">${rangeLabel}</option>` +
        years.map(y => `<option value="${y}">${y} 年</option>`).join('');
    sel.value = 'all';   // ← 預設全部
}

// ─── 初始化年份下拉（Analysis）───────────────────────────────────────────────
function initAnalysisYearSelect() {
    const years = [...new Set(analysisData.map(d => d.ym.split('.')[0]))].sort((a, b) => b - a);
    const sel = document.getElementById('analysis-year-select');
    const rangeLabel = years.length > 1
        ? `${years[years.length - 1]}–${years[0]} 全部`
        : (years[0] ? `${years[0]} 年` : '全部');
    sel.innerHTML =
        `<option value="all">${rangeLabel}</option>` +
        years.map(y => `<option value="${y}">${y} 年</option>`).join('');
    sel.value = 'all';   // ← 預設全部
}

// ─── Tab 切換 ─────────────────────────────────────────────────────────────────
function switchTab(tab) {
    const tabs = ['rank', 'monthly', 'analysis'];
    tabs.forEach(t => {
        document.getElementById(`section-${t}`).classList.toggle('hidden', t !== tab);
        document.getElementById(`tab-btn-${t}`).classList.toggle('active', t === tab);
    });
    // filter bar 控制項
    document.getElementById('month-select-wrap').classList.toggle('hidden', tab !== 'rank');
    document.getElementById('year-select-wrap').classList.toggle('hidden', tab !== 'monthly');
    document.getElementById('product-search-wrap').classList.toggle('hidden', tab !== 'monthly');
    document.getElementById('analysis-year-wrap').classList.toggle('hidden', tab !== 'analysis');
    // platform select：analysis tab 不需要
    document.getElementById('platform-select-wrap').classList.toggle('hidden', tab === 'analysis');

    if (tab === 'monthly') renderProductMonthly();
    if (tab === 'analysis') renderAnalysis();
}

// ─── 熱銷排行 ─────────────────────────────────────────────────────────────────
function renderData() {
    const p = document.getElementById('platform-select').value;
    const m = document.getElementById('month-select').value;
    const filtered = allOrdersData.filter(d =>
        (p === 'all' || d.platform === p) &&
        (m === 'all' || d.month === m)
    );
    const sum = {};
    filtered.forEach(d => {
        if (!sum[d.name]) sum[d.name] = { qty: 0, img: d.imgUrl };
        sum[d.name].qty += d.quantity;
        if (!sum[d.name].img && d.imgUrl) sum[d.name].img = d.imgUrl;
    });
    const sorted = Object.entries(sum)
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.qty - a.qty);
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
            datasets: [{
                label: '銷售件數',
                data: top.map(d => d.qty),
                backgroundColor: 'rgba(59, 130, 246, 0.75)',
                borderColor: 'rgba(59, 130, 246, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { maxRotation: 30, font: { size: 11 } } },
                y: { beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });
}

function updateList(data) {
    const listContainer = document.getElementById('ranking-list');
    if (data.length === 0) {
        listContainer.innerHTML = '<li class="py-3 text-gray-400 text-center">無銷售數據</li>';
        return;
    }
    listContainer.innerHTML = data.map((d, i) => {
        const imgSrc = d.img && d.img.startsWith('http') ? d.img : 'https://placehold.co/100x100?text=No+Img';
        const rankColor = i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-600' : 'text-gray-300';
        return `
            <li class="py-4 flex items-center gap-4">
                <span class="text-lg font-bold ${rankColor} w-6 text-center">${i + 1}</span>
                <img src="${imgSrc}" class="w-12 h-12 rounded object-cover border bg-gray-100 flex-shrink-0"
                     onerror="this.src='https://placehold.co/100x100?text=Error'">
                <div class="flex-1 min-w-0">
                    <p class="font-medium text-gray-800 break-words">${d.name}</p>
                </div>
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

    let allMonths;
    if (yearVal === 'all') {
        allMonths = [...new Set(allOrdersData.map(d => d.month))].sort();
    } else {
        allMonths = MONTHS_LABEL.map((_, i) => `${yearVal}.${String(i + 1).padStart(2, '0')}`);
    }
    const axisLabels = allMonths.map(ym => {
        const [y, m] = ym.split('.');
        return yearVal === 'all' ? `${y}/${m}` : `${parseInt(m)}月`;
    });

    const filtered = allOrdersData.filter(d =>
        (yearVal === 'all' || d.month.startsWith(yearVal)) &&
        (platformFilter === 'all' || d.platform === platformFilter)
    );
    const activePlatforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];

    const productMap = {};
    filtered.forEach(d => {
        const monthIdx = allMonths.indexOf(d.month);
        if (monthIdx === -1) return;
        if (!productMap[d.name]) {
            productMap[d.name] = { img: d.imgUrl };
            PLATFORMS.forEach(pl => { productMap[d.name][pl] = new Array(allMonths.length).fill(0); });
        }
        productMap[d.name][d.platform][monthIdx] += d.quantity;
        if (!productMap[d.name].img && d.imgUrl) productMap[d.name].img = d.imgUrl;
    });

    let products = Object.entries(productMap).map(([name, v]) => {
        const total = activePlatforms.reduce((sum, pl) => sum + v[pl].reduce((s, n) => s + n, 0), 0);
        return { name, img: v.img, data: v, total };
    }).sort((a, b) => b.total - a.total);
    if (q) products = products.filter(p => p.name.toLowerCase().includes(q));

    const container = document.getElementById('product-monthly-cards');
    Object.values(monthlyCharts).forEach(c => c.destroy());
    monthlyCharts = {};

    if (products.length === 0) {
        container.innerHTML = '<p class="text-gray-400 text-center py-12">無銷售數據</p>';
        return;
    }

    const legendHtml = activePlatforms.map(pl => {
        const c = PLATFORM_COLORS[pl];
        return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#6b7280;">
            <span style="width:10px;height:10px;border-radius:2px;background:${c.bg};border:1px solid ${c.border};display:inline-block;"></span>${pl}
        </span>`;
    }).join('');
    const chartHeight = yearVal === 'all' ? 240 : 200;

    container.innerHTML = products.map((p, i) => {
        const imgSrc = p.img && p.img.startsWith('http') ? p.img : 'https://placehold.co/100x100?text=No+Img';
        const yearLabel = yearVal === 'all'
            ? allMonths[0].split('.')[0] + '–' + allMonths[allMonths.length - 1].split('.')[0] + ' 全期'
            : `${yearVal} 年`;
        return `
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div class="flex items-center gap-4 mb-4">
                    <img src="${imgSrc}" class="w-14 h-14 rounded-lg object-cover border bg-gray-100 flex-shrink-0"
                         onerror="this.src='https://placehold.co/100x100?text=Error'">
                    <div class="flex-1">
                        <p class="font-semibold text-gray-800 text-base">${p.name}</p>
                        <p class="text-sm text-gray-400 mt-0.5">${yearLabel} 累計銷量：
                            <span class="font-semibold text-blue-600">${p.total} 件</span></p>
                    </div>
                </div>
                ${activePlatforms.length > 1 ? `<div style="display:flex;gap:16px;margin-bottom:10px;">${legendHtml}</div>` : ''}
                <div class="relative" style="height:${chartHeight}px;">
                    <canvas id="mchart-${i}" role="img" aria-label="${p.name} 各月銷量堆疊圖"></canvas>
                </div>
            </div>`;
    }).join('');

    products.forEach((p, i) => {
        const ctx = document.getElementById(`mchart-${i}`).getContext('2d');
        monthlyCharts[i] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: axisLabels,
                datasets: activePlatforms.map(pl => ({
                    label: pl,
                    data: p.data[pl],
                    backgroundColor: PLATFORM_COLORS[pl].bg,
                    borderColor: PLATFORM_COLORS[pl].border,
                    borderWidth: 1,
                    borderRadius: 2
                }))
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            footer: (items) => `合計：${items.reduce((s, it) => s + it.parsed.y, 0)} 件`
                        }
                    }
                },
                scales: {
                    x: { stacked: true, ticks: { font: { size: yearVal === 'all' ? 10 : 11 }, autoSkip: false, maxRotation: yearVal === 'all' ? 45 : 0 } },
                    y: { stacked: true, beginAtZero: true, ticks: { precision: 0, font: { size: 11 } } }
                }
            }
        });
    });
}

// ─── Analysis Tab ─────────────────────────────────────────────────────────────
let analysisCharts = {};

function renderAnalysis() {
    const yearVal = document.getElementById('analysis-year-select').value;

    const rows = analysisData.filter(d => yearVal === 'all' || d.ym.startsWith(yearVal));

    const container = document.getElementById('section-analysis');
    Object.values(analysisCharts).forEach(c => c.destroy());
    analysisCharts = {};

    if (rows.length === 0) {
        container.innerHTML = '<p class="text-gray-400 text-center py-12">無資料</p>';
        return;
    }

    // 軸標籤
    const labels = rows.map(d => {
        const [y, m] = d.ym.split('.');
        return yearVal === 'all' ? `${y}/${m}` : `${parseInt(m)}月`;
    });

    // 摘要總計
    const totOrders = rows.reduce((s, d) => s + d.orders, 0);
    const totSales  = rows.reduce((s, d) => s + d.sales, 0);
    const totActual = rows.reduce((s, d) => s + d.actual, 0);
    const totFee    = rows.reduce((s, d) => s + d.fee, 0);

    const fmt = n => n >= 10000
        ? `$${(n / 10000).toFixed(1)}萬`
        : `$${Math.round(n).toLocaleString()}`;

    container.innerHTML = `
        <!-- 摘要卡片 -->
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
            </div>
        </div>

        <!-- 月銷售額折線圖 -->
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-6">
            <div style="display:flex;gap:20px;margin-bottom:12px;flex-wrap:wrap;">
                <span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#6b7280;">
                    <span style="width:24px;height:3px;background:#2563eb;display:inline-block;border-radius:2px;"></span>銷售總額
                </span>
                <span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#6b7280;">
                    <span style="width:24px;height:3px;background:#16a34a;display:inline-block;border-radius:2px;"></span>實拿總額
                </span>
                <span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#6b7280;">
                    <span style="width:24px;height:3px;background:#ef4444;display:inline-block;border-radius:2px;border-top:2px dashed #ef4444;"></span>平台手續費
                </span>
            </div>
            <div class="relative" style="height:260px;">
                <canvas id="analysis-line-chart" role="img" aria-label="月銷售額趨勢折線圖"></canvas>
            </div>
        </div>

        <!-- 月訂單數長條圖 -->
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-6">
            <p class="text-sm font-medium text-gray-600 mb-3">每月訂單數</p>
            <div class="relative" style="height:220px;">
                <canvas id="analysis-order-chart" role="img" aria-label="每月訂單數長條圖"></canvas>
            </div>
        </div>

        <!-- 明細表格 -->
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <p class="text-sm font-medium text-gray-600 mb-4">月份明細</p>
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="border-b border-gray-100">
                            <th class="text-left py-2 pr-4 text-gray-400 font-medium">月份</th>
                            <th class="text-right py-2 px-4 text-gray-400 font-medium">訂單數</th>
                            <th class="text-right py-2 px-4 text-gray-400 font-medium">銷售總額</th>
                            <th class="text-right py-2 px-4 text-gray-400 font-medium">實拿總額</th>
                            <th class="text-right py-2 pl-4 text-gray-400 font-medium">平台手續費</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map((d, i) => {
                            const [y, m] = d.ym.split('.');
                            const label = `${y} 年 ${parseInt(m)} 月`;
                            const bg = i % 2 === 0 ? '' : 'background:#f9fafb;';
                            return `<tr style="${bg}">
                                <td class="py-2.5 pr-4 text-gray-700">${label}</td>
                                <td class="text-right py-2.5 px-4 text-gray-800">${Math.round(d.orders).toLocaleString()}</td>
                                <td class="text-right py-2.5 px-4 text-blue-600 font-medium">$${Math.round(d.sales).toLocaleString()}</td>
                                <td class="text-right py-2.5 px-4 text-green-600 font-medium">$${Math.round(d.actual).toLocaleString()}</td>
                                <td class="text-right py-2.5 pl-4 text-red-500">$${Math.round(d.fee).toLocaleString()}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                    <tfoot>
                        <tr class="border-t-2 border-gray-200">
                            <td class="py-2.5 pr-4 text-gray-500 font-medium">合計</td>
                            <td class="text-right py-2.5 px-4 font-semibold text-gray-800">${Math.round(totOrders).toLocaleString()}</td>
                            <td class="text-right py-2.5 px-4 font-semibold text-blue-600">$${Math.round(totSales).toLocaleString()}</td>
                            <td class="text-right py-2.5 px-4 font-semibold text-green-600">$${Math.round(totActual).toLocaleString()}</td>
                            <td class="text-right py-2.5 pl-4 font-semibold text-red-500">$${Math.round(totFee).toLocaleString()}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>`;

    // 折線圖
    const lineCtx = document.getElementById('analysis-line-chart').getContext('2d');
    analysisCharts.line = new Chart(lineCtx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: '銷售總額',
                    data: rows.map(d => d.sales),
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37,99,235,0.08)',
                    borderWidth: 2,
                    pointRadius: 4,
                    pointBackgroundColor: '#2563eb',
                    tension: 0.3,
                    fill: false
                },
                {
                    label: '實拿總額',
                    data: rows.map(d => d.actual),
                    borderColor: '#16a34a',
                    backgroundColor: 'rgba(22,163,74,0.08)',
                    borderWidth: 2,
                    pointRadius: 4,
                    pointBackgroundColor: '#16a34a',
                    tension: 0.3,
                    fill: false
                },
                {
                    label: '平台手續費',
                    data: rows.map(d => d.fee),
                    borderColor: '#ef4444',
                    borderDash: [5, 4],
                    borderWidth: 2,
                    pointRadius: 3,
                    pointBackgroundColor: '#ef4444',
                    tension: 0.3,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { font: { size: 11 }, autoSkip: false, maxRotation: yearVal === 'all' ? 45 : 0 } },
                y: {
                    beginAtZero: true,
                    ticks: {
                        font: { size: 11 },
                        callback: v => v >= 10000 ? `${(v/10000).toFixed(0)}萬` : v.toLocaleString()
                    }
                }
            }
        }
    });

    // 訂單數長條圖
    const orderCtx = document.getElementById('analysis-order-chart').getContext('2d');
    analysisCharts.order = new Chart(orderCtx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: '訂單數',
                data: rows.map(d => d.orders),
                backgroundColor: 'rgba(124,58,237,0.72)',
                borderColor: '#6d28d9',
                borderWidth: 1,
                borderRadius: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { font: { size: 11 }, autoSkip: false, maxRotation: yearVal === 'all' ? 45 : 0 } },
                y: { beginAtZero: true, ticks: { precision: 0, font: { size: 11 } } }
            }
        }
    });
}
