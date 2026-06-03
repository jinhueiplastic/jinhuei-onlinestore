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

// 平台顏色設定
const PLATFORM_COLORS = {
    '蝦皮':  { bg: 'rgba(238, 77, 45, 0.82)',  border: '#cc3a18' },
    '賣貨便': { bg: 'rgba(22, 163, 74, 0.82)',  border: '#15803d' },
    '好賣+':  { bg: 'rgba(37, 99, 235, 0.82)',  border: '#1d4ed8' }
};
const PLATFORMS = ['蝦皮', '賣貨便', '好賣+'];
const MONTHS_LABEL = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

let itemMap = { codes: {}, names: {} };
let allOrdersData = [];
let myChart = null;

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('platform-select').addEventListener('change', onFilterChange);
    document.getElementById('month-select').addEventListener('change', onFilterChange);
    document.getElementById('year-select').addEventListener('change', renderProductMonthly);
    document.getElementById('refresh-btn').addEventListener('click', loadAllData);
    await loadAllData();
});

function onFilterChange() {
    const activeTab = document.getElementById('section-rank').classList.contains('hidden') ? 'monthly' : 'rank';
    if (activeTab === 'rank') {
        renderData();
    } else {
        renderProductMonthly();
    }
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
        await Promise.all(TABS_CONFIG.map(config => fetchTabOrders(config)));
        console.log('✅ 總訂單筆數:', allOrdersData.length);
        if (allOrdersData.length === 0) {
            listEl.innerHTML = `
                <li class="py-4 text-center text-red-400 text-sm leading-7">
                    ⚠️ 無法讀取資料<br>
                    請確認試算表已設為「知道連結的人皆可檢視」<br>
                    並開啟 F12 Console 查看詳細錯誤訊息
                </li>`;
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

// ─── 初始化月份下拉（熱銷排行）────────────────────────────────────────────────
function initMonthSelect() {
    const monthSelect = document.getElementById('month-select');
    const months = [...new Set(allOrdersData.map(d => d.month))].sort((a, b) => b.localeCompare(a));
    if (months.length === 0) {
        monthSelect.innerHTML = '<option value="all">全部月份（無資料）</option>';
    } else {
        monthSelect.innerHTML =
            '<option value="all">全部月份（年度累計）</option>' +
            months.map(m => `<option value="${m}">${m.replace('.', ' 年 ')} 月</option>`).join('');
        monthSelect.value = months[0];
    }
    initYearSelect();
}

// ─── 初始化年份下拉（商品月銷量）─────────────────────────────────────────────
// 選項：全部有資料的年份 + 單獨每一年
function initYearSelect() {
    const years = [...new Set(allOrdersData.map(d => d.month.split('.')[0]))].sort((a, b) => b - a);
    const sel = document.getElementById('year-select');
    // 第一個選項：所有有資料的年份合併顯示（例如 "2025–2026 全部"）
    const rangeLabel = years.length > 1
        ? `${years[years.length - 1]}–${years[0]} 全部`
        : `${years[0]} 年`;
    sel.innerHTML =
        `<option value="all">${rangeLabel}</option>` +
        years.map(y => `<option value="${y}">${y} 年</option>`).join('');
    // 預設選最新年份
    sel.value = years[0] || 'all';
}

// ─── Tab 切換 ─────────────────────────────────────────────────────────────────
function switchTab(tab) {
    const isRank = tab === 'rank';
    document.getElementById('section-rank').classList.toggle('hidden', !isRank);
    document.getElementById('section-monthly').classList.toggle('hidden', isRank);
    document.getElementById('month-select-wrap').classList.toggle('hidden', !isRank);
    document.getElementById('year-select-wrap').classList.toggle('hidden', isRank);
    document.getElementById('product-search-wrap').classList.toggle('hidden', isRank);
    document.getElementById('tab-btn-rank').classList.toggle('active', isRank);
    document.getElementById('tab-btn-monthly').classList.toggle('active', !isRank);
    if (!isRank) renderProductMonthly();
}

// ─── 熱銷排行：篩選 & 渲染 ───────────────────────────────────────────────────
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
        const imgSrc = d.img && d.img.startsWith('http')
            ? d.img : 'https://placehold.co/100x100?text=No+Img';
        const rankColor = i === 0 ? 'text-yellow-500'
                        : i === 1 ? 'text-gray-400'
                        : i === 2 ? 'text-amber-600'
                        : 'text-gray-300';
        return `
            <li class="py-4 flex items-center gap-4">
                <span class="text-lg font-bold ${rankColor} w-6 text-center">${i + 1}</span>
                <img src="${imgSrc}"
                     class="w-12 h-12 rounded object-cover border bg-gray-100 flex-shrink-0"
                     onerror="this.src='https://placehold.co/100x100?text=Error'">
                <div class="flex-1 min-w-0">
                    <p class="font-medium text-gray-800 break-words">${d.name}</p>
                </div>
                <span class="font-semibold text-blue-600 whitespace-nowrap">${d.qty} 件</span>
            </li>`;
    }).join('');
}

// ─── 商品月銷量：搜尋篩選 ─────────────────────────────────────────────────────
function filterProductCards() {
    renderProductMonthly();
}

