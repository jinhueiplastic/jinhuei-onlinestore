const SPREADSHEET_ID = '1UVjxSh9d7mFpdR3pZIWGG7TCJWiaYTIMN2apSQHjg0U';

// 欄位索引 (A=0, B=1, C=2 ... Z=25, AA=26, AB=27 ... AG=32)
const TABS_CONFIG = [
    {
        gid: '1172321346',
        tabName: '賣貨便-訂單',
        platform: '賣貨便',
        dateIdx: 1,    // B欄：日期（可能空白，需繼承上一列）
        nameIdx: 4,    // E欄：商品名稱
        qtyIdx: 7,     // H欄：數量
        matchType: 'name',
        inheritDate: true
    },
    {
        gid: '1589327275',
        tabName: '好賣+訂單',
        platform: '好賣+',
        dateIdx: 32,   // AG欄：日期
        nameIdx: 9,    // J欄：商品名稱
        qtyIdx: 12,    // M欄：數量
        matchType: 'name',
        inheritDate: true
    },
    {
        gid: '113883750',
        tabName: 'Order',
        platform: '蝦皮',
        dateIdx: 3,    // D欄：日期（格式：2026/4/28 07:52）
        nameIdx: 14,   // O欄：商品選項貨號
        qtyIdx: 15,    // P欄：數量
        matchType: 'code',
        inheritDate: false
    }
];

// itemMap.codes[貨號]  = { shortName, imgUrl }
// itemMap.names[簡稱]  = { shortName, imgUrl }
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

// ─── 篩選器變動：依目前 tab 決定要呼叫哪個 render ────────────────────────────
function onFilterChange() {
    const activeTab = document.getElementById('section-rank').classList.contains('hidden') ? 'monthly' : 'rank';
    if (activeTab === 'rank') {
        renderData();
    } else {
        renderProductMonthly();
    }
}

// ─── 統一抓取 gviz JSON ───────────────────────────────────────────────────────
async function fetchGvizData(gid) {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    return JSON.parse(jsonStr);
}

// ─── 解析 gviz 日期欄，回傳 "YYYY.MM" 字串，失敗回傳 null ───────────────────
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

// ─── 主流程 ──────────────────────────────────────────────────────────────────
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

// ─── 讀取 Item 頁，建立字典 ──────────────────────────────────────────────────
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
        console.warn('⚠️ 商品字典載入失敗（統計仍可運作，但名稱/圖片可能不正確）:', e.message);
    }
}

