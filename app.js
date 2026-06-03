const SPREADSHEET_ID = '1UVjxSh9d7mFpdR3pZIWGG7TCJWiaYTIMN2apSQHjg0U';

// 精準對齊欄位索引 (A欄=0, B=1, C=2...)
const TABS_CONFIG = [
    { 
        gid: '113883750', tabName: '賣貨便-訂單', platform: '賣貨便',
        dateIdx: 1,      // B 欄
        nameIdx: 4,      // E 欄 (商品名稱)
        qtyIdx: 7,       // H 欄 (數量)
        matchType: 'name' 
    },
    { 
        gid: '1863581895', tabName: '好賣+訂單', platform: '好賣+',
        dateIdx: 32,     // AG 欄 (第33欄)
        nameIdx: 9,      // J 欄 (第10欄)
        qtyIdx: 12,      // M 欄 (第13欄)
        matchType: 'name' 
    },
    { 
        gid: '1172321346', tabName: 'Order', platform: '蝦皮',
        dateIdx: 3,      // D 欄 (第4欄)
        nameIdx: 14,     // O 欄 (第15欄 商品選項貨號)
        qtyIdx: 15,      // P 欄 (第16欄 數量)
        matchType: 'code' 
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

async function loadAllData() {
    document.getElementById('ranking-list').innerHTML = '<li class="py-3 text-center text-gray-400">正在深度同步雲端商品主檔與訂單...</li>';
    
    // Step 1: 抓取 Item 頁面 (gid=0)
    await fetchItemDictionary();
    
    // Step 2: 抓取所有訂單
    allOrdersData = [];
    const promises = TABS_CONFIG.map(config => fetchTabOrders(config));
    await Promise.all(promises);

    console.log("總共成功抓取到的訂單筆數:", allOrdersData.length);

    initMonthSelect();
    renderData();
}

// 讀取 Item 頁面建立索引：B(1)貨號, AA(26)簡稱, AC(28)圖片
async function fetchItemDictionary() {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=0`;
    try {
        const response = await fetch(url);
        const text = await response.text();
        const data = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
        
        itemMap = { codes: {}, names: {} };
        if (data && data.table && data.table.rows) {
            data.table.rows.forEach((row, idx) => {
                if (idx === 0 || !row.c) return; 
                
                const code = (row.c[1] && row.c[1].v) ? String(row.c[1].v).trim() : '';
                const shortName = (row.c[26] && row.c[26].v) ? String(row.c[26].v).trim() : '';
                const imgUrl = (row.c[28] && row.c[28].v) ? String(row.c[28].v).trim() : '';

                if (shortName) {
                    if (code) itemMap.codes[code] = { shortName, imgUrl };
                    itemMap.names[shortName] = { shortName, imgUrl };
                }
            });
            console.log("Item 字典載入成功，商品總數:", Object.keys(itemMap.names).length);
        }
    } catch (e) { 
        console.error("Item 字典載入失敗，錯誤回報:", e); 
    }
}

async function fetchTabOrders(config) {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=${config.gid}`;
    try {
        const response = await fetch(url);
        const text = await response.text();
        const data = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
        
        let validRowsCount = 0;

        if (data && data.table && data.table.rows) {
            data.table.rows.forEach((row, idx) => {
                if (idx === 0 || !row.c) return; // 跳過標頭與空行
                
                // 超強安全檢查：確保要讀取的欄位存在，否則直接跳過不報錯
                if (!row.c[config.dateIdx] || !row.c[config.nameIdx]) return;

                try {
                    // 1. 解析日期
                    let cellDate = row.c[config.dateIdx];
                    let rawDate = cellDate.f || (cellDate.v ? String(cellDate.v) : '');
                    let monthMatch = rawDate.match(/(\d{4})[年\/-](\d{1,2})/);
                    
                    let ym = '未知月份';
                    if (monthMatch) {
                        ym = `${monthMatch[1]}.${monthMatch[2].padStart(2, '0')}`;
                    } else if (rawDate.includes('Date')) {
                        const dateMatch = rawDate.match(/Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)/);
                        if (dateMatch) {
                            ym = `${dateMatch[1]}.${String(parseInt(dateMatch[2]) + 1).padStart(2, '0')}`;
                        }
                    }
                    if (ym === '未知月份') return; 

                    // 2. 解析商品標識碼
                    let rawId = row.c[config.nameIdx].v ? String(row.c[config.nameIdx].v).trim() : '';
                    if (!rawId || rawId === 'null') return;

                    // 3. 解析數量
                    let quantity = 1;
                    if (config.qtyIdx !== null && row.c[config.qtyIdx] && row.c[config.qtyIdx].v !== null) {
                        quantity = parseInt(row.c[config.qtyIdx].v) || 1;
                    }

                    // 4. 對應商品字典
                    let resolved = { shortName: rawId, imgUrl: '' };
                    
                    if (config.matchType === 'code') {
                        if (itemMap.codes[rawId]) {
                            resolved = itemMap.codes[rawId];
                        }
                    } else {
                        for (let key in itemMap.names) {
                            if (rawId.includes(key)) { 
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
                        quantity: quantity
                    });
                    
                    validRowsCount++;

                } catch (innerError) {
                    // 單行解析出錯時，跳過，不影響其他行
                }
            });
            console.log(`分頁 [${config.tabName}] 成功讀取到 ${validRowsCount} 筆有效訂單`);
        }
    } catch (e) { 
        console.error(`分頁 [${config.tabName}] 連線或讀取失敗:`, e); 
    }
}

function initMonthSelect() {
    const monthSelect = document.getElementById('month-select');
    const months = [...new Set(allOrdersData.map(d => d.month))].sort((a,b) => b.localeCompare(a));
    
    if (months.length === 0) {
        monthSelect.innerHTML = '<option value="all">全部月份 (無資料)</option>';
        return;
    }

    let html = '<option value="all">全部月份 (年度累計)</option>';
    html += months.map(m => `<option value="${m}">${m.replace('.', ' 年 ')} 月</option>`).join('');
    monthSelect.innerHTML = html;
    
    monthSelect.value = months[0]; // 預設選取最新月份
}

function renderData() {
    const p = document.getElementById('platform-select').value;
    const m = document.getElementById('month-select').value;
    
    let filtered = allOrdersData.filter(d => (p === 'all' || d.platform === p) && (m === 'all' || d.month === m));

    const sum = {};
    filtered.forEach(d => {
        if (!sum[d.name]) sum[d.name] = { qty: 0, img: d.imgUrl };
        sum[d.name].qty += d.quantity;
    });

    const sorted = Object.keys(sum).map(k => ({ name: k, ...sum[k] })).sort((a,b) => b.qty - a.qty);
    
    updateChart(sorted);
    updateList(sorted);
}

function updateChart(data) {
    const ctx = document.getElementById('salesChart').getContext('2d');
    if (myChart) myChart.destroy();
    
    const topData = data.slice(0, 15);

    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: topData.map(d => d.name),
            datasets: [{ 
                label: '銷售件數', 
                data: topData.map(d => d.qty), 
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
        const imgSrc = d.img && d.img.startsWith('http') ? d.img : 'https://via.placeholder.com/100?text=No+Image';
        return `
            <li class="py-4 flex items-center gap-4">
                <span class="text-lg font-bold ${i < 3 ? 'text-amber-500' : 'text-gray-400'} w-6 text-center">${i + 1}</span>
                <img src="${imgSrc}" class="w-12 h-12 rounded object-cover border bg-gray-100" onerror="this.src='https://via.placeholder.com/100?text=Error'">
                <div class="flex-1 min-w-0">
                    <p class="font-medium text-gray-800 truncate" title="${d.name}">${d.name}</p>
                    <p class="text-xs text-gray-400 mt-0.5">商品排行</p>
                </div>
                <span class="font-semibold text-blue-600 whitespace-nowrap">${d.qty} 件</span>
            </li>
        `;
    }).join('');
}
