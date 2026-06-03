const SPREADSHEET_ID = '1UVjxSh9d7mFpdR3pZIWGG7TCJWiaYTIMN2apSQHjg0U';

// 欄位索引 (A=0, B=1, C=2 ...)
// AG = 第32欄 (A=0...Z=25, AA=26, AB=27 ... AG=32)
const TABS_CONFIG = [
    {
        gid: '113883750',
        tabName: '賣貨便-訂單',
        platform: '賣貨便',
        dateIdx: 1,   // B欄
        nameIdx: 4,   // E欄
        qtyIdx: 7,    // H欄
        matchType: 'name'
    },
    {
        gid: '1863581895',
        tabName: '好賣+訂單',
        platform: '好賣+',
        dateIdx: 32,  // AG欄
        nameIdx: 9,   // J欄
        qtyIdx: 12,   // M欄
        matchType: 'name'
    },
    {
        gid: '1172321346',
        tabName: 'Order',
        platform: '蝦皮',
        dateIdx: 3,   // D欄
        nameIdx: 14,  // O欄
        qtyIdx: 15,   // P欄
        matchType: 'code'
    }
];

// itemMap.codes[貨號] = { shortName, imgUrl }
// itemMap.names[簡稱] = { shortName, imgUrl }
let itemMap = { codes: {}, names: {} };
let allOrdersData = [];
let myChart = null;

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('platform-select').addEventListener('change', renderData);
    document.getElementById('month-select').addEventListener('change', renderData);
    document.getElementById('refresh-btn').addEventListener('click', loadAllData);
    await loadAllData();
});

// ─── 統一抓取 gviz JSON ────────────────────────────────────────────────────────
// 不加 &headers=0，讓 gviz 自動把第一列當 column header 吸收掉，
// 這樣 rows 陣列裡就全是資料列，不需要再手動跳過 idx=0。
async function fetchGvizData(gid) {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    return JSON.parse(jsonStr);
}