// ─── 讀取各訂單分頁 ───────────────────────────────────────────────────────────
async function fetchTabOrders(config) {
    try {
        const data = await fetchGvizData(config.gid);
        let count = 0;
        let lastValidDate = null;

        if (data?.table?.rows) {
            data.table.rows.forEach(row => {
                if (!row.c) return;

                try {
                    // ── 步驟 1：解析日期 ──────────────────────────────────────
                    const dateCell = row.c[config.dateIdx];
                    const parsedDate = parseGvizDate(dateCell);

                    if (parsedDate) {
                        lastValidDate = parsedDate;
                    } else if (config.inheritDate && lastValidDate) {
                        // 空白日期：沿用上一列的日期
                    } else {
                        return;
                    }

                    const ym = lastValidDate;

                    // ── 步驟 2：解析商品名稱/貨號 ────────────────────────────
                    const nameCell = row.c[config.nameIdx];
                    if (!nameCell) return;

                    const rawId = nameCell.v ? String(nameCell.v).trim() : '';

                    if (!rawId || rawId === 'null' || /^\d+$/.test(rawId)) return;

                    // ── 步驟 3：解析數量（預設 1）────────────────────────────
                    let quantity = 1;
                    const qtyCell = row.c[config.qtyIdx];
                    if (qtyCell?.v != null) {
                        quantity = parseInt(qtyCell.v) || 1;
                    }

                    // ── 步驟 4：比對商品字典 ──────────────────────────────────
                    let resolved = { shortName: rawId, imgUrl: '' };

                    if (config.matchType === 'code') {
                        if (itemMap.codes[rawId]) {
                            resolved = itemMap.codes[rawId];
                        } else {
                            console.warn(`⚠️ [${config.platform}] 找不到貨號：${rawId}`);
                        }
                    } else {
                        let matched = false;
                        for (const key in itemMap.names) {
                            if (rawId.includes(key) || key.includes(rawId)) {
                                resolved = itemMap.names[key];
                                matched = true;
                                break;
                            }
                        }
                        if (!matched) {
                            console.warn(`⚠️ [${config.platform}] 找不到名稱對應：${rawId}`);
                        }
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

// ─── 初始化月份下拉（熱銷排行用）─────────────────────────────────────────────
function initMonthSelect() {
    const monthSelect = document.getElementById('month-select');
    const months = [...new Set(allOrdersData.map(d => d.month))]
        .sort((a, b) => b.localeCompare(a));

    if (months.length === 0) {
        monthSelect.innerHTML = '<option value="all">全部月份（無資料）</option>';
    } else {
        monthSelect.innerHTML =
            '<option value="all">全部月份（年度累計）</option>' +
            months.map(m => `<option value="${m}">${m.replace('.', ' 年 ')} 月</option>`).join('');
        monthSelect.value = months[0];
    }

    // 同步初始化年份選單（商品月銷量用）
    initYearSelect();
}

// ─── 初始化年份下拉（商品月銷量用）──────────────────────────────────────────
function initYearSelect() {
    const years = [...new Set(allOrdersData.map(d => d.month.split('.')[0]))]
        .sort((a, b) => b - a);
    const sel = document.getElementById('year-select');
    sel.innerHTML = years.map(y => `<option value="${y}">${y} 年</option>`).join('');
}

// ─── Tab 切換 ─────────────────────────────────────────────────────────────────
function switchTab(tab) {
    const isRank = tab === 'rank';

    // 版面顯示/隱藏
    document.getElementById('section-rank').classList.toggle('hidden', !isRank);
    document.getElementById('section-monthly').classList.toggle('hidden', isRank);

    // Filter bar 控制項切換
    document.getElementById('month-select-wrap').classList.toggle('hidden', !isRank);
    document.getElementById('year-select-wrap').classList.toggle('hidden', isRank);
    document.getElementById('product-search-wrap').classList.toggle('hidden', isRank);

    // Tab 按鈕樣式
    document.getElementById('tab-btn-rank').classList.toggle('active', isRank);
    document.getElementById('tab-btn-monthly').classList.toggle('active', !isRank);

    // 切換到月銷量時觸發渲染
    if (!isRank) renderProductMonthly();
}

// ─── 篩選 & 渲染（熱銷排行）──────────────────────────────────────────────────
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

// ─── 長條圖（熱銷排行，前 15 名）─────────────────────────────────────────────
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

// ─── 熱銷排行清單 ─────────────────────────────────────────────────────────────
function updateList(data) {
    const listContainer = document.getElementById('ranking-list');

    if (data.length === 0) {
        listContainer.innerHTML = '<li class="py-3 text-gray-400 text-center">無銷售數據</li>';
        return;
    }

    listContainer.innerHTML = data.map((d, i) => {
        const imgSrc = d.img && d.img.startsWith('http')
            ? d.img
            : 'https://placehold.co/100x100?text=No+Img';

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

// ─── 商品月銷量：渲染所有商品卡片 ────────────────────────────────────────────
let monthlyCharts = {};

function renderProductMonthly() {
    const platform = document.getElementById('platform-select').value;
    const year = document.getElementById('year-select').value;
    const q = (document.getElementById('product-search').value || '').trim().toLowerCase();

    if (!year) return;

    // 篩選該年 + 賣場
    const filtered = allOrdersData.filter(d =>
        d.month.startsWith(year) &&
        (platform === 'all' || d.platform === platform)
    );

    // 依商品名稱分組，計算 1–12 月銷量
    const productMap = {};
    filtered.forEach(d => {
        const mm = parseInt(d.month.split('.')[1]) - 1; // 0-indexed
        if (!productMap[d.name]) {
            productMap[d.name] = {
                name: d.name,
                img: d.imgUrl,
                monthly: new Array(12).fill(0)
            };
        }
        productMap[d.name].monthly[mm] += d.quantity;
        if (!productMap[d.name].img && d.imgUrl) productMap[d.name].img = d.imgUrl;
    });

    // 依年度總量排序
    let products = Object.values(productMap)
        .sort((a, b) =>
            b.monthly.reduce((s, v) => s + v, 0) -
            a.monthly.reduce((s, v) => s + v, 0)
        );

    // 搜尋篩選
    if (q) products = products.filter(p => p.name.toLowerCase().includes(q));

    const container = document.getElementById('product-monthly-cards');

    // 銷毀舊圖表
    Object.values(monthlyCharts).forEach(c => c.destroy());
    monthlyCharts = {};

    if (products.length === 0) {
        container.innerHTML = '<p class="text-gray-400 text-center py-12">無銷售數據</p>';
        return;
    }

    const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

    container.innerHTML = products.map((p, i) => {
        const total = p.monthly.reduce((a, b) => a + b, 0);
        const imgSrc = p.img && p.img.startsWith('http')
            ? p.img
            : 'https://placehold.co/100x100?text=No+Img';

        return `
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div class="flex items-center gap-4 mb-5">
                    <img src="${imgSrc}"
                         class="w-14 h-14 rounded-lg object-cover border bg-gray-100 flex-shrink-0"
                         onerror="this.src='https://placehold.co/100x100?text=Error'">
                    <div>
                        <p class="font-semibold text-gray-800 text-base">${p.name}</p>
                        <p class="text-sm text-gray-400 mt-0.5">
                            ${year} 年累計銷量：
                            <span class="font-semibold text-blue-600">${total} 件</span>
                        </p>
                    </div>
                </div>
                <div class="relative" style="height: 200px;">
                    <canvas id="mchart-${i}"
                            role="img"
                            aria-label="${p.name} ${year}年各月銷量長條圖">
                        ${MONTHS.map((m, mi) => `${m}: ${p.monthly[mi]} 件`).join('、')}
                    </canvas>
                </div>
            </div>`;
    }).join('');

    // 建立各商品圖表
    products.forEach((p, i) => {
        const ctx = document.getElementById(`mchart-${i}`).getContext('2d');
        monthlyCharts[i] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: MONTHS,
                datasets: [{
                    label: '銷售件數',
                    data: p.monthly,
                    backgroundColor: 'rgba(30, 64, 175, 0.72)',
                    borderColor: '#1e3a8a',
                    borderWidth: 1,
                    borderRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        ticks: {
                            font: { size: 11 },
                            autoSkip: false,
                            maxRotation: 0
                        }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0, font: { size: 11 } }
                    }
                }
            }
        });
    });
}
