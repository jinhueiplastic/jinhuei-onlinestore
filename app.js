const SPREADSHEET_ID = '1UVjxSh9d7mFpdR3pZIWGG7TCJWiaYTIMN2apSQHjg0U';

// 1. 定義資料來源配置
const TABS_CONFIG = [
    { 
        tabName: '賣貨便-訂單', platform: '賣貨便',
        dateIdx: 1, nameIdx: 4, qtyIdx: 7, matchType: 'name' 
    },
    { 
        tabName: '好賣+訂單', platform: '好賣+',
        dateIdx: 32, nameIdx: 9, qtyIdx: 12, matchType: 'name' 
    },
    { 
        tabName: 'Order', platform: '蝦皮',
        dateIdx: 3, nameIdx: 14, qtyIdx: 15, matchType: 'code' // 使用貨號匹配
    }
];

let itemMap = {}; // 用於儲存 { 原始名稱/貨號: { 簡稱, 圖片 } }
let allOrdersData = [];
let myChart = null;

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('platform-select').addEventListener('change', renderData);
    document.getElementById('month-select').addEventListener('change', renderData);
    document.getElementById('refresh-btn').addEventListener('click', loadAllData);
    await loadAllData();
});

async function loadAllData() {
    document.getElementById('ranking-list').innerHTML = '<li class="py-3 text-center text-gray-400">正在同步商品字典與訂單...</li>';
    
    // Step 1: 先抓取 Item 頁面建立索引
    await fetchItemDictionary();
    
    // Step 2: 抓取所有訂單
    allOrdersData = [];
    const promises = TABS_CONFIG.map(config => fetchTabOrders(config));
    await Promise.all(promises);

    initMonthSelect();
    renderData();
}

// 抓取 Item 頁面：B(1)貨號, AA(26)簡稱, AC(28)圖片
async function fetchItemDictionary() {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Item`;
    try {
        const response = await fetch(url);
        const text = await response.text();
        const data = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
        
        itemMap = { codes: {}, names: {} };
        data.table.rows.forEach(row => {
            if (!row.c || !row.c[26]) return;
            const code = row.c[1] ? String(row.c[1].v) : '';
            const shortName = String(row.c[26].v);
            const imgUrl = row.c[28] ? String(row.c[28].v) : '';

            // 建立貨號索引與名稱索引
            if (code) itemMap.codes[code] = { shortName, imgUrl };
            itemMap.names[shortName] = { shortName, imgUrl };
        });
    } catch (e) { console.error("Item 字典載入失敗", e); }
}

async function fetchTabOrders(config) {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(config.tabName)}`;
    try {
        const response = await fetch(url);
        const text = await response.text();
        const data = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
        
        data.table.rows.forEach((row, idx) => {
            if (idx === 0 || !row.c) return;
            
            // 解析日期
            let rawDate = row.c[config.dateIdx] ? String(row.c[config.dateIdx].f || row.c[config.dateIdx].v) : '';
            let monthMatch = rawDate.match(/(\d{4})[年\/-](\d{1,2})/);
            if (!monthMatch) return;
            let ym = `${monthMatch[1]}.${monthMatch[2].padStart(2, '0')}`;

            // 解析商品與關聯
            let rawId = row.c[config.nameIdx] ? String(row.c[config.nameIdx].v) : '';
            let quantity = parseInt(row.c[config.qtyIdx] ? row.c[config.qtyIdx].v : 1) || 1;

            // 關聯邏輯
            let resolved = { shortName: rawId, imgUrl: '' };
            if (config.matchType === 'code' && itemMap.codes[rawId]) {
                resolved = itemMap.codes[rawId];
            } else {
                // 名稱模糊匹配：如果訂單名稱包含簡稱，就採用
                for (let key in itemMap.names) {
                    if (rawId.includes(key)) { resolved = itemMap.names[key]; break; }
                }
            }

            allOrdersData.push({ month: ym, platform: config.platform, ...resolved, quantity });
        });
    } catch (e) { console.error(`${config.tabName} 載入失敗`, e); }
}

function initMonthSelect() {
    const months = [...new Set(allOrdersData.map(d => d.month))].sort((a,b) => b.localeCompare(a));
    document.getElementById('month-select').innerHTML = 
        '<option value="all">全部月份</option>' + 
        months.map(m => `<option value="${m}">${m}</option>`).join('');
    if (months[0]) document.getElementById('month-select').value = months[0];
}

function renderData() {
    const p = document.getElementById('platform-select').value;
    const m = document.getElementById('month-select').value;
    
    let filtered = allOrdersData.filter(d => (p === 'all' || d.platform === p) && (m === 'all' || d.month === m));

    const sum = {};
    filtered.forEach(d => {
        if (!sum[d.shortName]) sum[d.shortName] = { qty: 0, img: d.imgUrl };
        sum[d.shortName].qty += d.quantity;
    });

    const sorted = Object.keys(sum).map(k => ({ name: k, ...sum[k] })).sort((a,b) => b.qty - a.qty);
    
    updateChart(sorted);
    updateList(sorted);
}

function updateChart(data) {
    const ctx = document.getElementById('salesChart').getContext('2d');
    if (myChart) myChart.destroy();
    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.slice(0, 15).map(d => d.name),
            datasets: [{ label: '銷售件數', data: data.slice(0, 15).map(d => d.qty), backgroundColor: '#3b82f6' }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function updateList(data) {
    document.getElementById('ranking-list').innerHTML = data.map((d, i) => `
        <li class="py-4 flex items-center gap-4">
            <span class="text-lg font-bold text-gray-400 w-6">${i+1}</span>
            <img src="${d.img || 'https://via.placeholder.com/50'}" class="w-12 h-12 rounded object-cover border">
            <div class="flex-1 min-w-0">
                <p class="font-medium text-gray-800 truncate">${d.name}</p>
                <p class="text-sm text-blue-600 font-bold">${d.qty} 件</p>
            </div>
        </li>
    `).join('');
}