// ─── 解析 gviz 日期欄，回傳 "YYYY.MM" 字串，失敗回傳 null ──────────────────────
function parseGvizDate(cell) {
    if (!cell) return null;

    // 優先用格式化字串 (f)，例如 "2025/3/15"、"2025-03-15"、"2025年3月15日"
    const raw = cell.f ? String(cell.f) : (cell.v ? String(cell.v) : '');

    let m = raw.match(/(\d{4})[年\/-](\d{1,2})/);
    if (m) return `${m[1]}.${m[2].padStart(2, '0')}`;

    // gviz 原始值有時是 "Date(2025,2,15)"，月份 0-indexed，要 +1
    m = raw.match(/Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)/);
    if (m) {
        const month = parseInt(m[2]) + 1;
        return `${m[1]}.${String(month).padStart(2, '0')}`;
    }

    // gviz 有時回傳 Excel serial number（數字）
    if (typeof cell.v === 'number') {
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
                <li class="py-4 text-center text-red-400 text-sm leading-6">
                    ⚠️ 無法讀取資料<br>
                    請確認試算表已設為「知道連結的人皆可檢視」<br>
                    並開啟瀏覽器 Console (F12) 查看詳細錯誤
                </li>`;
            return;
        }

        initMonthSelect();
        renderData();
    } catch (e) {
        console.error('載入失敗:', e);
        listEl.innerHTML = `<li class="py-4 text-center text-red-400 text-sm">❌ 載入失敗：${e.message}</li>`;
    }
}

// ─── 讀取 Item 頁，建立貨號/簡稱 → { shortName, imgUrl } 字典 ───────────────
// Item 頁：B欄(1)=貨號, AA欄(26)=簡稱, AC欄(28)=圖片
async function fetchItemDictionary() {
    try {
        const data = await fetchGvizData(0); // gid=0 是 Item 頁
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

        console.log('✅ 商品字典：', Object.keys(itemMap.names).length, '筆');
    } catch (e) {
        console.warn('⚠️ 商品字典載入失敗（統計仍可運作，但名稱/圖片可能不正確）:', e.message);
    }
}

// ─── 讀取各訂單分頁 ──────────────────────────────────────────────────────────
async function fetchTabOrders(config) {
    try {
        const data = await fetchGvizData(config.gid);
        let count = 0;

        if (data?.table?.rows) {
            data.table.rows.forEach(row => {
                if (!row.c) return;

                try {
                    // 1. 解析日期
                    const ym = parseGvizDate(row.c[config.dateIdx]);
                    if (!ym) return;

                    // 2. 解析商品標識（貨號 or 商品名稱）
                    const nameCell = row.c[config.nameIdx];
                    if (!nameCell) return;
                    const rawId = nameCell.v ? String(nameCell.v).trim() : '';
                    if (!rawId || rawId === 'null') return;

                    // 3. 解析數量（預設 1）
                    let quantity = 1;
                    const qtyCell = row.c[config.qtyIdx];
                    if (qtyCell?.v != null) {
                        quantity = parseInt(qtyCell.v) || 1;
                    }

                    // 4. 對應商品字典
                    let resolved = { shortName: rawId, imgUrl: '' };

                    if (config.matchType === 'code') {
                        // 蝦皮：用 O欄貨號 精確比對 Item B欄
                        if (itemMap.codes[rawId]) {
                            resolved = itemMap.codes[rawId];
                        }
                    } else {
                        // 賣貨便 / 好賣+：用商品名稱模糊比對 Item AA欄簡稱（雙向）
                        for (const key in itemMap.names) {
                            if (rawId.includes(key) || key.includes(rawId)) {
                                resolved = itemMap.names[key];
                                break;
                            }
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
                } catch (_) {
                    // 單行解析失敗：跳過，不影響其他資料
                }
            });
        }

        console.log(`✅ [${config.tabName}] 讀取 ${count} 筆`);
    } catch (e) {
        console.error(`❌ [${config.tabName}] 失敗:`, e.message);
    }
}

// ─── 初始化月份下拉選單 ───────────────────────────────────────────────────────
function initMonthSelect() {
    const monthSelect = document.getElementById('month-select');
    const months = [...new Set(allOrdersData.map(d => d.month))]
        .sort((a, b) => b.localeCompare(a)); // 最新月份排前面

    if (months.length === 0) {
        monthSelect.innerHTML = '<option value="all">全部月份（無資料）</option>';
        return;
    }

    monthSelect.innerHTML =
        '<option value="all">全部月份（年度累計）</option>' +
        months.map(m => `<option value="${m}">${m.replace('.', ' 年 ')} 月</option>`).join('');

    monthSelect.value = months[0]; // 預設最新月份
}

// ─── 篩選 & 渲染 ─────────────────────────────────────────────────────────────
function renderData() {
    const p = document.getElementById('platform-select').value;
    const m = document.getElementById('month-select').value;

    const filtered = allOrdersData.filter(d =>
        (p === 'all' || d.platform === p) &&
        (m === 'all' || d.month === m)
    );

    // 依商品名稱加總數量
    const sum = {};
    filtered.forEach(d => {
        if (!sum[d.name]) sum[d.name] = { qty: 0, img: d.imgUrl };
        sum[d.name].qty += d.quantity;
        // 如果之前沒有圖片但現在有，補上
        if (!sum[d.name].img && d.imgUrl) sum[d.name].img = d.imgUrl;
    });

    const sorted = Object.entries(sum)
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.qty - a.qty);

    updateChart(sorted);
    updateList(sorted);
}

// ─── 長條圖（前15名）────────────────────────────────────────────────────────
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
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: {
                        maxRotation: 30,
                        font: { size: 11 }
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 }
                }
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
                    <p class="font-medium text-gray-800 truncate" title="${d.name}">${d.name}</p>
                    <p class="text-xs text-gray-400 mt-0.5">商品排行</p>
                </div>
                <span class="font-semibold text-blue-600 whitespace-nowrap">${d.qty} 件</span>
            </li>`;
    }).join('');
}
