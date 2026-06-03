const SPREADSHEET_ID = '1UVjxSh9d7mFpdR3pZIWGG7TCJWiaYTIMN2apSQHjg0U';

const TABS_CONFIG = [
    { 
        gid: '113883750', tabName: '賣貨便-訂單', platform: '賣貨便',
        dateIdx: 1, nameIdx: 4, qtyIdx: 7, matchType: 'name' 
    },
    { 
        gid: '1863581895', tabName: '好賣+訂單', platform: '好賣+',
        dateIdx: 32, nameIdx: 9, qtyIdx: 12, matchType: 'name' 
    },
    { 
        gid: '1172321346', tabName: 'Order', platform: '蝦皮',
        dateIdx: 3, nameIdx: 14, qtyIdx: 15, matchType: 'code' 
    }
];

let itemMap = { codes: {}, names: {} };
let allOrdersData = [];
let myChart = null;

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('platform-select').addEventListener('change', renderData);
    document.getElementById('month-select').addEventListener('change', renderData);
    document.getElementById('refresh-btn').addEventListener('click', loadAllData);
    await loadAllData();
});

// ✅ 統一的 gviz fetch 函式，加上 &headers=0
async function fetchGvizData(gid) {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}&headers=0`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
    const text = await response.text();
    // gviz 回傳不是純 JSON，要去掉前後包裝
    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    return JSON.parse(jsonStr);
}

// ✅ 解析 gviz 日期格式（Date(year, month0indexed, day) 月份要 +1）
function parseGvizDate(cell) {
    if (!cell) return null;
    
    // 優先用格式化字串 (f)
    const raw = cell.f || (cell.v ? String(cell.v) : '');
    
    // 格式: 2025/1/15 或 2025-01-15 或 2025年1月
    let m = raw.match(/(\d{4})[年\/-](\d{1,2})/);
    if (m) return `${m[1]}.${m[2].padStart(2, '0')}`;
    
    // gviz 原始格式: Date(2025,0,15) — 月份是 0-indexed！
    m = String(cell.v || '').match(/Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)/);
    if (m) {
        const month = parseInt(m[2]) + 1; // ✅ 關鍵：0-indexed 要 +1
        return `${m[1]}.${String(month).padStart(2, '0')}`;
    }
    
    // gviz 有時回傳數字（Excel serial date）
    if (typeof cell.v === 'number') {
        // Excel date serial: 從 1900/1/1 起算
        const date = new Date((cell.v - 25569) * 86400 * 1000);
        if (!isNaN(date)) {
            return `${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
        }
    }
    
    return null;
}

async function loadAllData() {
    const listEl = document.getElementById('ranking-list');
    listEl.innerHTML = '<li class="py-3 text-center text-gray-400">正在同步雲端資料...</li>';
    
    try {
        await fetchItemDictionary();
        
        allOrdersData = [];
        await Promise.all(TABS_CONFIG.map(config => fetchTabOrders(config)));
        
        console.log("✅ 總訂單筆數:", allOrdersData.length);
        
        if (allOrdersData.length === 0) {
            listEl.innerHTML = '<li class="py-3 text-center text-red-400">⚠️ 無法讀取資料，請確認試算表已設為「公開分享（知道連結者可檢視）」</li>';
            return;
        }
        
        initMonthSelect();
        renderData();
    } catch (e) {
        console.error("載入失敗:", e);
        listEl.innerHTML = `<li class="py-3 text-center text-red-400">❌ 載入失敗：${e.message}<br><small>請確認 Google Sheet 已公開分享</small></li>`;
    }
}