// ─── 商品月銷量：渲染（堆疊長條圖，三平台各自顏色）────────────────────────────
let monthlyCharts = {};

function renderProductMonthly() {
    const platformFilter = document.getElementById('platform-select').value;
    const yearVal = document.getElementById('year-select').value;   // 'all' 或 'YYYY'
    const q = (document.getElementById('product-search').value || '').trim().toLowerCase();

    if (!yearVal) return;

    // 決定要顯示哪幾個月份軸（跨年時顯示 "YYYY/MM" 格式）
    let allMonths;
    if (yearVal === 'all') {
        // 取所有有資料的月份，升序排列
        allMonths = [...new Set(allOrdersData.map(d => d.month))].sort();
    } else {
        allMonths = MONTHS_LABEL.map((_, i) => `${yearVal}.${String(i + 1).padStart(2, '0')}`);
    }

    // 軸標籤
    const axisLabels = allMonths.map(ym => {
        const [y, m] = ym.split('.');
        return yearVal === 'all' ? `${y}/${m}` : `${parseInt(m)}月`;
    });

    // 篩選資料
    const filtered = allOrdersData.filter(d =>
        (yearVal === 'all' || d.month.startsWith(yearVal)) &&
        (platformFilter === 'all' || d.platform === platformFilter)
    );

    // 決定要顯示哪些平台
    const activePlatforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];

    // 依商品分組：productMap[name][platform][monthIndex] = qty
    const productMap = {};
    filtered.forEach(d => {
        const monthIdx = allMonths.indexOf(d.month);
        if (monthIdx === -1) return;
        if (!productMap[d.name]) {
            productMap[d.name] = { img: d.imgUrl };
            PLATFORMS.forEach(pl => {
                productMap[d.name][pl] = new Array(allMonths.length).fill(0);
            });
        }
        productMap[d.name][d.platform][monthIdx] += d.quantity;
        if (!productMap[d.name].img && d.imgUrl) productMap[d.name].img = d.imgUrl;
    });

    // 計算各商品年度總量，排序
    let products = Object.entries(productMap).map(([name, v]) => {
        const total = activePlatforms.reduce((sum, pl) =>
            sum + v[pl].reduce((s, n) => s + n, 0), 0);
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

    // 平台圖例 HTML（只顯示 active platforms）
    const legendHtml = activePlatforms.map(pl => {
        const c = PLATFORM_COLORS[pl];
        return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#6b7280;">
            <span style="width:10px;height:10px;border-radius:2px;background:${c.bg};border:1px solid ${c.border};display:inline-block;"></span>${pl}
        </span>`;
    }).join('');

    // 動態圖表高度：跨年時月份多，給多一點高度
    const chartHeight = yearVal === 'all' ? 240 : 200;

    container.innerHTML = products.map((p, i) => {
        const imgSrc = p.img && p.img.startsWith('http')
            ? p.img : 'https://placehold.co/100x100?text=No+Img';
        const yearLabel = yearVal === 'all'
            ? allMonths[0].split('.')[0] + '–' + allMonths[allMonths.length - 1].split('.')[0] + ' 全期'
            : `${yearVal} 年`;
        return `
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div class="flex items-center gap-4 mb-4">
                    <img src="${imgSrc}"
                         class="w-14 h-14 rounded-lg object-cover border bg-gray-100 flex-shrink-0"
                         onerror="this.src='https://placehold.co/100x100?text=Error'">
                    <div class="flex-1">
                        <p class="font-semibold text-gray-800 text-base">${p.name}</p>
                        <p class="text-sm text-gray-400 mt-0.5">
                            ${yearLabel} 累計銷量：
                            <span class="font-semibold text-blue-600">${p.total} 件</span>
                        </p>
                    </div>
                </div>
                ${activePlatforms.length > 1
                    ? `<div style="display:flex;gap:16px;margin-bottom:10px;">${legendHtml}</div>`
                    : ''}
                <div class="relative" style="height:${chartHeight}px;">
                    <canvas id="mchart-${i}"
                            role="img"
                            aria-label="${p.name} 各月銷量堆疊圖">
                    </canvas>
                </div>
            </div>`;
    }).join('');

    // 建立各商品堆疊長條圖
    products.forEach((p, i) => {
        const ctx = document.getElementById(`mchart-${i}`).getContext('2d');

        const datasets = activePlatforms.map(pl => ({
            label: pl,
            data: p.data[pl],
            backgroundColor: PLATFORM_COLORS[pl].bg,
            borderColor: PLATFORM_COLORS[pl].border,
            borderWidth: 1,
            borderRadius: 2
        }));

        monthlyCharts[i] = new Chart(ctx, {
            type: 'bar',
            data: { labels: axisLabels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            // tooltip 顯示各平台 + 合計
                            footer: (items) => {
                                const total = items.reduce((s, it) => s + it.parsed.y, 0);
                                return `合計：${total} 件`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        ticks: {
                            font: { size: yearVal === 'all' ? 10 : 11 },
                            autoSkip: false,
                            maxRotation: yearVal === 'all' ? 45 : 0
                        }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        ticks: { precision: 0, font: { size: 11 } }
                    }
                }
            }
        });
    });
}