async function fetchItemDictionary() {
    try {
        const data = await fetchGvizData(0);
        itemMap = { codes: {}, names: {} };
        
        if (data?.table?.rows) {
            data.table.rows.forEach((row, idx) => {
                if (idx === 0 || !row.c) return;
                const code = row.c[1]?.v ? String(row.c[1].v).trim() : '';
                const shortName = row.c[26]?.v ? String(row.c[26].v).trim() : '';
                const imgUrl = row.c[28]?.v ? String(row.c[28].v).trim() : '';
                
                if (shortName) {
                    if (code) itemMap.codes[code] = { shortName, imgUrl };
                    itemMap.names[shortName] = { shortName, imgUrl };
                }
            });
            console.log("✅ 商品字典載入，共", Object.keys(itemMap.names).length, "筆");
        }
    } catch (e) {
        console.warn("⚠️ 商品字典載入失敗（不影響訂單統計）:", e.message);
    }
}

async function fetchTabOrders(config) {
    try {
        const data = await fetchGvizData(config.gid);
        let count = 0;
        
        if (data?.table?.rows) {
            data.table.rows.forEach((row, idx) => {
                if (idx === 0 || !row.c) return;
                
                // ✅ 安全檢查欄位是否存在
                const dateCell = row.c[config.dateIdx];
                const nameCell = row.c[config.nameIdx];
                if (!dateCell || !nameCell) return;
                
                try {
                    // 解析日期
                    const ym = parseGvizDate(dateCell);
                    if (!ym) return;
                    
                    // 解析商品名稱/貨號
                    const rawId = nameCell.v ? String(nameCell.v).trim() : '';
                    if (!rawId || rawId === 'null') return;
                    
                    // 解析數量
                    let quantity = 1;
                    const qtyCell = row.c[config.qtyIdx];
                    if (qtyCell?.v != null) {
                        quantity = parseInt(qtyCell.v) || 1;
                    }
                    
                    // 比對商品字典
                    let resolved = { shortName: rawId, imgUrl: '' };
                    if (config.matchType === 'code') {
                        if (itemMap.codes[rawId]) resolved = itemMap.codes[rawId];
                    } else {
                        for (const key in itemMap.names) {
                            if (rawId.includes(key)) { resolved = itemMap.names[key]; break; }
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
                } catch (_) {}
            });
        }
        console.log(`✅ [${config.tabName}] 讀取 ${count} 筆`);
    } catch (e) {
        console.error(`❌ [${config.tabName}] 失敗:`, e.message);
    }
}

function initMonthSelect() {
    const monthSelect = document.getElementById('month-select');
    const months = [...new Set(allOrdersData.map(d => d.month))]
        .filter(m => m !== '未知月份')
        .sort((a, b) => b.localeCompare(a));
    
    if (months.length === 0) {
        monthSelect.innerHTML = '<option value="all">全部月份 (無資料)</option>';
        return;
    }
    
    monthSelect.innerHTML = '<option value="all">全部月份 (年度累計)</option>' +
        months.map(m => `<option value="${m}">${m.replace('.', ' 年 ')} 月</option>`).join('');
    monthSelect.value = months[0];
}

function renderData() {
    const p = document.getElementById('platform-select').value;
    const m = document.getElementById('month-select').value;
    
    const filtered = allOrdersData.filter(d =>
        (p === 'all' || d.platform === p) && (m === 'all' || d.month === m)
    );
    
    const sum = {};
    filtered.forEach(d => {
        if (!sum[d.name]) sum[d.name] = { qty: 0, img: d.imgUrl };
        sum[d.name].qty += d.quantity;
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
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
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
        const imgSrc = d.img?.startsWith('http') ? d.img : 'https://placehold.co/100x100?text=No+Img';
        return `
            <li class="py-4 flex items-center gap-4">
                <span class="text-lg font-bold ${i < 3 ? 'text-amber-500' : 'text-gray-400'} w-6 text-center">${i + 1}</span>
                <img src="${imgSrc}" class="w-12 h-12 rounded object-cover border bg-gray-100"
                     onerror="this.src='https://placehold.co/100x100?text=Error'">
                <div class="flex-1 min-w-0">
                    <p class="font-medium text-gray-800 truncate" title="${d.name}">${d.name}</p>
                    <p class="text-xs text-gray-400 mt-0.5">商品排行</p>
                </div>
                <span class="font-semibold text-blue-600 whitespace-nowrap">${d.qty} 件</span>
            </li>`;
    }).join('');
}
